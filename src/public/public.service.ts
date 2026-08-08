import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly whatsappService: WhatsappService,
  ) {}


  async getTenantPublicInfo(slug: string) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        OR: [
          { subdominio: cleanSlug },
          { slug: cleanSlug },
        ]
      },
      select: {
        slug: true,
        nome_empresa: true,
        foto_url: true,
        cor_primaria: true,
        cor_destaque: true,
        cor_fundo: true,
        cor_texto_principal: true,
        cor_texto_secundario: true,
        agenda_publica_ativa: true,
      },
    });

    if (!tenant) throw new NotFoundException('Establishment not found.');
    return { tenant };
  }

  async getPublicServices(slug: string) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    await this.prisma.ensureTenantSchema(cleanSlug);

    return this.prisma.runInTenantSchema(cleanSlug, async () => {
      const servicos: any = await this.prisma.$queryRawUnsafe('SELECT * FROM servicos WHERE ativo = true ORDER BY nome ASC');
      const subservicos: any = await this.prisma.$queryRawUnsafe('SELECT * FROM subservicos WHERE ativo = true ORDER BY nome ASC');

      const result = servicos.map(s => ({
        ...s,
        subservicos: subservicos.filter(sub => sub.servico_id === s.id),
      }));

      return { servicos: result };
    });
  }

  async getPublicProfessionals(slug: string) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    await this.prisma.ensureTenantSchema(cleanSlug);

    return this.prisma.runInTenantSchema(cleanSlug, async () => {
      const profissionais: any = await this.prisma.$queryRawUnsafe('SELECT id, nome, foto_url, cargo, aceita_atendimento_externo FROM profissionais WHERE ativo = true ORDER BY nome ASC');
      return { profissionais };
    });
  }

  async createPublicAppointment(slug: string, dto: any) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    if (!tenant.agenda_publica_ativa) {
      throw new ForbiddenException('Public online scheduling is currently closed for this establishment.');
    }

    await this.prisma.ensureTenantSchema(cleanSlug);

    const cliente_nome = dto.cliente_nome || dto.nome || dto.clientName;
    const cliente_whatsapp = dto.cliente_whatsapp || dto.whatsapp || dto.telefone || dto.phone;

    const {
      profissional_id,
      servico_id,
      subservico_id,
      data_hora,
      observacao,
      tipo_atendimento,
      endereco_externo,
    } = dto;

    if (!cliente_nome || !cliente_whatsapp || !servico_id || !data_hora) {
      throw new BadRequestException('Name, WhatsApp, Service, and Date/Time are required.');
    }

    return this.prisma.runInTenantSchema(cleanSlug, async () => {
      // 1. Fetch service
      const servRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT preco, duracao_minutos FROM servicos WHERE id = $1',
        servico_id
      );
      if (!servRes || servRes.length === 0) throw new NotFoundException('Service not found.');

      let valorTotal = parseFloat(servRes[0].preco || 0);
      let duracaoTotal = parseInt(servRes[0].duracao_minutos || 60, 10);

      if (subservico_id) {
        const subRes: any = await this.prisma.$queryRawUnsafe(
          'SELECT preco_adicional, duracao_adicional_minutos FROM subservicos WHERE id = $1',
          subservico_id
        );
        if (subRes && subRes.length > 0) {
          valorTotal += parseFloat(subRes[0].preco_adicional || 0);
          duracaoTotal += parseInt(subRes[0].duracao_adicional_minutos || 0, 10);
        }
      }

      // 1.5 Auto-create or find client in `clientes` table immediately
      let clienteIdFinal = null;
      try {
        const rawPhone = String(cliente_whatsapp || '').replace(/\D/g, '');
        const phoneWith55 = rawPhone ? (rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`) : '';
        const phoneWithout55 = rawPhone ? (rawPhone.startsWith('55') ? rawPhone.slice(2) : rawPhone) : '';

        let targetProfId = profissional_id;
        if (!targetProfId) {
          const isDom = tipo_atendimento === 'domicilio' || tipo_atendimento === 'externo' || !!endereco_externo;
          let sqlProf = 'SELECT id FROM profissionais WHERE ativo = true';
          if (isDom) sqlProf += ' AND aceita_atendimento_externo = true';
          sqlProf += ' LIMIT 1';

          let profFallback: any = await this.prisma.$queryRawUnsafe(sqlProf);
          if ((!profFallback || profFallback.length === 0) && isDom) {
            profFallback = await this.prisma.$queryRawUnsafe('SELECT id FROM profissionais WHERE ativo = true LIMIT 1');
          }
          if (profFallback && profFallback.length > 0) targetProfId = profFallback[0].id;
        }

        let ruaVal = null, numeroVal = null, bairroVal = null, complementoVal = null;
        if (endereco_externo) {
          if (typeof endereco_externo === 'object') {
            ruaVal = endereco_externo.rua || null;
            numeroVal = endereco_externo.numero || null;
            bairroVal = endereco_externo.bairro || null;
            complementoVal = endereco_externo.complemento || null;
          } else if (typeof endereco_externo === 'string') {
            try {
              const parsedEnd = JSON.parse(endereco_externo);
              ruaVal = parsedEnd.rua || null;
              numeroVal = parsedEnd.numero || null;
              bairroVal = parsedEnd.bairro || null;
              complementoVal = parsedEnd.complemento || null;
            } catch (e) {}
          }
        }

        let clientQuery: any[] = [];
        if (phoneWith55 || phoneWithout55) {
          clientQuery = await this.prisma.$queryRawUnsafe(
            'SELECT id FROM clientes WHERE whatsapp = $1 OR whatsapp = $2 OR whatsapp = $3 LIMIT 1',
            phoneWith55,
            phoneWithout55,
            rawPhone
          );
        }

        if (clientQuery && clientQuery.length > 0) {
          clienteIdFinal = clientQuery[0].id;
          await this.prisma.$executeRawUnsafe(
            `UPDATE clientes 
             SET nome = $1 
             WHERE id = $2`,
            cliente_nome,
            clienteIdFinal
          );
        } else {
          try {
            const clientInsert: any = await this.prisma.$queryRawUnsafe(
              `INSERT INTO clientes (profissional_id, nome, whatsapp)
               VALUES ($1, $2, $3)
               RETURNING id`,
              targetProfId || null,
              cliente_nome,
              phoneWith55 || rawPhone || null
            );
            clienteIdFinal = clientInsert[0].id;
          } catch (eIns) {
            const retryQuery: any = await this.prisma.$queryRawUnsafe(
              'SELECT id FROM clientes WHERE whatsapp = $1 OR whatsapp = $2 LIMIT 1',
              phoneWith55,
              phoneWithout55
            );
            if (retryQuery && retryQuery.length > 0) clienteIdFinal = retryQuery[0].id;
          }
        }
      } catch (eClientCreate) {
        console.error('[IMMEDIATE CLIENT CREATION ERROR]', eClientCreate);
      }

      // Encapsulate customer details in JSON within the observation column for extra safety
      const observationJson = typeof observacao === 'string' && observacao.trim().startsWith('{')
        ? observacao
        : JSON.stringify({
            temp_cliente_nome: cliente_nome,
            temp_cliente_whatsapp: cliente_whatsapp,
            observacao_cliente: observacao || ''
          });

      // 2. Create appointment with linked cliente_id
      const apptRes: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO agendamentos (
          cliente_id, profissional_id, servico_id, subservico_id, data_hora,
          duracao_total_minutos, valor_total, status, observacao, tipo_atendimento, endereco_externo
        ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, 'aguardando_confirmacao', $8, $9, $10)
        RETURNING *`,
        clienteIdFinal,
        profissional_id || null,
        servico_id,
        subservico_id || null,
        data_hora,
        duracaoTotal,
        valorTotal,
        observationJson,
        tipo_atendimento || 'salao',
        endereco_externo || null
      );

      let serviceName = 'Serviço';
      let timeFormatted = '';

      // 3. Create database notifications for apt professionals
      try {
        const profsAptos: any = await this.prisma.$queryRawUnsafe(
          `SELECT p.id, p.aceita_atendimento_externo
           FROM profissionais p
           JOIN profissional_servicos ps ON ps.profissional_id = p.id
           WHERE p.ativo = true AND ps.servico_id = $1 AND ps.ativo = true`,
          servico_id
        );

        const dateFormatted = new Date(data_hora).toLocaleDateString('pt-BR');
        timeFormatted = new Date(data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const servNameQuery: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM servicos WHERE id = $1', servico_id);
        serviceName = servNameQuery[0]?.nome || 'Serviço';

        const isDom = tipo_atendimento === 'domicilio' || tipo_atendimento === 'externo' || !!endereco_externo;
        let endStr = '';
        if (endereco_externo) {
          if (typeof endereco_externo === 'object') {
            endStr = `${endereco_externo.rua || ''}, ${endereco_externo.numero || ''} ${endereco_externo.bairro ? `— ${endereco_externo.bairro}` : ''}`;
          } else {
            try {
              const parsed = JSON.parse(endereco_externo);
              if (typeof parsed === 'object' && parsed !== null) {
                endStr = `${parsed.rua || ''}, ${parsed.numero || ''} ${parsed.bairro ? `— ${parsed.bairro}` : ''}`;
              } else {
                endStr = String(endereco_externo);
              }
            } catch (e) {
              endStr = String(endereco_externo);
            }
          }
        }

        const notifTitle = isDom ? `🏠 Solicitação DOMICILIAR: ${cliente_nome}` : `Solicitação: ${cliente_nome}`;
        const msgText = isDom
          ? `Atendimento a DOMICÍLIO solicitado por ${cliente_nome} para ${serviceName} no dia ${dateFormatted} às ${timeFormatted}.${endStr ? ` 📍 Endereço: ${endStr}` : ''}`
          : `Nova solicitação: ${cliente_nome} agendou ${serviceName} para o dia ${dateFormatted} às ${timeFormatted}.`;

        let targetProfs = [];
        if (profissional_id) {
          targetProfs = [{ id: profissional_id }];
        } else if (tipo_atendimento === 'domicilio') {
          targetProfs = profsAptos.filter((p: any) => p.aceita_atendimento_externo === true || String(p.aceita_atendimento_externo) === 'true');
          if (targetProfs.length === 0) targetProfs = profsAptos;
        } else {
          targetProfs = profsAptos;
        }

        if (!targetProfs || targetProfs.length === 0) {
          const allProfs: any = await this.prisma.$queryRawUnsafe('SELECT id FROM profissionais WHERE ativo = true');
          targetProfs = allProfs || [];
        }

        for (const p of targetProfs) {
          try {
            await this.prisma.$queryRawUnsafe(
              `INSERT INTO notificacoes (profissional_id, titulo, mensagem, lida)
               VALUES ($1, $2, $3, false)`,
              p.id,
              notifTitle,
              msgText
            );
          } catch (notifDbErr) {
            console.error('[DB NOTIFICATION INSERT ERROR]', notifDbErr);
          }

          // Notificar via WhatsApp em bloco assíncrono 100% isolado
          (async () => {
            try {
              const pRes: any = await this.prisma.$queryRawUnsafe('SELECT whatsapp, telefone FROM profissionais WHERE id = $1', p.id);
              let profWhatsapp = pRes[0]?.whatsapp || pRes[0]?.telefone;

              // Fallback: se o profissional não tiver telefone no perfil, envia para o WhatsApp do proprietário
              if (!profWhatsapp) {
                const ownerRes: any = await this.prisma.$queryRawUnsafe(
                  "SELECT whatsapp, telefone FROM profissionais WHERE cargo = 'proprietario' LIMIT 1"
                );
                if (ownerRes && ownerRes.length > 0) {
                  profWhatsapp = ownerRes[0]?.whatsapp || ownerRes[0]?.telefone;
                }
              }

              if (profWhatsapp) {
                let customTemplate: string | null = null;
                try {
                  const flowRows: any = await this.prisma.$queryRawUnsafe("SELECT valor FROM configuracoes WHERE chave = 'bot_flow'");
                  const flowObj = flowRows[0]?.valor || {};
                  const triggerNode = Array.isArray(flowObj?.nodes) ? flowObj.nodes.find((n: any) => n.type === 'trigger') : null;
                  customTemplate = triggerNode?.config?.text || triggerNode?.config?.alertMessage || null;
                } catch (eFlow) {}

                let profWaMsg = '';
                if (customTemplate && customTemplate.trim() !== '') {
                  profWaMsg = customTemplate
                    .replace(/{cliente}/g, cliente_nome)
                    .replace(/{cliente_nome}/g, cliente_nome)
                    .replace(/{cliente_telefone}/g, cliente_whatsapp || '')
                    .replace(/{servico}/g, serviceName)
                    .replace(/{data}/g, dateFormatted)
                    .replace(/{hora}/g, timeFormatted)
                    .replace(/{horario}/g, timeFormatted)
                    .replace(/{tipo_atendimento}/g, isDom ? 'Atendimento a Domicílio 🏠' : 'Atendimento no Salão 💈')
                    .replace(/{endereco}/g, endStr || 'No estabelecimento');
                } else {
                  profWaMsg = `🚨 *Novo Agendamento Solicitado na Agenda Pública!*\n\n` +
                    `👤 *Cliente:* ${cliente_nome}\n` +
                    (cliente_whatsapp ? `📱 *Contato:* ${cliente_whatsapp}\n` : '') +
                    `💈 *Serviço:* ${serviceName}\n` +
                    `📅 *Data:* ${dateFormatted} às ${timeFormatted}\n` +
                    `🏠 *Tipo:* ${isDom ? 'Atendimento a Domicílio' : 'Atendimento no Salão'}\n` +
                    (endStr ? `📍 *Endereço:* ${endStr}\n` : '') +
                    `\n*Acesse o aplicativo Acionar para Aceitar ou Recusar.*`;
                }

                const resSend = await this.whatsappService.sendTextMessage(cleanSlug, profWhatsapp, profWaMsg);
                console.log(`[WHATSAPP PROF DISPATCH RESULT] for prof ${p.id} (phone: ${profWhatsapp}):`, resSend);
              } else {
                console.warn(`[WHATSAPP DISPATCH SKIP] No phone number registered for professional ${p.id} or owner.`);
              }
            } catch (waProfErr) {
              console.warn('[WHATSAPP DISPATCH ERROR]', waProfErr);
            }
          })();
        }
      } catch (e) {
        console.error('[NESTJS DATABASE NOTIFICATION ERROR]', e);
      }

      // Notificação Web Push para celulares/navegadores (Livre de dependência do WhatsApp)
      try {
        await this.notificationsService.sendAppointmentPush(cleanSlug, apptRes[0].id);
      } catch (err) {
        console.error('Failed to trigger public appointment push notification:', err);
      }

      // Transmissão Websocket em tempo real para os celulares conectados (Livre de dependência do WhatsApp)
      try {
        this.notificationsGateway.broadcastToTenant(cleanSlug, 'appointments-changed', {
          action: 'create',
          id: apptRes[0].id,
          status: apptRes[0].status
        });
        this.notificationsGateway.broadcastToTenant(cleanSlug, 'notifications-changed', {
          action: 'create',
          type: 'appointment_requested',
          cliente: cliente_nome,
          servico: serviceName,
          horario: timeFormatted
        });
      } catch (socketErr) {
        console.error('[SOCKET BROADCAST ERROR]', socketErr);
      }

      return {
        message: 'Appointment requested successfully.',
        agendamento: apptRes[0],
      };
    });
  }

  async handleAsaasWebhook(body: any) {
    try {
      const event = body?.event;
      const payment = body?.payment || body;
      const externalReference = payment?.externalReference;

      console.log(`[ASAAS NEST WEBHOOK] Received event ${event} for externalReference ${externalReference}`);

      if (!event || !externalReference) {
        return { ok: true, message: 'Missing event or externalReference, ignored.' };
      }

      if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'CHECKOUT_PAID', 'PIX_CREDIT_RECEIVED'].includes(event)) {
        if (externalReference.includes('_')) {
          const parts = externalReference.split('_');
          const tenantSlug = parts[0].toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
          const appointmentId = parseInt(parts[1], 10);

          if (!isNaN(appointmentId)) {
            await this.prisma.ensureTenantSchema(tenantSlug);
            await this.prisma.runInTenantSchema(tenantSlug, async () => {
              const agQuery: any = await this.prisma.$queryRawUnsafe(
                `SELECT a.id, a.valor_total, a.data_hora, a.profissional_id,
                        c.nome as cliente_nome, s.nome as servico_nome
                 FROM agendamentos a
                 LEFT JOIN clientes c ON a.cliente_id = c.id
                 LEFT JOIN servicos s ON a.servico_id = s.id
                 WHERE a.id = $1`,
                appointmentId
              );

              if (agQuery && agQuery.length > 0) {
                const ag = agQuery[0];
                const checkFc: any = await this.prisma.$queryRawUnsafe('SELECT id FROM fluxo_caixa WHERE agendamento_id = $1', appointmentId);

                const billingType = payment.billingType || 'PIX';
                const formaPagamento = String(billingType).toUpperCase() === 'PIX' ? 'pix' : 'cartao_credito';
                const descricao = `Atendimento — ${ag.cliente_nome || 'Cliente'} / ${ag.servico_nome || 'Serviço'}`;
                const dataMovimento = new Date(ag.data_hora).toISOString().split('T')[0];

                if (!checkFc || checkFc.length === 0) {
                  await this.prisma.$queryRawUnsafe(
                    `INSERT INTO fluxo_caixa (agendamento_id, profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento)
                     VALUES ($1, $2, 'entrada', 'agendamento', $3, $4, 'pago', $5, $6::date)`,
                    appointmentId, ag.profissional_id, descricao, ag.valor_total ?? 0, formaPagamento, dataMovimento
                  );
                  console.log(`[ASAAS NEST WEBHOOK] Created cashflow entry for tenant ${tenantSlug}, appointment ${appointmentId}`);
                } else {
                  await this.prisma.$queryRawUnsafe(
                    `UPDATE fluxo_caixa SET status = 'pago', forma_pagamento = $1, valor = $2 WHERE agendamento_id = $3`,
                    formaPagamento, ag.valor_total ?? 0, appointmentId
                  );
                  console.log(`[ASAAS NEST WEBHOOK] Updated cashflow entry to paid for tenant ${tenantSlug}, appointment ${appointmentId}`);
                }

                await this.prisma.$queryRawUnsafe(
                  `UPDATE agendamentos SET status = 'confirmado' WHERE id = $1 AND status = 'aguardando_confirmacao'`,
                  appointmentId
                );
              }
            });
          }
        }
      }

      return { ok: true };
    } catch (err) {
      console.error('[ASAAS NEST WEBHOOK ERROR]', err);
      return { ok: false, error: err.message };
    }
  }

  async confirmQuickAppointment(slug: string, appointmentId: number, queryParams?: { clienteNome?: string; whatsapp?: string }) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    await this.prisma.ensureTenantSchema(cleanSlug);

    return this.prisma.runInTenantSchema(cleanSlug, async () => {
      const agRows: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM agendamentos WHERE id = $1',
        appointmentId
      );

      if (!agRows || agRows.length === 0) return { ok: false, message: 'Appointment not found' };
      const agendamento = agRows[0];

      let newClienteId = agendamento.cliente_id;

      if (!agendamento.cliente_id) {
        try {
          let tempClientData: any = null;
          if (agendamento.observacao) {
            if (typeof agendamento.observacao === 'object' && agendamento.observacao.temp_cliente_nome) {
              tempClientData = agendamento.observacao;
            } else if (typeof agendamento.observacao === 'string') {
              try {
                const parsed = JSON.parse(agendamento.observacao);
                if (parsed && parsed.temp_cliente_nome) tempClientData = parsed;
              } catch (e) {}
            }
          }

          const fallbackNome = queryParams?.clienteNome || 'Cliente';
          const fallbackWhatsapp = queryParams?.whatsapp || '';

          const nomeFinal = tempClientData?.temp_cliente_nome || fallbackNome;
          const whatsappClean = String(tempClientData?.temp_cliente_whatsapp || fallbackWhatsapp || '').trim();

          if (nomeFinal) {

            let ruaVal = null;
            let numeroVal = null;
            let bairroVal = null;
            let complementoVal = null;

            if (agendamento.endereco_externo) {
              if (typeof agendamento.endereco_externo === 'object') {
                ruaVal = agendamento.endereco_externo.rua || null;
                numeroVal = agendamento.endereco_externo.numero || null;
                bairroVal = agendamento.endereco_externo.bairro || null;
                complementoVal = agendamento.endereco_externo.complemento || null;
              } else if (typeof agendamento.endereco_externo === 'string') {
                try {
                  const parsedEnd = JSON.parse(agendamento.endereco_externo);
                  ruaVal = parsedEnd.rua || null;
                  numeroVal = parsedEnd.numero || null;
                  bairroVal = parsedEnd.bairro || null;
                  complementoVal = parsedEnd.complemento || null;
                } catch (e) {}
              }
            }

            const rawPhone = String(whatsappClean || '').replace(/\D/g, '');
            const phoneWith55 = rawPhone ? (rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`) : '';
            const phoneWithout55 = rawPhone ? (rawPhone.startsWith('55') ? rawPhone.slice(2) : rawPhone) : '';

            let clientQuery: any[] = [];
            if (phoneWith55 || phoneWithout55) {
              clientQuery = await this.prisma.$queryRawUnsafe(
                'SELECT id FROM clientes WHERE whatsapp = $1 OR whatsapp = $2 OR whatsapp = $3 LIMIT 1',
                phoneWith55,
                phoneWithout55,
                rawPhone
              );
            }

            if (clientQuery && clientQuery.length > 0) {
              newClienteId = clientQuery[0].id;
              await this.prisma.$executeRawUnsafe(
                `UPDATE clientes 
                 SET nome = $1 
                 WHERE id = $2`,
                nomeFinal,
                newClienteId
              );
            } else {
              let targetProfId = agendamento.profissional_id;
              if (!targetProfId) {
                const profFallback: any = await this.prisma.$queryRawUnsafe('SELECT id FROM profissionais WHERE ativo = true LIMIT 1');
                if (profFallback && profFallback.length > 0) targetProfId = profFallback[0].id;
              }

              try {
                const clientInsert: any = await this.prisma.$queryRawUnsafe(
                  `INSERT INTO clientes (profissional_id, nome, whatsapp)
                   VALUES ($1, $2, $3)
                   RETURNING id`,
                  targetProfId || null,
                  nomeFinal,
                  phoneWith55 || rawPhone || null
                );
                newClienteId = clientInsert[0].id;
              } catch (eIns) {
                const retryQuery: any = await this.prisma.$queryRawUnsafe(
                  'SELECT id FROM clientes WHERE whatsapp = $1 OR whatsapp = $2 LIMIT 1',
                  phoneWith55,
                  phoneWithout55
                );
                if (retryQuery && retryQuery.length > 0) {
                  newClienteId = retryQuery[0].id;
                }
              }
            }
          }
        } catch (eClient) {
          console.error('[QUICK CONFIRM CLIENT REGISTRATION ERROR]', eClient);
        }
      }

      let targetProfId = agendamento.profissional_id;
      if (!targetProfId) {
        const isDom = agendamento.tipo_atendimento === 'domicilio' || agendamento.tipo_atendimento === 'externo' || !!agendamento.endereco_externo;
        let sqlProf = 'SELECT id FROM profissionais WHERE ativo = true';
        if (isDom) sqlProf += ' AND aceita_atendimento_externo = true';
        sqlProf += ' LIMIT 1';

        let profFallback: any = await this.prisma.$queryRawUnsafe(sqlProf);
        if ((!profFallback || profFallback.length === 0) && isDom) {
          profFallback = await this.prisma.$queryRawUnsafe('SELECT id FROM profissionais WHERE ativo = true LIMIT 1');
        }
        if (profFallback && profFallback.length > 0) targetProfId = profFallback[0].id;
      }

      const updated: any = await this.prisma.$queryRawUnsafe(
        `UPDATE agendamentos 
         SET status = 'confirmado', 
             profissional_id = COALESCE(profissional_id, $3),
             cliente_id = COALESCE($2, cliente_id)
         WHERE id = $1 
         RETURNING *`,
        appointmentId,
        newClienteId || null,
        targetProfId || null
      );

      // Trigger websocket update
      try {
        this.notificationsGateway.broadcastToTenant(cleanSlug, 'appointments-changed', {
          action: 'update',
          id: appointmentId,
          status: 'confirmado'
        });
      } catch (e) {}

      let msgConfig = null;
      try {
        const msgRows: any = await this.prisma.$queryRawUnsafe("SELECT valor FROM configuracoes WHERE chave = $1", 'mensagens');
        if (msgRows && msgRows.length > 0) msgConfig = msgRows[0].valor;
      } catch(e) {}

      let servicoNome = 'Serviço';
      try {
        if (updated[0]?.servico_id) {
          const svcRows: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM servicos WHERE id = $1', updated[0].servico_id);
          if (svcRows && svcRows.length > 0) servicoNome = svcRows[0].nome;
        }
      } catch(e) {}

      let tempClientDataFallback: any = null;
      if (updated[0]?.observacao) {
        if (typeof updated[0].observacao === 'object' && updated[0].observacao.temp_cliente_nome) {
          tempClientDataFallback = updated[0].observacao;
        } else if (typeof updated[0].observacao === 'string') {
          try {
            const parsed = JSON.parse(updated[0].observacao);
            if (parsed && parsed.temp_cliente_nome) tempClientDataFallback = parsed;
          } catch (e) {}
        }
      }
      const nomeFinal = tempClientDataFallback?.temp_cliente_nome || queryParams?.clienteNome || 'Cliente';
      const whatsappClean = String(tempClientDataFallback?.temp_cliente_whatsapp || queryParams?.whatsapp || '').trim();

      return { 
        ok: true, 
        agendamento: updated[0],
        messageConfig: msgConfig || null,
        clienteNome: nomeFinal || updated[0]?.cliente_nome || queryParams?.clienteNome || 'Cliente',
        whatsappPhone: whatsappClean || queryParams?.whatsapp || '',
        servicoNome
      };
    });
  }

  async handleWhatsappWebhook(payload: any) {
    if (payload.event !== 'messages.upsert') {
      return { ok: true, skipped: true, reason: 'event_ignored' };
    }

    const instance = payload.instance;
    const data = payload.data;
    if (!instance || !data || !data.key) {
      return { ok: false, error: 'invalid_payload' };
    }

    if (data.key.fromMe) {
      return { ok: true, skipped: true, reason: 'message_from_me' };
    }

    const remoteJid = data.key.remoteJid;
    if (!remoteJid || !remoteJid.endsWith('@s.whatsapp.net')) {
      return { ok: true, skipped: true, reason: 'not_a_user_message' };
    }

    const cleanPhone = remoteJid.split('@')[0];
    const phoneWithoutCountry = cleanPhone.startsWith('55') ? cleanPhone.substring(2) : cleanPhone;

    let textMessage = '';
    if (data.message?.conversation) {
      textMessage = data.message.conversation;
    } else if (data.message?.extendedTextMessage?.text) {
      textMessage = data.message.extendedTextMessage.text;
    }

    const command = textMessage.trim();
    if (command !== '1' && command !== '2') {
      return { ok: true, skipped: true, reason: 'not_a_chatbot_command' };
    }

    const tenantSlug = instance.replace(/^tenant_/, '');
    await this.prisma.ensureTenantSchema(tenantSlug);

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const clients: any = await this.prisma.$queryRawUnsafe(
        "SELECT id FROM clientes WHERE regexp_replace(whatsapp, '\\D', '', 'g') IN ($1, $2) OR whatsapp IN ($3, $4)",
        cleanPhone,
        phoneWithoutCountry,
        cleanPhone,
        phoneWithoutCountry
      );

      if (!clients || clients.length === 0) {
        return { ok: false, error: 'client_not_found' };
      }

      const clientIds = clients.map((c: any) => c.id);
      const placeholders = clientIds.map((_, idx) => `$${idx + 1}`).join(',');
      const agRows: any = await this.prisma.$queryRawUnsafe(
        `SELECT id, status, data_hora 
         FROM agendamentos 
         WHERE cliente_id IN (${placeholders}) 
           AND status IN ('solicitado', 'agendado') 
         ORDER BY data_hora DESC 
         LIMIT 1`,
        ...clientIds
      );

      if (!agRows || agRows.length === 0) {
        return { ok: false, error: 'appointment_not_found' };
      }

      const agendamento = agRows[0];
      const novoStatus = command === '1' ? 'agendado' : 'cancelado';

      await this.prisma.$executeRawUnsafe(
        "UPDATE agendamentos SET status = $1, updated_at = NOW() WHERE id = $2",
        novoStatus,
        agendamento.id
      );

      this.notificationsGateway.broadcastToTenant(tenantSlug, 'appointments-changed', {
        id: agendamento.id,
        status: novoStatus,
      });

      return { ok: true, appointmentId: agendamento.id, status: novoStatus };
    });
  }

  async getEvaluationStatus(tenantSlug: string, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const apptRows: any = await this.prisma.$queryRawUnsafe(
        `SELECT a.id, a.status, a.observacao, a.cliente_id, c.nome as cliente_nome, p.nome as profissional_nome, s.nome as servico_nome
         FROM agendamentos a
         LEFT JOIN clientes c ON a.cliente_id = c.id
         LEFT JOIN profissionais p ON a.profissional_id = p.id
         LEFT JOIN servicos s ON a.servico_id = s.id
         WHERE a.id = $1`,
        id
      );

      if (!apptRows || apptRows.length === 0) {
        return { eligible: false, message: 'Agendamento não encontrado.' };
      }

      const appt = apptRows[0];

      let clienteNome = appt.cliente_nome;
      if (!appt.cliente_id && appt.observacao) {
        try {
          const obs = typeof appt.observacao === 'object' ? appt.observacao : JSON.parse(appt.observacao);
          if (obs && obs.temp_cliente_nome) {
            clienteNome = obs.temp_cliente_nome;
          }
        } catch (e) {}
      }

      // Verificar se já foi avaliado
      const evalRows: any = await this.prisma.$queryRawUnsafe(
        'SELECT id FROM avaliacoes WHERE agendamento_id = $1',
        id
      );

      const jaAvaliado = evalRows && evalRows.length > 0;

      return {
        eligible: ['concluido', 'atendido'].includes(appt.status) && !jaAvaliado,
        cliente_nome: clienteNome || 'Cliente',
        profissional_nome: appt.profissional_nome || 'Profissional',
        servico_nome: appt.servico_nome || 'Atendimento',
        ja_avaliado: jaAvaliado,
        status: appt.status
      };
    });
  }

  async submitEvaluation(tenantSlug: string, id: number, body: any) {
    const { nota, comentario } = body;
    if (!nota || nota < 1 || nota > 5) {
      throw new BadRequestException('A nota deve ser entre 1 e 5.');
    }

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      // 1. Verificar elegibilidade
      const statusCheck = await this.getEvaluationStatus(tenantSlug, id);
      if (!statusCheck.eligible) {
        throw new BadRequestException(
          statusCheck.ja_avaliado
            ? 'Este agendamento já foi avaliado.'
            : 'Este agendamento não está qualificado para avaliação.'
        );
      }

      // 2. Inserir a avaliação
      await this.prisma.$executeRawUnsafe(
        'INSERT INTO avaliacoes (agendamento_id, nota, comentario) VALUES ($1, $2, $3)',
        id,
        parseInt(nota, 10),
        comentario || null
      );

      return { success: true, message: 'Avaliação enviada com sucesso! Obrigado pelo feedback.' };
    });
  }
}

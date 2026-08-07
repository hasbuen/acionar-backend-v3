import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
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

    const {
      cliente_nome,
      cliente_whatsapp,
      cliente_email,
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

      // Encapsulate temporary customer details in JSON within the observation column
      const observationJson = JSON.stringify({
        temp_cliente_nome: cliente_nome,
        temp_cliente_whatsapp: cliente_whatsapp,
        temp_cliente_email: cliente_email || null,
        observacao_cliente: observacao || ''
      });

      // 2. Create appointment with NULL cliente_id
      const apptRes: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO agendamentos (
          cliente_id, profissional_id, servico_id, subservico_id, data_hora,
          duracao_total_minutos, valor_total, status, observacao, tipo_atendimento, endereco_externo
        ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, 'aguardando_confirmacao', $8, $9, $10)
        RETURNING *`,
        null, // Defer formal client creation
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
        const timeFormatted = new Date(data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const servNameQuery: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM servicos WHERE id = $1', servico_id);
        const serviceName = servNameQuery[0]?.nome || 'Serviço';
        const msgText = `Nova solicitação: ${cliente_nome} agendou ${serviceName} para o dia ${dateFormatted} às ${timeFormatted}.`;

        let targetProfs = [];
        if (profissional_id) {
          targetProfs = [{ id: profissional_id }];
        } else if (tipo_atendimento === 'domicilio') {
          targetProfs = profsAptos.filter((p: any) => p.aceita_atendimento_externo === true || String(p.aceita_atendimento_externo) === 'true');
        } else {
          targetProfs = profsAptos;
        }

        for (const p of targetProfs) {
          await this.prisma.$queryRawUnsafe(
            `INSERT INTO notificacoes (profissional_id, titulo, mensagem, lida)
             VALUES ($1, 'Solicitação Pendente', $2, false)`,
            p.id,
            msgText
          );
        }
      } catch (e) {
        console.error('[NESTJS DATABASE NOTIFICATION ERROR]', e);
      }

      try {
        await this.notificationsService.sendAppointmentPush(cleanSlug, apptRes[0].id);
      } catch (err) {
        console.error('Failed to trigger public appointment push notification:', err);
      }

      // Trigger real-time websocket synchronization
      try {
        this.notificationsGateway.broadcastToTenant(cleanSlug, 'appointments-changed', {
          action: 'create',
          id: apptRes[0].id,
          status: apptRes[0].status
        });
        this.notificationsGateway.broadcastToTenant(cleanSlug, 'notifications-changed', {
          action: 'create',
          type: 'appointment_requested'
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

  async confirmQuickAppointment(slug: string, appointmentId: number) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    await this.prisma.ensureTenantSchema(cleanSlug);

    return this.prisma.runInTenantSchema(cleanSlug, async () => {
      const updated: any = await this.prisma.$queryRawUnsafe(
        `UPDATE agendamentos 
         SET status = 'agendado' 
         WHERE id = $1 
         RETURNING *`,
        appointmentId
      );

      // Trigger websocket update
      try {
        this.notificationsGateway.broadcastToTenant(cleanSlug, 'appointments-changed', {
          action: 'update',
          id: appointmentId,
          status: 'agendado'
        });
      } catch (e) {}

      return { ok: true, agendamento: updated[0] };
    });
  }
}


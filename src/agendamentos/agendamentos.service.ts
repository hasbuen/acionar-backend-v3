import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';


@Injectable()
export class AgendamentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async findAll(tenantSlug: string, user: any, query: any) {
    const { data_inicio, data_fim, status, profissional_id } = query;
    await this.prisma.ensureTenantSchema(tenantSlug);

    const profIdFilter = profissional_id || user?.profissional_id;

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      let sql = `
        SELECT a.*,
               c.nome as cliente_nome, c.whatsapp as cliente_whatsapp,
               p.nome as profissional_nome,
               s.nome as servico_nome
        FROM agendamentos a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        LEFT JOIN profissionais p ON a.profissional_id = p.id
        LEFT JOIN servicos s ON a.servico_id = s.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (data_inicio) {
        params.push(data_inicio);
        sql += ` AND a.data_hora >= $${params.length}::timestamptz`;
      }
      if (data_fim) {
        params.push(data_fim);
        sql += ` AND a.data_hora <= $${params.length}::timestamptz`;
      }
      if (status) {
        if (status === 'confirmado' || status === 'agendado') {
          sql += ` AND (a.status = 'confirmado' OR a.status = 'agendado')`;
        } else {
          params.push(status);
          sql += ` AND a.status = $${params.length}`;
        }
      }
      if (profIdFilter) {
        params.push(profIdFilter);
        sql += ` AND (a.profissional_id = $${params.length} OR a.profissional_id IS NULL)`;
      }

      sql += ' ORDER BY a.data_hora ASC';

      const resRows: any = await this.prisma.$queryRawUnsafe(sql, ...params);

      const formattedAgendamentos = resRows.map(item => {
        if (!item.cliente_id && item.observacao && item.observacao.startsWith('{"temp_cliente_nome"')) {
          try {
            const temp = JSON.parse(item.observacao);
            return {
              ...item,
              cliente_nome: temp.temp_cliente_nome,
              cliente_whatsapp: temp.temp_cliente_whatsapp,
              cliente_email: temp.temp_cliente_email,
              observacao: temp.observacao_cliente || ''
            };
          } catch (e) {
            // Ignore parse errors
          }
        }
        return item;
      });

      return { agendamentos: formattedAgendamentos };
    });
  }


  async create(tenantSlug: string, user: any, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const {
        cliente_id, profissional_id, servico_id, subservico_id,
        data_hora, valor_total, observacao, tipo_atendimento, endereco_externo, status
      } = dto;

      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO agendamentos (
          cliente_id, profissional_id, servico_id, subservico_id,
          data_hora, valor_total, observacao, tipo_atendimento, endereco_externo, status
        ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::numeric, $7, $8, $9, $10) RETURNING *`,
        cliente_id || null,
        profissional_id || user.profissional_id,
        servico_id,
        subservico_id || null,
        data_hora,
        valor_total || 0,
        observacao || null,
        tipo_atendimento || 'salao',
        endereco_externo || null,
        status || 'agendado'
      );

      try {
        await this.notificationsService.sendAppointmentPush(tenantSlug, res[0].id);
      } catch (err) {
        console.error('Failed to trigger appointment push notification:', err);
      }

      // Trigger real-time websocket synchronization
      try {
        this.notificationsGateway.broadcastToTenant(tenantSlug, 'appointments-changed', {
          action: 'create',
          id: res[0].id,
          status: res[0].status
        });
      } catch (socketErr) {
        console.error('[SOCKET BROADCAST ERROR]', socketErr);
      }

      return { agendamento: res[0] };
    });
  }

  async update(tenantSlug: string, id: number, dto: any, user?: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const { status, data_hora, valor_total, observacao, profissional_id, endereco_externo } = dto;

      const agendRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM agendamentos WHERE id = $1',
        id,
      );

      if (!agendRes || agendRes.length === 0) throw new NotFoundException('Appointment not found.');

      const agendamento = agendRes[0];

      // Verificação de concorrência: se o agendamento já foi aceito por outro profissional
      if (
        (status === 'agendado' || status === 'confirmado') && 
        (agendamento.status === 'agendado' || agendamento.status === 'confirmado') &&
        agendamento.profissional_id &&
        agendamento.profissional_id !== user?.profissional_id
      ) {
        const profRes: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM profissionais WHERE id = $1', agendamento.profissional_id);
        const profNome = profRes && profRes.length > 0 ? profRes[0].nome : 'outro usuário';
        throw new ForbiddenException(`Atenção: Este agendamento já foi aceito pelo usuário ${profNome}. A tela será atualizada.`);
      }

      let finalProfId = profissional_id || agendamento.profissional_id;

      // Se for aceite de solicitação pública sem profissional, atribui automaticamente ao profissional logado
      if ((status === 'agendado' || status === 'confirmado') && !profissional_id && !agendamento.profissional_id) {
        if (user?.profissional_id) {
          finalProfId = user.profissional_id;
        }
      }

      let finalClienteId = agendamento.cliente_id;
      let finalObservacao = observacao;
      let targetProfId = finalProfId || user?.profissional_id;

      if (!targetProfId) {
        const profFallback: any = await this.prisma.$queryRawUnsafe('SELECT id FROM profissionais WHERE ativo = true LIMIT 1');
        if (profFallback && profFallback.length > 0) targetProfId = profFallback[0].id;
      }

      let tempClientData: any = null;
      if (agendamento.observacao) {
        if (typeof agendamento.observacao === 'object' && agendamento.observacao.temp_cliente_nome) {
          tempClientData = agendamento.observacao;
        } else if (typeof agendamento.observacao === 'string') {
          try {
            const parsed = JSON.parse(agendamento.observacao);
            if (parsed && parsed.temp_cliente_nome) {
              tempClientData = parsed;
            }
          } catch (e) {}
        }
      }

      // Se for aceite de solicitação pública com cliente pendente, cadastra formalmente no banco
      if ((status === 'agendado' || status === 'confirmado') && !agendamento.cliente_id && tempClientData && tempClientData.temp_cliente_nome) {
        try {
          const whatsappClean = String(tempClientData.temp_cliente_whatsapp || '').trim();

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

          let clientQuery: any[] = [];
          if (whatsappClean) {
            clientQuery = await this.prisma.$queryRawUnsafe(
              'SELECT id FROM clientes WHERE whatsapp = $1 LIMIT 1',
              whatsappClean
            );
          }

          if (clientQuery && clientQuery.length > 0) {
            const existingId = clientQuery[0].id;
            await this.prisma.$executeRawUnsafe(
              `UPDATE clientes 
               SET nome = $1, 
                   email = COALESCE($2, email), 
                   rua = COALESCE($3, rua),
                   numero = COALESCE($4, numero),
                   bairro = COALESCE($5, bairro),
                   complemento = COALESCE($6, complemento),
                   profissional_id = COALESCE(profissional_id, $7) 
               WHERE id = $8`,
              tempClientData.temp_cliente_nome || 'Cliente',
              tempClientData.temp_cliente_email || null,
              ruaVal || null,
              numeroVal || null,
              bairroVal || null,
              complementoVal || null,
              targetProfId || null,
              existingId
            );
            finalClienteId = existingId;
          } else {
            const clientInsert: any = await this.prisma.$queryRawUnsafe(
              `INSERT INTO clientes (profissional_id, nome, whatsapp, email, rua, numero, bairro, complemento)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               RETURNING id`,
              targetProfId || null,
              tempClientData.temp_cliente_nome || 'Cliente',
              whatsappClean || null,
              tempClientData.temp_cliente_email || null,
              ruaVal || null,
              numeroVal || null,
              bairroVal || null,
              complementoVal || null
            );
            finalClienteId = clientInsert[0].id;
          }

          finalObservacao = tempClientData.observacao_cliente || '';
        } catch (e) {
          console.error('[NESTJS FORMAL CLIENT CREATION ERROR]', e);
        }
      }

      if (agendamento.cliente_id && targetProfId) {
        const clientRows: any = await this.prisma.$queryRawUnsafe(
          'SELECT * FROM clientes WHERE id = $1',
          agendamento.cliente_id,
        );
        if (clientRows && clientRows.length > 0) {
          const cliente = clientRows[0];
          if (cliente.profissional_id !== targetProfId) {
            const existingForProf: any = await this.prisma.$queryRawUnsafe(
              'SELECT id FROM clientes WHERE whatsapp = $1 AND profissional_id = $2 LIMIT 1',
              cliente.whatsapp || '',
              targetProfId,
            );
            if (existingForProf && existingForProf.length > 0) {
              finalClienteId = existingForProf[0].id;
            } else {
              const newC: any = await this.prisma.$queryRawUnsafe(
                'INSERT INTO clientes (profissional_id, nome, whatsapp, email, observacoes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                targetProfId,
                cliente.nome,
                cliente.whatsapp || null,
                cliente.email || null,
                cliente.observacoes || null,
              );
              finalClienteId = newC[0].id;
            }
          }
        }
      }

      let finalEnderecoExterno = agendamento.endereco_externo;
      if (endereco_externo !== undefined && endereco_externo !== null) {
        finalEnderecoExterno = typeof endereco_externo === 'object' ? JSON.stringify(endereco_externo) : String(endereco_externo);

        if (finalClienteId) {
          let ruaVal = null, numeroVal = null, bairroVal = null, complementoVal = null;
          if (typeof endereco_externo === 'object') {
            ruaVal = endereco_externo.rua || null;
            numeroVal = endereco_externo.numero || null;
            bairroVal = endereco_externo.bairro || null;
            complementoVal = endereco_externo.complemento || null;
          } else {
            try {
              const parsed = JSON.parse(endereco_externo);
              ruaVal = parsed.rua || null;
              numeroVal = parsed.numero || null;
              bairroVal = parsed.bairro || null;
              complementoVal = parsed.complemento || null;
            } catch (e) {}
          }
          await this.prisma.$executeRawUnsafe(
            `UPDATE clientes 
             SET rua = COALESCE($1, rua),
                 numero = COALESCE($2, numero),
                 bairro = COALESCE($3, bairro),
                 complemento = COALESCE($4, complemento)
             WHERE id = $5`,
            ruaVal, numeroVal, bairroVal, complementoVal, finalClienteId
          );
        }
      }

      // Atualizar agendamento
      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE agendamentos
         SET status = COALESCE($1, status),
             data_hora = CASE WHEN $2::text IS NOT NULL THEN $2::timestamptz ELSE data_hora END,
             valor_total = COALESCE($3::numeric, valor_total),
             observacao = COALESCE($4, observacao),
             profissional_id = COALESCE($5, profissional_id),
             cliente_id = COALESCE($6, cliente_id),
             endereco_externo = COALESCE($7, endereco_externo),
             updated_at = NOW()
         WHERE id = $8 RETURNING *`,
        status !== undefined ? status : null,
        data_hora !== undefined && data_hora !== '' ? data_hora : null,
        valor_total !== undefined ? valor_total : null,
        finalObservacao !== undefined ? finalObservacao : null,
        finalProfId !== undefined ? finalProfId : null,
        finalClienteId,
        finalEnderecoExterno !== undefined ? finalEnderecoExterno : null,
        id,
      );

      // Notification for transfer
      if (finalProfId && finalProfId !== agendamento.profissional_id && finalProfId !== user?.profissional_id) {
        let nomeRemetente = user?.nome;
        if (!nomeRemetente && user?.profissional_id) {
          const senderRes: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM profissionais WHERE id = $1', user.profissional_id);
          if (senderRes && senderRes.length > 0) nomeRemetente = senderRes[0].nome;
        }
        if (!nomeRemetente) nomeRemetente = 'Um colega';

        let clienteNome = '';
        if (finalClienteId) {
          const cRes: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM clientes WHERE id = $1', finalClienteId);
          if (cRes && cRes.length > 0) clienteNome = cRes[0].nome;
        }
        if (!clienteNome && agendamento.cliente_id) {
          const cRes: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM clientes WHERE id = $1', agendamento.cliente_id);
          if (cRes && cRes.length > 0) clienteNome = cRes[0].nome;
        }
        if (!clienteNome && agendamento.observacao && agendamento.observacao.startsWith('{"temp_cliente_nome"')) {
          try {
            const temp = JSON.parse(agendamento.observacao);
            clienteNome = temp.temp_cliente_nome;
          } catch (e) {}
        }
        if (!clienteNome) clienteNome = 'Cliente';

        const titulo = 'Agendamento Recebido';
        const mensagem = `O usuário ${nomeRemetente} transferiu o agendamento do cliente ${clienteNome} para a sua agenda.`;

        const insertedNotif: any = await this.prisma.$queryRawUnsafe(
          `INSERT INTO notificacoes (profissional_id, titulo, mensagem) VALUES ($1, $2, $3) RETURNING id, titulo, mensagem, lida, created_at`,
          finalProfId, titulo, mensagem
        );
        if (insertedNotif && insertedNotif.length > 0) {
          this.notificationsGateway.emitToUser(finalProfId, 'notifications-changed', { ...insertedNotif[0], profissional_id: finalProfId });
        }
      }

      // Se status mudou para "concluido", consumir produtos
      if (status === 'concluido' && agendamento.status !== 'concluido' && !agendamento.estoque_consumido) {
        await this.consumirProdutosAgendamento(tenantSlug, agendamento, profissional_id || agendamento.profissional_id);
      }

      // Criar notificações em-app para outros profissionais no caso de aceite de solicitação
      const updatedAg = res[0];
      const wasPending = agendamento && ['aguardando_confirmacao', 'solicitado', 'pendente'].includes(agendamento.status);
      const isAccepted = ['agendado', 'confirmado'].includes(updatedAg.status);

      if (wasPending && isAccepted) {
        try {
          let clientName = '';
          if (updatedAg.cliente_id) {
            const clRes: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM clientes WHERE id = $1', updatedAg.cliente_id);
            if (clRes && clRes.length > 0) clientName = clRes[0].nome;
          }
          if (!clientName && agendamento.observacao && agendamento.observacao.startsWith('{"temp_cliente_nome"')) {
            try {
              const temp = JSON.parse(agendamento.observacao);
              clientName = temp.temp_cliente_nome;
            } catch (e) {}
          }
          if (!clientName) clientName = 'Cliente';

          let profName = user?.nome;
          if (!profName && user?.profissional_id) {
            const profRes: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM profissionais WHERE id = $1', user.profissional_id);
            if (profRes && profRes.length > 0) profName = profRes[0].nome;
          }
          if (!profName) profName = 'Profissional';

          const msgText = `O usuário ${profName} aceitou o agendamento do cliente ${clientName}.`;

          // Notificar todos os outros profissionais ativos
          const others: any = await this.prisma.$queryRawUnsafe('SELECT id FROM profissionais WHERE ativo = true AND id <> $1', user?.profissional_id || 0);
          for (const p of others) {
            await this.prisma.$queryRawUnsafe(
              `INSERT INTO notificacoes (profissional_id, titulo, mensagem, lida)
               VALUES ($1, 'Solicitação Aceita', $2, false)`,
              p.id,
              msgText
            );
          }
        } catch (e) {
          console.error('[NESTJS DATABASE NOTIFICATION ERROR ON UPDATE]', e);
        }
      }

      // Trigger real-time websocket synchronization
      try {
        this.notificationsGateway.broadcastToTenant(tenantSlug, 'appointments-changed', {
          action: 'update',
          id: updatedAg.id,
          status: updatedAg.status
        });
        if (wasPending && isAccepted) {
          this.notificationsGateway.broadcastToTenant(tenantSlug, 'notifications-changed', {
            action: 'update',
            type: 'appointment_confirmed'
          });
        }
      } catch (socketErr) {
        console.error('[SOCKET BROADCAST ERROR]', socketErr);
      }

      return { agendamento: updatedAg };
    });
  }

  private async consumirProdutosAgendamento(tenantSlug: string, agendamento: any, profissionalId: number) {
    // Buscar produtos vinculados ao serviço
    const produtosServico: any = await this.prisma.$queryRawUnsafe(
      'SELECT sp.produto_id, sp.quantidade_usada FROM servico_produtos sp WHERE sp.servico_id = $1',
      agendamento.servico_id
    );

    // Buscar produtos vinculados ao subserviço
    const produtosSubservico: any = await this.prisma.$queryRawUnsafe(
      'SELECT ssp.produto_id, ssp.quantidade_usada FROM subservico_produtos ssp WHERE ssp.subservico_id = $1',
      agendamento.subservico_id
    );

    const todosProdutos = [...(produtosServico || []), ...(produtosSubservico || [])];

    // Consumir cada produto e registrar no caixa
    for (const produtoVinculo of todosProdutos) {
      const prodRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM estoque_produtos WHERE id = $1',
        produtoVinculo.produto_id
      );

      if (prodRes && prodRes.length > 0) {
        const produto = prodRes[0];
        const novaQtd = Math.max(0, produto.quantidade - produtoVinculo.quantidade_usada);

        // Atualizar quantidade
        await this.prisma.$queryRawUnsafe(
          'UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2',
          novaQtd, produto.id
        );

        // Registrar movimentação
        await this.prisma.$queryRawUnsafe(
          `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
           VALUES ($1, $2, 'saida', $3, $4)`,
          produto.id, profissionalId, produtoVinculo.quantidade_usada,
          `Consumo em agendamento #${agendamento.id}`
        );

        // Registrar saída no caixa
        const custo = parseFloat(produto.custo_unitario || 0);
        if (custo > 0) {
          const totalCusto = produtoVinculo.quantidade_usada * custo;
          await this.prisma.$queryRawUnsafe(
            `INSERT INTO fluxo_caixa (
              profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento
            ) VALUES ($1, 'saida', 'material', $2, $3, 'pago', 'consumo', CURRENT_DATE)`,
            profissionalId,
            `Consumo de Material: ${produto.nome} (${produtoVinculo.quantidade_usada} un)`,
            totalCusto
          );
        }
      }
    }

    // Marcar como consumido
    await this.prisma.$queryRawUnsafe(
      'UPDATE agendamentos SET estoque_consumido = true WHERE id = $1',
      agendamento.id
    );
  }

  async remove(tenantSlug: string, user: any, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const agendRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM agendamentos WHERE id = $1',
        id,
      );
      if (!agendRes || agendRes.length === 0) throw new NotFoundException('Agendamento não encontrado.');
      const agendamento = agendRes[0];

      if (agendamento.profissional_id && agendamento.profissional_id !== user.profissional_id) {
        throw new ForbiddenException('Você só pode excluir agendamentos atribuídos a você.');
      }


      // 1. Estorno no estoque (se o estoque foi consumido)
      if (agendamento.estoque_consumido) {
        // Buscar produtos vinculados ao serviço
        const produtosServico: any = await this.prisma.$queryRawUnsafe(
          'SELECT sp.produto_id, sp.quantidade_usada FROM servico_produtos sp WHERE sp.servico_id = $1',
          agendamento.servico_id,
        );

        // Buscar produtos vinculados ao subserviço
        const produtosSubservico: any = await this.prisma.$queryRawUnsafe(
          'SELECT ssp.produto_id, ssp.quantidade_usada FROM subservico_produtos ssp WHERE ssp.subservico_id = $1',
          agendamento.subservico_id,
        );

        const todosProdutos = [...(produtosServico || []), ...(produtosSubservico || [])];

        for (const produtoVinculo of todosProdutos) {
          const prodRes: any = await this.prisma.$queryRawUnsafe(
            'SELECT * FROM estoque_produtos WHERE id = $1',
            produtoVinculo.produto_id,
          );
          if (prodRes && prodRes.length > 0) {
            const produto = prodRes[0];
            const novaQtd = produto.quantidade + produtoVinculo.quantidade_usada;

            // Devolver quantidade ao estoque
            await this.prisma.$queryRawUnsafe(
              'UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2',
              novaQtd,
              produto.id,
            );

            // Registrar movimentação de entrada/estorno
            await this.prisma.$queryRawUnsafe(
              `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
               VALUES ($1, $2, 'entrada', $3, $4)`,
              produto.id,
              agendamento.profissional_id,
              produtoVinculo.quantidade_usada,
              `Estorno por exclusão do agendamento #${agendamento.id}`,
            );
          }
        }
      }

      // 2. Estorno no caixa (deleta todas as movimentações associadas a este agendamento)
      await this.prisma.$queryRawUnsafe(
        'DELETE FROM fluxo_caixa WHERE agendamento_id = $1',
        id,
      );

      // 3. Exclui o agendamento
      await this.prisma.$queryRawUnsafe('DELETE FROM agendamentos WHERE id = $1', id);

      // Trigger real-time websocket synchronization
      try {
        this.notificationsGateway.broadcastToTenant(tenantSlug, 'appointments-changed', {
          action: 'delete',
          id
        });
      } catch (socketErr) {
        console.error('[SOCKET BROADCAST ERROR]', socketErr);
      }

      return { message: 'Agendamento deletado e estornos realizados com sucesso.' };
    });
  }


  async getPaymentData(tenantSlug: string, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const confRes: any = await this.prisma.$queryRawUnsafe('SELECT valor FROM configuracoes WHERE chave = $1', 'pagamentos');
      const config = confRes[0]?.valor || confRes[0] || {};
      
      const agendRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT a.*, c.nome as cliente_nome, c.email as cliente_email, c.whatsapp as cliente_whatsapp, s.nome as servico_nome FROM agendamentos a LEFT JOIN clientes c ON a.cliente_id = c.id LEFT JOIN servicos s ON a.servico_id = s.id WHERE a.id = $1',
        id
      );
      if (!agendRes || agendRes.length === 0) throw new NotFoundException('Appointment not found.');
      const agendamento = agendRes[0];
      
      const valorFinal = Number(agendamento.valor_total || 0);
      const valorFinalStr = valorFinal.toFixed(2);
      
      let pixKey = '';
      let paymentLink = '';
      
      const asaasEnabled = Boolean(config.asaas_enabled);
      const asaasApiKey = config.asaas_api_key;
      const asaasUrl = config.asaas_environment === 'production' ? 'https://www.asaas.com/api/v3' : 'https://sandbox.asaas.com/api/v3';

      if (asaasEnabled && asaasApiKey) {
        try {
          // 1. Criar ou obter cliente
          const cleanPhone = String(agendamento.cliente_whatsapp || '').replace(/\D/g, '');
          const cpfCnpj = cleanPhone.length === 11 ? cleanPhone : '99999999999';

          const searchRes = await fetch(`${asaasUrl}/customers?cpfCnpj=${cpfCnpj}`, {
            method: 'GET',
            headers: { 'access_token': asaasApiKey }
          });
          const searchData = await searchRes.json().catch(() => ({}));
          let customerId = searchData?.data?.[0]?.id;

          if (!customerId) {
            const customerRes = await fetch(`${asaasUrl}/customers`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'access_token': asaasApiKey },
              body: JSON.stringify({
                name: agendamento.cliente_nome || 'Cliente Acionar',
                email: agendamento.cliente_email || undefined,
                phone: agendamento.cliente_whatsapp || undefined,
                notificationDisabled: true
              })
            });
            const customerData = await customerRes.json().catch(() => ({}));
            customerId = customerData.id;
          }

          if (customerId) {
            const chargeValue = Math.max(5.00, valorFinal);
            const externalReference = `${tenantSlug}_${agendamento.id}`;
            const description = `Agendamento #${agendamento.id} - ${agendamento.servico_nome || 'Atendimento'}`;
            
            const today = new Date();
            today.setDate(today.getDate() + 3);
            const dueDate = today.toISOString().split('T')[0];

            // 2. Criar cobrança Pix
            const paymentRes = await fetch(`${asaasUrl}/payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'access_token': asaasApiKey },
              body: JSON.stringify({
                customer: customerId,
                billingType: 'PIX',
                value: chargeValue,
                dueDate,
                description,
                externalReference
              })
            });
            const paymentData = await paymentRes.json().catch(() => ({}));
            const paymentId = paymentData.id;
            paymentLink = paymentData.invoiceUrl || paymentData.bankSlipUrl || '';

            if (paymentId) {
              // 3. Obter payload do Pix
              const qrCodeRes = await fetch(`${asaasUrl}/payments/${paymentId}/pixQrCode`, {
                method: 'GET',
                headers: { 'access_token': asaasApiKey }
              });
              const qrCodeData = await qrCodeRes.json().catch(() => ({}));
              pixKey = qrCodeData.payload || '';
            }
          }
        } catch (error) {
          console.error('Erro na integração Asaas (NestJS service):', error);
        }
      }
      
      if (!pixKey) {
        // Fallback manual usando a chave Pix do Tenant com geração dinâmica real
        const pixKeyConfig = config.pix_key || '';
        if (pixKeyConfig) {
          pixKey = generatePixEmvPayload({
            chavePix: pixKeyConfig,
            nome: tenantSlug.toUpperCase(),
            valor: valorFinal,
            txid: String(agendamento.id)
          }) || '';
        }
        paymentLink = ''; // Pix estático não tem link de checkout
      }
      
      return { pixKey, paymentLink, valorFinal: valorFinalStr };
    });
  }
}

// Helpers para geração do Pix EMV
function crc16Ccitt(str: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function generatePixEmvPayload({ chavePix, nome = 'ACIONAR', cidade = 'SAO PAULO', valor = 0, txid = '***' }: { chavePix: string, nome?: string, cidade?: string, valor?: number, txid?: string }): string | null {
  let cleanChave = String(chavePix || '').trim();
  if (!cleanChave) return null;

  const digitsOnly = cleanChave.replace(/\D/g, '');
  if (digitsOnly.length === 11 && !cleanChave.startsWith('+') && !cleanChave.includes('@')) {
    cleanChave = `+55${digitsOnly}`;
  }

  const cleanNome = String(nome || 'ACIONAR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .slice(0, 25);
  
  const cleanCidade = String(cidade || 'SAO PAULO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .slice(0, 15);
  
  const cleanValor = Number(valor || 0).toFixed(2);
  const cleanTxid = String(txid || '***').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || '***';

  const gui = '0014BR.GOV.BCB.PIX';
  const keyTag = `01${String(cleanChave.length).padStart(2, '0')}${cleanChave}`;
  const merchantAccount = `${gui}${keyTag}`;

  const txidTag = `05${String(cleanTxid.length).padStart(2, '0')}${cleanTxid}`;

  let payload = '000201';
  payload += `26${String(merchantAccount.length).padStart(2, '0')}${merchantAccount}`;
  payload += '52040000';
  payload += '5303986';
  payload += `54${String(cleanValor.length).padStart(2, '0')}${cleanValor}`;
  payload += '5802BR';
  payload += `59${String(cleanNome.length).padStart(2, '0')}${cleanNome}`;
  payload += `60${String(cleanCidade.length).padStart(2, '0')}${cleanCidade}`;
  payload += `62${String(txidTag.length).padStart(2, '0')}${txidTag}`;
  payload += '6304';

  const crc = crc16Ccitt(payload);
  return payload + crc;
}

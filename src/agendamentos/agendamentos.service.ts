import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';


@Injectable()
export class AgendamentosService {
  constructor(private readonly prisma: PrismaService) {}

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
        params.push(status);
        sql += ` AND a.status = $${params.length}`;
      }
      if (profIdFilter) {
        params.push(profIdFilter);
        sql += ` AND a.profissional_id = $${params.length}`;
      }

      sql += ' ORDER BY a.data_hora ASC';

      const agendamentos: any = await this.prisma.$queryRawUnsafe(sql, ...params);
      return { agendamentos };
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

      return { agendamento: res[0] };
    });
  }

  async update(tenantSlug: string, id: number, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const { status, data_hora, valor_total, observacao, profissional_id } = dto;

      const agendRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM agendamentos WHERE id = $1',
        id,
      );

      if (!agendRes || agendRes.length === 0) throw new NotFoundException('Appointment not found.');

      const agendamento = agendRes[0];

      let finalClienteId = agendamento.cliente_id;
      const targetProfId = profissional_id || agendamento.profissional_id;

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

      // Atualizar agendamento
      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE agendamentos
         SET status = COALESCE($1, status),
             data_hora = CASE WHEN $2::text IS NOT NULL THEN $2::timestamptz ELSE data_hora END,
             valor_total = COALESCE($3::numeric, valor_total),
             observacao = COALESCE($4, observacao),
             profissional_id = COALESCE($5, profissional_id),
             cliente_id = COALESCE($6, cliente_id),
             updated_at = NOW()
         WHERE id = $7 RETURNING *`,
        status !== undefined ? status : null,
        data_hora !== undefined && data_hora !== '' ? data_hora : null,
        valor_total !== undefined ? valor_total : null,
        observacao !== undefined ? observacao : null,
        profissional_id !== undefined ? profissional_id : null,
        finalClienteId,
        id,
      );


      // Se status mudou para "concluido", consumir produtos
      if (status === 'concluido' && agendamento.status !== 'concluido' && !agendamento.estoque_consumido) {
        await this.consumirProdutosAgendamento(tenantSlug, agendamento, profissional_id || agendamento.profissional_id);
      }

      return { agendamento: res[0] };
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

      return { message: 'Agendamento deletado e estornos realizados com sucesso.' };
    });
  }


  async getPaymentData(tenantSlug: string, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const confRes: any = await this.prisma.$queryRawUnsafe('SELECT valor FROM configuracoes WHERE chave = $1', 'pagamentos');
      const config = confRes[0]?.valor || confRes[0] || {};
      
      const agendRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT a.*, c.nome as cliente_nome, c.whatsapp as cliente_whatsapp FROM agendamentos a LEFT JOIN clientes c ON a.cliente_id = c.id WHERE a.id = $1',
        id
      );
      if (!agendRes || agendRes.length === 0) throw new NotFoundException('Appointment not found.');
      const agendamento = agendRes[0];
      
      const valorFinal = Number(agendamento.valor_total || 0).toFixed(2);
      const clienteNomeOriginal = agendamento.cliente_nome || 'Cliente';
      const clienteNome = clienteNomeOriginal.substring(0, 15).replace(/[^a-zA-Z0-9 ]/g, '');
      const clientePhone = agendamento.cliente_whatsapp || '';
      
      let pixKey = '';
      let paymentLink = '';
      
      const asaasEnabled = Boolean(config.asaas_enabled);
      const asaasApiKey = process.env.ASAAS_API_KEY;
      const asaasUrl = process.env.ASAAS_URL || 'https://sandbox.asaas.com/api/v3';

      if (asaasEnabled && asaasApiKey && asaasApiKey !== 'SUA_CHAVE_ASAAS_AQUI') {
        try {
          // 1. Criar cliente no Asaas
          const customerRes = await fetch(`${asaasUrl}/customers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'access_token': asaasApiKey },
            body: JSON.stringify({ name: clienteNomeOriginal, mobilePhone: clientePhone })
          });
          const customerData = await customerRes.json();
          const customerId = customerData.id;

          if (!customerId) {
            console.error('Asaas Customer Error:', customerData);
            throw new Error('Falha ao criar cliente no Asaas');
          }

          // 2. Criar cobrança Pix
          const paymentRes = await fetch(`${asaasUrl}/payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'access_token': asaasApiKey },
            body: JSON.stringify({
              customer: customerId,
              billingType: 'PIX',
              value: Number(valorFinal),
              dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], // amanhã
              description: `Agendamento #${agendamento.id} - ${tenantSlug}`,
              externalReference: `${tenantSlug}_${agendamento.id}`
            })
          });
          const paymentData = await paymentRes.json();
          const paymentId = paymentData.id;
          paymentLink = paymentData.invoiceUrl;

          if (paymentId) {
            // 3. Obter payload do Pix
            const qrCodeRes = await fetch(`${asaasUrl}/payments/${paymentId}/pixQrCode`, {
              method: 'GET',
              headers: { 'access_token': asaasApiKey }
            });
            const qrCodeData = await qrCodeRes.json();
            pixKey = qrCodeData.payload;
          }
        } catch (error) {
          console.error('Erro na integração Asaas:', error);
          // Falha silenciosa: cai no fallback
        }
      }
      
      if (!pixKey) {
        // Fallback manual usando a chave Pix do Tenant
        const chavePix = config.pix_key || 'acionar';
        const identificador = agendamento.id;
        pixKey = `00020126580014BR.GOV.BCB.PIX0136${chavePix}5204000053039865405${valorFinal}5802BR5915${clienteNome}6009SAO PAULO62070503***6304E2CA`;
        paymentLink = `https://acionar.app/pay/${identificador}?v=${valorFinal}`;
      }
      
      return { pixKey, paymentLink, valorFinal };
    });
  }
}

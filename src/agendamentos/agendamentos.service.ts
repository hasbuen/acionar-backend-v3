import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgendamentosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string, query: any) {
    const { data_inicio, data_fim, status, profissional_id } = query;
    await this.prisma.ensureTenantSchema(tenantSlug);

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
      if (profissional_id) {
        params.push(profissional_id);
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
        ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10) RETURNING *`,
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
      
      // Buscar agendamento atual
      const agendRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM agendamentos WHERE id = $1',
        id
      );
      
      if (!agendRes || agendRes.length === 0) throw new NotFoundException('Appointment not found.');
      
      const agendamento = agendRes[0];
      
      // Atualizar agendamento
      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE agendamentos
         SET status = COALESCE($1, status),
             data_hora = CASE WHEN $2::text IS NOT NULL THEN $2::timestamptz ELSE data_hora END,
             valor_total = COALESCE($3, valor_total),
             observacao = COALESCE($4, observacao),
             profissional_id = COALESCE($5, profissional_id),
             updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        status, data_hora || null, valor_total, observacao, profissional_id, id
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

  async remove(tenantSlug: string, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe('DELETE FROM agendamentos WHERE id = $1 RETURNING id', id);
      if (!res || res.length === 0) throw new NotFoundException('Appointment not found.');
      return { message: 'Appointment deleted successfully.' };
    });
  }
}

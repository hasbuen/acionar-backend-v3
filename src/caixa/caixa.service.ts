import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CaixaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string, query: any) {
    const { data_inicio, data_fim, tipo, status, forma_pagamento, categoria } = query;
    await this.prisma.ensureTenantSchema(tenantSlug);

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      let sql = 'SELECT fc.*, a.cliente_id, a.servico_id, c.nome as cliente_nome, s.nome as servico_nome FROM fluxo_caixa fc LEFT JOIN agendamentos a ON fc.agendamento_id = a.id LEFT JOIN clientes c ON a.cliente_id = c.id LEFT JOIN servicos s ON a.servico_id = s.id WHERE 1=1';
      const params: any[] = [];

      if (data_inicio) {
        params.push(data_inicio);
        sql += ` AND fc.data_movimento >= $${params.length}::date`;
      }
      if (data_fim) {
        params.push(data_fim);
        sql += ` AND fc.data_movimento <= $${params.length}::date`;
      }
      if (tipo && tipo !== 'todos') {
        params.push(tipo);
        sql += ` AND fc.tipo = $${params.length}`;
      }
      if (status && status !== 'todos') {
        params.push(status);
        sql += ` AND fc.status = $${params.length}`;
      }
      if (forma_pagamento && forma_pagamento !== 'todos') {
        params.push(forma_pagamento);
        sql += ` AND fc.forma_pagamento = $${params.length}`;
      }

      sql += ' ORDER BY fc.data_movimento DESC, fc.id DESC';

      const movimentacoes: any = await this.prisma.$queryRawUnsafe(sql, ...params);

      let totalEntradas = 0;
      let totalAReceber = 0;
      let totalSaidas = 0;
      let totalSaidasPendente = 0;

      const byFormaPagamento: Record<string, number> = {
        pix: 0,
        cartao_credito: 0,
        cartao_debito: 0,
        dinheiro: 0,
      };

      const byCondicao: Record<string, number> = {
        a_vista: 0,
        a_prazo: 0,
      };

      const evolucaoMap = new Map<string, { date: string; entradas: number; saidas: number }>();

      movimentacoes.forEach((item: any) => {
        const val = parseFloat(item.valor || 0);
        const dateStr = item.data_movimento ? new Date(item.data_movimento).toISOString().split('T')[0] : 'Desconhecido';

        if (!evolucaoMap.has(dateStr)) {
          evolucaoMap.set(dateStr, { date: dateStr, entradas: 0, saidas: 0 });
        }
        const dayRecord = evolucaoMap.get(dateStr)!;

        if (item.tipo === 'entrada') {
          if (item.status === 'pago') {
            totalEntradas += val;
            dayRecord.entradas += val;
            byCondicao.a_vista += val;

            const forma = (item.forma_pagamento || 'pix').toLowerCase();
            if (byFormaPagamento[forma] !== undefined) {
              byFormaPagamento[forma] += val;
            } else {
              byFormaPagamento.pix += val;
            }
          } else {
            totalAReceber += val;
            byCondicao.a_prazo += val;
          }
        } else if (item.tipo === 'saida') {
          if (item.status === 'pago') {
            totalSaidas += val;
            dayRecord.saidas += val;
          } else {
            totalSaidasPendente += val;
          }
        }
      });

      const evolucao = Array.from(evolucaoMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      return {
        movimentacoes,
        resumo: {
          totalEntradas: Math.round(totalEntradas * 100) / 100,
          totalAReceber: Math.round(totalAReceber * 100) / 100,
          totalSaidas: Math.round(totalSaidas * 100) / 100,
          totalSaidasPendente: Math.round(totalSaidasPendente * 100) / 100,
          saldo: Math.round((totalEntradas - totalSaidas) * 100) / 100,
          byFormaPagamento,
          byCondicao,
          evolucao,
        },
      };
    });
  }

  async create(tenantSlug: string, user: any, dto: any) {
    const { agendamento_id, tipo, descricao, valor, status, forma_pagamento, data_movimento } = dto;
    if (!tipo || !descricao || valor === undefined) {
      throw new BadRequestException('Tipo, descrição e valor são obrigatórios.');
    }

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO fluxo_caixa (
          agendamento_id, profissional_id, tipo, descricao, valor, status, forma_pagamento, data_movimento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date) RETURNING *`,
        agendamento_id || null,
        user.profissional_id,
        tipo,
        descricao,
        valor,
        status || 'pago',
        forma_pagamento || 'pix',
        data_movimento || new Date().toISOString().split('T')[0]
      );
      return { movimentacao: res[0] };
    });
  }

  async remove(tenantSlug: string, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe('DELETE FROM fluxo_caixa WHERE id = $1 RETURNING id', id);
      if (!res || res.length === 0) throw new NotFoundException('Lançamento de caixa não encontrado.');
      return { message: 'Lançamento excluído com sucesso.' };
    });
  }
}

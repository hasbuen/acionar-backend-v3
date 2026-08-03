import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CaixaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string, query: any) {
    const { data_inicio, data_fim } = query;
    await this.prisma.ensureTenantSchema(tenantSlug);

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      let sql = 'SELECT * FROM fluxo_caixa WHERE 1=1';
      const params: any[] = [];

      if (data_inicio) {
        params.push(data_inicio);
        sql += ` AND data_movimento >= $${params.length}`;
      }
      if (data_fim) {
        params.push(data_fim);
        sql += ` AND data_movimento <= $${params.length}`;
      }

      sql += ' ORDER BY data_movimento DESC, id DESC';

      const movimentacoes: any = await this.prisma.$queryRawUnsafe(sql, ...params);

      let totalEntradas = 0;
      let totalSaidas = 0;

      movimentacoes.forEach(item => {
        const val = parseFloat(item.valor || 0);
        if (item.tipo === 'entrada' && item.status === 'pago') totalEntradas += val;
        if (item.tipo === 'saida' && item.status === 'pago') totalSaidas += val;
      });

      return {
        movimentacoes,
        resumo: {
          totalEntradas: Math.round(totalEntradas * 100) / 100,
          totalSaidas: Math.round(totalSaidas * 100) / 100,
          saldo: Math.round((totalEntradas - totalSaidas) * 100) / 100,
        },
      };
    });
  }

  async create(tenantSlug: string, user: any, dto: any) {
    const { agendamento_id, tipo, descricao, valor, status, forma_pagamento, data_movimento } = dto;
    if (!tipo || !descricao || valor === undefined) {
      throw new BadRequestException('Type, Description, and Value are required.');
    }

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO fluxo_caixa (
          agendamento_id, profissional_id, tipo, descricao, valor, status, forma_pagamento, data_movimento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
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
      if (!res || res.length === 0) throw new NotFoundException('Cashflow entry not found.');
      return { message: 'Cashflow entry deleted successfully.' };
    });
  }
}

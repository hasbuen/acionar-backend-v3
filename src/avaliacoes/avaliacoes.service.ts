import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AvaliacoesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string, user: any, query: any) {
    const { profissional_id } = query;
    await this.prisma.ensureTenantSchema(tenantSlug);

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      let sql = `
        SELECT ev.*,
               a.data_hora as agendamento_data_hora,
               c.nome as cliente_nome,
               p.nome as profissional_nome, p.id as profissional_id,
               s.nome as servico_nome
        FROM avaliacoes ev
        JOIN agendamentos a ON ev.agendamento_id = a.id
        LEFT JOIN clientes c ON a.cliente_id = c.id
        LEFT JOIN profissionais p ON a.profissional_id = p.id
        LEFT JOIN servicos s ON a.servico_id = s.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (profissional_id) {
        params.push(parseInt(profissional_id, 10));
        sql += ` AND a.profissional_id = $${params.length}`;
      }

      sql += ` ORDER BY ev.created_at DESC`;

      const reviews: any[] = await this.prisma.$queryRawUnsafe(sql, ...params);

      // Map dynamic / temp client name if needed
      for (const rev of reviews) {
        if (!rev.cliente_nome) {
          try {
            // Find temp client from observation if it exists
            const apptObs: any = await this.prisma.$queryRawUnsafe('SELECT observacao FROM agendamentos WHERE id = $1', rev.agendamento_id);
            const obsStr = apptObs[0]?.observacao;
            if (obsStr) {
              const obs = typeof obsStr === 'object' ? obsStr : JSON.parse(obsStr);
              if (obs && obs.temp_cliente_nome) {
                rev.cliente_nome = obs.temp_cliente_nome;
              }
            }
          } catch (e) {}
        }
        if (!rev.cliente_nome) rev.cliente_nome = 'Cliente';
      }

      return { reviews };
    });
  }

  async getRanking(tenantSlug: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      // Get all active professionals and their review statistics
      const stats: any[] = await this.prisma.$queryRawUnsafe(`
        SELECT p.id as profissional_id,
               p.nome as profissional_nome,
               p.foto_url,
               COALESCE(AVG(ev.nota), 0)::float as media_nota,
               COUNT(ev.id)::int as total_avaliacoes
        FROM profissionais p
        LEFT JOIN agendamentos a ON a.profissional_id = p.id
        LEFT JOIN avaliacoes ev ON ev.agendamento_id = a.id
        WHERE p.ativo = true
        GROUP BY p.id, p.nome, p.foto_url
        ORDER BY media_nota DESC, total_avaliacoes DESC
      `);

      return { ranking: stats };
    });
  }
}

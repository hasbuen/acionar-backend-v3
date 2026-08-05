import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Statuses de agendamento que são excluídos do fluxo de caixa
const STATUSES_EXCLUIDOS = ['cancelado', 'aguardando_confirmacao', 'solicitado'];

@Injectable()
export class CaixaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string, query: any) {
    const { data_inicio, data_fim, periodo } = query;
    await this.prisma.ensureTenantSchema(tenantSlug);

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      // ─── Monta filtros de data ─────────────────────────────────────────
      let dataInicio: string | null = data_inicio || null;
      let dataFim: string | null = data_fim || null;

      if (periodo) {
        const hoje = new Date();
        const fmt = (d: Date) => d.toISOString().split('T')[0];
        if (periodo === 'hoje') {
          dataInicio = dataFim = fmt(hoje);
        } else if (periodo === 'semana') {
          const ini = new Date(hoje);
          ini.setDate(hoje.getDate() - hoje.getDay());
          dataInicio = fmt(ini);
          dataFim = fmt(hoje);
        } else if (periodo === 'mes') {
          dataInicio = fmt(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
          dataFim = fmt(hoje);
        }
      }

      // ─── 1. Busca lançamentos reais de fluxo_caixa ────────────────────
      let sqlFC =
        `SELECT fc.id::text as id, fc.agendamento_id, fc.profissional_id,
                fc.tipo, fc.categoria, fc.descricao, fc.valor, fc.status,
                fc.forma_pagamento, fc.data_movimento,
                c.nome as cliente_nome, s.nome as servico_nome,
                'fluxo_caixa' as origem
         FROM fluxo_caixa fc
         LEFT JOIN agendamentos a ON fc.agendamento_id = a.id
         LEFT JOIN clientes c ON a.cliente_id = c.id
         LEFT JOIN servicos s ON a.servico_id = s.id
         WHERE 1=1`;
      const paramsFC: any[] = [];

      if (dataInicio) {
        paramsFC.push(dataInicio);
        sqlFC += ` AND fc.data_movimento >= $${paramsFC.length}::date`;
      }
      if (dataFim) {
        paramsFC.push(dataFim);
        sqlFC += ` AND fc.data_movimento <= $${paramsFC.length}::date`;
      }
      sqlFC += ' ORDER BY fc.data_movimento DESC, fc.id DESC';

      const lancamentosReais: any[] = await this.prisma.$queryRawUnsafe(sqlFC, ...paramsFC);

      // IDs de agendamentos que já possuem lançamento vinculado (array de números)
      const agIdsComLancamento: number[] = lancamentosReais
        .filter((r) => r.agendamento_id != null)
        .map((r) => Number(r.agendamento_id));

      // ─── 2. Busca agendamentos pendentes sem lançamento ───────────────
      let sqlAG =
        `SELECT a.id, a.data_hora, a.valor_total, a.status,
                c.nome as cliente_nome,
                s.nome as servico_nome
         FROM agendamentos a
         LEFT JOIN clientes c ON a.cliente_id = c.id
         LEFT JOIN servicos s ON a.servico_id = s.id
         WHERE a.status <> ALL($1::text[])
           AND (
             $2::int[] IS NULL
             OR array_length($2::int[], 1) IS NULL
             OR a.id <> ALL($2::int[])
           )`;
      const paramsAG: any[] = [
        STATUSES_EXCLUIDOS,       // $1 — array de statuses a excluir
        agIdsComLancamento,       // $2 — IDs já lançados (pode ser array vazio)
      ];

      // Filtro de data sobre data_hora do agendamento
      if (dataInicio) {
        paramsAG.push(dataInicio);
        sqlAG += ` AND a.data_hora >= $${paramsAG.length}::date`;
      }
      if (dataFim) {
        paramsAG.push(dataFim);
        sqlAG += ` AND a.data_hora < ($${paramsAG.length}::date + INTERVAL '1 day')`;
      }
      sqlAG += ' ORDER BY a.data_hora DESC';

      const agendamentosOrfaos: any[] = await this.prisma.$queryRawUnsafe(sqlAG, ...paramsAG);

      // ─── 3. Transforma agendamentos em lançamentos virtuais ──────────
      const lancamentosVirtuais = agendamentosOrfaos.map((ag) => {
        const isPaid = ['pago', 'recebido', 'quitado'].includes(String(ag.status).toLowerCase());
        return {
          id: `ag-${ag.id}`,
          agendamento_id: ag.id,
          profissional_id: null,
          tipo: 'entrada',
          categoria: 'agendamento',
          descricao: `Atendimento — ${ag.cliente_nome || 'Cliente'} / ${ag.servico_nome || 'Serviço'}`,
          valor: ag.valor_total ?? 0,
          status: isPaid ? 'pago' : 'pendente',
          forma_pagamento: isPaid ? 'pix' : null,
          data_movimento: ag.data_hora,
          cliente_nome: ag.cliente_nome,
          servico_nome: ag.servico_nome,
          origem: 'agendamento',
        };
      });

      // ─── 4. Mescla e ordena por data desc ────────────────────────────
      const movimentacoes = [...lancamentosReais, ...lancamentosVirtuais].sort((a, b) => {
        const da = new Date(a.data_movimento).getTime();
        const db = new Date(b.data_movimento).getTime();
        return db - da;
      });

      // ─── 5. Calcula resumo ────────────────────────────────────────────
      let totalEntradas = 0;
      let totalAReceber = 0;
      let totalSaidas = 0;
      let totalSaidasPendente = 0;
      let qtdPendentes = 0;
      let qtdRecebidos = 0;

      const byFormaPagamento: Record<string, number> = {
        pix: 0,
        cartao_credito: 0,
        cartao_debito: 0,
        dinheiro: 0,
      };

      const evolucaoMap = new Map<string, { date: string; entradas: number; saidas: number }>();

      movimentacoes.forEach((item: any) => {
        const val = parseFloat(item.valor || 0);
        const dateStr = item.data_movimento
          ? new Date(item.data_movimento).toISOString().split('T')[0]
          : 'Desconhecido';

        if (!evolucaoMap.has(dateStr)) {
          evolucaoMap.set(dateStr, { date: dateStr, entradas: 0, saidas: 0 });
        }
        const dayRecord = evolucaoMap.get(dateStr)!;

        if (item.tipo === 'entrada') {
          if (item.status === 'pago') {
            totalEntradas += val;
            qtdRecebidos++;
            dayRecord.entradas += val;
            const forma = (item.forma_pagamento || 'pix').toLowerCase();
            if (byFormaPagamento[forma] !== undefined) {
              byFormaPagamento[forma] += val;
            } else {
              byFormaPagamento.pix += val;
            }
          } else {
            totalAReceber += val;
            qtdPendentes++;
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
          totalReceber: Math.round(totalAReceber * 100) / 100, // alias
          totalSaidas: Math.round(totalSaidas * 100) / 100,
          totalSaidasPendente: Math.round(totalSaidasPendente * 100) / 100,
          saldo: Math.round((totalEntradas - totalSaidas) * 100) / 100,
          qtdPendentes,
          qtdRecebidos,
          byFormaPagamento,
          evolucao,
        },
      };
    });
  }

  async create(tenantSlug: string, user: any, dto: any) {
    const { agendamento_id, tipo, descricao, valor, status, forma_pagamento, data_movimento, categoria } = dto;
    if (!tipo || !descricao || valor === undefined) {
      throw new BadRequestException('Tipo, descrição e valor são obrigatórios.');
    }

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO fluxo_caixa (
          agendamento_id, profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date) RETURNING *`,
        agendamento_id || null,
        user.profissional_id || null,
        tipo,
        categoria || null,
        descricao,
        valor,
        status || 'pago',
        forma_pagamento || 'pix',
        data_movimento || new Date().toISOString().split('T')[0],
      );
      return { movimentacao: res[0] };
    });
  }

  /**
   * Dar baixa em um lançamento pendente.
   * - Se id = "ag-<n>": cria o registro real no fluxo_caixa vinculado ao agendamento.
   * - Se id numérico: atualiza o status do registro existente para 'pago'.
   */
  async baixar(tenantSlug: string, id: string, forma_pagamento: string) {
    if (!forma_pagamento) {
      throw new BadRequestException('Forma de pagamento é obrigatória.');
    }

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      // ─── Lançamento virtual de agendamento ─────────────────────────
      if (id.startsWith('ag-')) {
        const agendamentoId = parseInt(id.replace('ag-', ''), 10);

        const agRows: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT a.id, a.valor_total, a.data_hora,
                  c.nome as cliente_nome, s.nome as servico_nome
           FROM agendamentos a
           LEFT JOIN clientes c ON a.cliente_id = c.id
           LEFT JOIN servicos s ON a.servico_id = s.id
           WHERE a.id = $1 AND a.status = ANY($2::text[])`,
          agendamentoId,
          STATUSES_EXCLUIDOS.map((s) => s.toLowerCase()),
        );

        if (!agRows || agRows.length === 0) {
          throw new NotFoundException('Agendamento confirmado não encontrado.');
        }

        const ag = agRows[0];
        const descricao = `Atendimento — ${ag.cliente_nome || 'Cliente'} / ${ag.servico_nome || 'Serviço'}`;
        const dataMovimento = new Date(ag.data_hora).toISOString().split('T')[0];

        const res: any = await this.prisma.$queryRawUnsafe(
          `INSERT INTO fluxo_caixa (agendamento_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento)
           VALUES ($1, 'entrada', 'agendamento', $2, $3, 'pago', $4, $5::date) RETURNING *`,
          agendamentoId,
          descricao,
          ag.valor_total ?? 0,
          forma_pagamento,
          dataMovimento,
        );

        return { movimentacao: res[0], message: 'Baixa realizada com sucesso.' };
      }

      // ─── Lançamento real existente ──────────────────────────────────
      const numericId = parseInt(id, 10);
      if (isNaN(numericId)) {
        throw new BadRequestException('ID de lançamento inválido.');
      }

      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE fluxo_caixa SET status = 'pago', forma_pagamento = $1
         WHERE id = $2 AND status = 'pendente'
         RETURNING *`,
        forma_pagamento,
        numericId,
      );

      if (!res || res.length === 0) {
        throw new NotFoundException('Lançamento pendente não encontrado ou já baixado.');
      }

      return { movimentacao: res[0], message: 'Baixa realizada com sucesso.' };
    });
  }

  async remove(tenantSlug: string, id: string) {
    if (String(id).startsWith('ag-')) {
      throw new BadRequestException(
        'Agendamentos pendentes não podem ser excluídos pelo caixa. Cancele o agendamento na tela de Agenda.',
      );
    }

    const numericId = parseInt(String(id), 10);
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        'DELETE FROM fluxo_caixa WHERE id = $1 RETURNING id',
        numericId,
      );
      if (!res || res.length === 0) throw new NotFoundException('Lançamento de caixa não encontrado.');
      return { message: 'Lançamento excluído com sucesso.' };
    });
  }
}

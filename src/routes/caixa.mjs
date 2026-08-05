import express from 'express';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/caixa
 */
router.get('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { data_inicio, data_fim, periodo } = req.query;

    let dataInicio = data_inicio || null;
    let dataFim = data_fim || null;

    if (periodo) {
      const hoje = new Date();
      const fmt = (d) => d.toISOString().split('T')[0];
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
    let sqlFC = `
      SELECT fc.id::text as id, fc.agendamento_id, fc.profissional_id,
             fc.tipo, fc.categoria, fc.descricao, fc.valor, fc.status,
             fc.forma_pagamento, fc.data_movimento,
             c.nome as cliente_nome, s.nome as servico_nome,
             'fluxo_caixa' as origem
      FROM fluxo_caixa fc
      LEFT JOIN agendamentos a ON fc.agendamento_id = a.id
      LEFT JOIN clientes c ON a.cliente_id = c.id
      LEFT JOIN servicos s ON a.servico_id = s.id
      WHERE 1=1
    `;
    const paramsFC = [];
    if (dataInicio) {
      paramsFC.push(dataInicio);
      sqlFC += ` AND fc.data_movimento >= $${paramsFC.length}::date`;
    }
    if (dataFim) {
      paramsFC.push(dataFim);
      sqlFC += ` AND fc.data_movimento <= $${paramsFC.length}::date`;
    }
    sqlFC += ' ORDER BY fc.data_movimento DESC, fc.id DESC';

    const fcResult = await queryTenant(tenant_slug, sqlFC, paramsFC);
    const lancamentosReais = fcResult.rows;

    const agIdsComLancamento = lancamentosReais
      .filter(r => r.agendamento_id != null)
      .map(r => Number(r.agendamento_id));

    // ─── 2. Busca agendamentos pendentes sem lançamento ───────────────
    let sqlAG = `
      SELECT a.id, a.data_hora, a.valor_total, a.status,
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
        )
    `;
    const paramsAG = [
      ['cancelado', 'aguardando_confirmacao', 'solicitado'],
      agIdsComLancamento.length > 0 ? agIdsComLancamento : null
    ];

    if (dataInicio) {
      paramsAG.push(dataInicio);
      sqlAG += ` AND a.data_hora >= $${paramsAG.length}::date`;
    }
    if (dataFim) {
      paramsAG.push(dataFim);
      sqlAG += ` AND a.data_hora < ($${paramsAG.length}::date + INTERVAL '1 day')`;
    }
    sqlAG += ' ORDER BY a.data_hora DESC';

    const agResult = await queryTenant(tenant_slug, sqlAG, paramsAG);
    const agendamentosOrfaos = agResult.rows;

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

    const byFormaPagamento = {
      pix: 0,
      cartao_credito: 0,
      cartao_debito: 0,
      dinheiro: 0,
    };

    movimentacoes.forEach((item) => {
      const val = parseFloat(item.valor || 0);

      if (item.tipo === 'entrada') {
        if (item.status === 'pago') {
          totalEntradas += val;
          qtdRecebidos++;
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
        } else {
          totalSaidasPendente += val;
        }
      }
    });

    res.json({
      movimentacoes,
      resumo: {
        totalEntradas: Math.round(totalEntradas * 100) / 100,
        totalAReceber: Math.round(totalAReceber * 100) / 100,
        totalReceber: Math.round(totalAReceber * 100) / 100,
        totalSaidas: Math.round(totalSaidas * 100) / 100,
        totalSaidasPendente: Math.round(totalSaidasPendente * 100) / 100,
        saldo: Math.round((totalEntradas - totalSaidas) * 100) / 100,
        qtdPendentes,
        qtdRecebidos,
        byFormaPagamento,
      }
    });
  } catch (err) {
    console.error('[GET CAIXA ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch cashflow.' });
  }
});

/**
 * POST /api/caixa
 */
router.post('/', async (req, res) => {
  try {
    const { tenant_slug, profissional_id } = req.user;
    const { agendamento_id, tipo, descricao, valor, status, forma_pagamento, data_movimento } = req.body;

    if (!tipo || !descricao || valor === undefined) {
      return res.status(400).json({ error: 'Type, Description, and Value are required.' });
    }

    const result = await queryTenant(
      tenant_slug,
      `INSERT INTO fluxo_caixa (
        agendamento_id, profissional_id, tipo, descricao, valor, status, forma_pagamento, data_movimento
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        agendamento_id || null,
        profissional_id,
        tipo,
        descricao,
        valor,
        status || 'pago',
        forma_pagamento || 'pix',
        data_movimento || new Date().toISOString().split('T')[0]
      ]
    );

    res.status(201).json({ movimentacao: result.rows[0] });
  } catch (err) {
    console.error('[POST CAIXA ERROR]', err);
    res.status(500).json({ error: 'Failed to record cashflow movement.' });
  }
});

/**
 * PATCH /api/caixa/:id/baixar
 */
router.patch('/:id/baixar', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;
    const { forma_pagamento } = req.body;

    if (!forma_pagamento) {
      return res.status(400).json({ error: 'Forma de pagamento é obrigatória.' });
    }

    if (id.startsWith('ag-')) {
      const agendamentoId = parseInt(id.replace('ag-', ''), 10);

      const agQuery = await queryTenant(
        tenant_slug,
        `SELECT a.id, a.valor_total, a.data_hora,
                c.nome as cliente_nome, s.nome as servico_nome
         FROM agendamentos a
         LEFT JOIN clientes c ON a.cliente_id = c.id
         LEFT JOIN servicos s ON a.servico_id = s.id
         WHERE a.id = $1 AND a.status <> ALL($2::text[])`,
        [agendamentoId, ['cancelado', 'aguardando_confirmacao', 'solicitado']]
      );

      if (agQuery.rows.length === 0) {
        return res.status(404).json({ error: 'Agendamento ativo não encontrado.' });
      }

      const ag = agQuery.rows[0];
      const descricao = `Atendimento — ${ag.cliente_nome || 'Cliente'} / ${ag.servico_nome || 'Serviço'}`;
      const dataMovimento = new Date(ag.data_hora).toISOString().split('T')[0];

      const insertRes = await queryTenant(
        tenant_slug,
        `INSERT INTO fluxo_caixa (agendamento_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento)
         VALUES ($1, 'entrada', 'agendamento', $2, $3, 'pago', $4, $5::date) RETURNING *`,
        [agendamentoId, descricao, ag.valor_total ?? 0, forma_pagamento, dataMovimento]
      );

      return res.json({ movimentacao: insertRes.rows[0], message: 'Baixa realizada com sucesso.' });
    }

    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) {
      return res.status(400).json({ error: 'ID de lançamento inválido.' });
    }

    const updateRes = await queryTenant(
      tenant_slug,
      `UPDATE fluxo_caixa SET status = 'pago', forma_pagamento = $1
       WHERE id = $2 AND status = 'pendente'
       RETURNING *`,
      [forma_pagamento, numericId]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Lançamento pendente não encontrado ou já baixado.' });
    }

    res.json({ movimentacao: updateRes.rows[0], message: 'Baixa realizada com sucesso.' });
  } catch (err) {
    console.error('[BAIXAR CAIXA ERROR]', err);
    res.status(500).json({ error: 'Failed to record payment confirmation.' });
  }
});

/**
 * DELETE /api/caixa/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;

    const result = await queryTenant(tenant_slug, 'DELETE FROM fluxo_caixa WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cashflow entry not found.' });
    }

    res.json({ message: 'Cashflow entry deleted successfully.' });
  } catch (err) {
    console.error('[DELETE CAIXA ERROR]', err);
    res.status(500).json({ error: 'Failed to delete cashflow entry.' });
  }
});

export default router;

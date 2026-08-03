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
    const { data_inicio, data_fim } = req.query;

    let sql = 'SELECT * FROM fluxo_caixa WHERE 1=1';
    const params = [];

    if (data_inicio) {
      params.push(data_inicio);
      sql += ` AND data_movimento >= $${params.length}`;
    }

    if (data_fim) {
      params.push(data_fim);
      sql += ` AND data_movimento <= $${params.length}`;
    }

    sql += ' ORDER BY data_movimento DESC, id DESC';

    const result = await queryTenant(tenant_slug, sql, params);

    // Calculate totals safely
    let totalEntradas = 0;
    let totalSaidas = 0;

    result.rows.forEach(item => {
      const val = parseFloat(item.valor || 0);
      if (item.tipo === 'entrada' && item.status === 'pago') totalEntradas += val;
      if (item.tipo === 'saida' && item.status === 'pago') totalSaidas += val;
    });

    const saldo = totalEntradas - totalSaidas;

    res.json({
      movimentacoes: result.rows,
      resumo: {
        totalEntradas: Math.round(totalEntradas * 100) / 100,
        totalSaidas: Math.round(totalSaidas * 100) / 100,
        saldo: Math.round(saldo * 100) / 100
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

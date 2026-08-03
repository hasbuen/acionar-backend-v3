import express from 'express';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

// Apply auth to management routes
router.use(authMiddleware);

/**
 * GET /api/agendamentos
 */
router.get('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { data_inicio, data_fim, status, profissional_id } = req.query;

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
    const params = [];

    if (data_inicio) {
      params.push(data_inicio);
      sql += ` AND a.data_hora >= $${params.length}`;
    }

    if (data_fim) {
      params.push(data_fim);
      sql += ` AND a.data_hora <= $${params.length}`;
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

    const result = await queryTenant(tenant_slug, sql, params);
    res.json({ agendamentos: result.rows });
  } catch (err) {
    console.error('[GET AGENDAMENTOS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch appointments.' });
  }
});

/**
 * POST /api/agendamentos
 */
router.post('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const {
      cliente_id, profissional_id, servico_id, subservico_id,
      data_hora, valor_total, observacao, tipo_atendimento, endereco_externo, status
    } = req.body;

    const result = await queryTenant(
      tenant_slug,
      `INSERT INTO agendamentos (
        cliente_id, profissional_id, servico_id, subservico_id,
        data_hora, valor_total, observacao, tipo_atendimento, endereco_externo, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        cliente_id || null,
        profissional_id || req.user.profissional_id,
        servico_id,
        subservico_id || null,
        data_hora,
        valor_total || 0,
        observacao || null,
        tipo_atendimento || 'salao',
        endereco_externo || null,
        status || 'agendado'
      ]
    );

    res.status(201).json({ agendamento: result.rows[0] });
  } catch (err) {
    console.error('[POST AGENDAMENTO ERROR]', err);
    res.status(500).json({ error: 'Failed to create appointment.' });
  }
});

/**
 * PUT /api/agendamentos/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;
    const { status, data_hora, valor_total, observacao, profissional_id } = req.body;

    const result = await queryTenant(
      tenant_slug,
      `UPDATE agendamentos
       SET status = COALESCE($1, status),
           data_hora = COALESCE($2, data_hora),
           valor_total = COALESCE($3, valor_total),
           observacao = COALESCE($4, observacao),
           profissional_id = COALESCE($5, profissional_id)
       WHERE id = $6 RETURNING *`,
      [status, data_hora, valor_total, observacao, profissional_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    res.json({ agendamento: result.rows[0] });
  } catch (err) {
    console.error('[PUT AGENDAMENTO ERROR]', err);
    res.status(500).json({ error: 'Failed to update appointment.' });
  }
});

/**
 * DELETE /api/agendamentos/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;

    const result = await queryTenant(tenant_slug, 'DELETE FROM agendamentos WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }

    res.json({ message: 'Appointment deleted successfully.' });
  } catch (err) {
    console.error('[DELETE AGENDAMENTO ERROR]', err);
    res.status(500).json({ error: 'Failed to delete appointment.' });
  }
});

export default router;

import express from 'express';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/clientes
 */
router.get('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const result = await queryTenant(tenant_slug, 'SELECT * FROM clientes ORDER BY nome ASC');
    res.json({ clientes: result.rows });
  } catch (err) {
    console.error('[GET CLIENTES ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch clients.' });
  }
});

/**
 * POST /api/clientes
 */
router.post('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { nome, whatsapp, email, observacoes } = req.body;

    if (!nome) {
      return res.status(400).json({ error: 'Client name is required.' });
    }

    const result = await queryTenant(
      tenant_slug,
      'INSERT INTO clientes (nome, whatsapp, email, observacoes) VALUES ($1, $2, $3, $4) RETURNING *',
      [nome, whatsapp || null, email || null, observacoes || null]
    );

    res.status(201).json({ cliente: result.rows[0] });
  } catch (err) {
    console.error('[POST CLIENTE ERROR]', err);
    res.status(500).json({ error: 'Failed to create client.' });
  }
});

/**
 * PUT /api/clientes/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;
    const { nome, whatsapp, email, observacoes } = req.body;

    const result = await queryTenant(
      tenant_slug,
      `UPDATE clientes
       SET nome = COALESCE($1, nome),
           whatsapp = COALESCE($2, whatsapp),
           email = COALESCE($3, email),
           observacoes = COALESCE($4, observacoes)
       WHERE id = $5 RETURNING *`,
      [nome, whatsapp, email, observacoes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found.' });
    }

    res.json({ cliente: result.rows[0] });
  } catch (err) {
    console.error('[PUT CLIENTE ERROR]', err);
    res.status(500).json({ error: 'Failed to update client.' });
  }
});

export default router;

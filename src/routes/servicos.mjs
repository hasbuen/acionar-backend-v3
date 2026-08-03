import express from 'express';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();
router.use(authMiddleware);

/**
 * GET /api/servicos
 */
router.get('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const servicosRes = await queryTenant(tenant_slug, 'SELECT * FROM servicos ORDER BY nome ASC');
    const subservicosRes = await queryTenant(tenant_slug, 'SELECT * FROM subservicos ORDER BY nome ASC');

    const servicos = servicosRes.rows.map(serv => ({
      ...serv,
      subservicos: subservicosRes.rows.filter(sub => sub.servico_id === serv.id)
    }));

    res.json({ servicos });
  } catch (err) {
    console.error('[GET SERVICOS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch services.' });
  }
});

/**
 * POST /api/servicos
 */
router.post('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { nome, descricao, duracao_minutos, preco, ativo } = req.body;

    if (!nome || preco === undefined) {
      return res.status(400).json({ error: 'Name and Price are required.' });
    }

    const result = await queryTenant(
      tenant_slug,
      `INSERT INTO servicos (nome, descricao, duracao_minutos, preco, ativo)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nome, descricao || null, duracao_minutos || 60, preco, ativo !== undefined ? ativo : true]
    );

    res.status(201).json({ servico: result.rows[0] });
  } catch (err) {
    console.error('[POST SERVICO ERROR]', err);
    res.status(500).json({ error: 'Failed to create service.' });
  }
});

/**
 * PUT /api/servicos/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;
    const { nome, descricao, duracao_minutos, preco, ativo } = req.body;

    const result = await queryTenant(
      tenant_slug,
      `UPDATE servicos
       SET nome = COALESCE($1, nome),
           descricao = COALESCE($2, descricao),
           duracao_minutos = COALESCE($3, duracao_minutos),
           preco = COALESCE($4, preco),
           ativo = COALESCE($5, ativo)
       WHERE id = $6 RETURNING *`,
      [nome, descricao, duracao_minutos, preco, ativo, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    res.json({ servico: result.rows[0] });
  } catch (err) {
    console.error('[PUT SERVICO ERROR]', err);
    res.status(500).json({ error: 'Failed to update service.' });
  }
});

export default router;

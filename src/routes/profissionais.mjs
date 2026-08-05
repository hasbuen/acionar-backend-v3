import express from 'express';
import bcrypt from 'bcryptjs';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();
router.use(authMiddleware);

// GET /api/profissionais
router.get('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { all } = req.query;

    let sql = 'SELECT id, nome, email, cargo, foto_url, cor_identificadora, aceita_atendimento_externo, ativo FROM profissionais';
    if (all !== 'true') {
      sql += ' WHERE ativo = true';
    }
    sql += ' ORDER BY nome ASC';

    const result = await queryTenant(tenant_slug, sql);
    res.json({ profissionais: result.rows });
  } catch (error) {
    console.error('[GET PROFISSIONAIS ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch professionals.' });
  }
});

// POST /api/profissionais
router.post('/', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { nome, email, senha, cor_identificadora, aceita_atendimento_externo } = req.body;

    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, E-mail e Senha são obrigatórios.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (!cleanEmail.endsWith('@acionar.online')) {
      return res.status(400).json({ error: 'O e-mail do auxiliar deve utilizar o domínio @acionar.online' });
    }

    // Check if email already exists
    const checkRes = await queryTenant(tenant_slug, 'SELECT id FROM profissionais WHERE email = $1', [cleanEmail]);
    if (checkRes.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um profissional cadastrado com este e-mail.' });
    }

    const senha_hash = await bcrypt.hash(senha, 10);

    const result = await queryTenant(
      tenant_slug,
      `INSERT INTO profissionais (nome, email, senha_hash, cargo, cor_identificadora, aceita_atendimento_externo, ativo)
       VALUES ($1, $2, $3, 'auxiliar', $4, $5, true) RETURNING id, nome, email, cargo, cor_identificadora, aceita_atendimento_externo, ativo`,
      [nome.trim(), cleanEmail, senha_hash, cor_identificadora || '#8b5cf6', Boolean(aceita_atendimento_externo)]
    );

    res.status(201).json({ profissional: result.rows[0] });
  } catch (err) {
    console.error('[POST PROFISSIONAL ERROR]', err);
    res.status(500).json({ error: 'Failed to create professional.' });
  }
});

// PUT /api/profissionais/:id
router.put('/:id', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;
    const { nome, email, senha, cor_identificadora, aceita_atendimento_externo, ativo } = req.body;

    // Fetch existing professional
    const fetchRes = await queryTenant(tenant_slug, 'SELECT * FROM profissionais WHERE id = $1', [id]);
    if (fetchRes.rows.length === 0) {
      return res.status(404).json({ error: 'Professional not found.' });
    }
    const current = fetchRes.rows[0];

    // Check email uniqueness if modified
    let cleanEmail = current.email;
    if (email) {
      cleanEmail = String(email).trim().toLowerCase();
      if (!cleanEmail.endsWith('@acionar.online') && current.cargo !== 'proprietario') {
        return res.status(400).json({ error: 'O e-mail do auxiliar deve utilizar o domínio @acionar.online' });
      }

      if (cleanEmail !== current.email) {
        const checkRes = await queryTenant(tenant_slug, 'SELECT id FROM profissionais WHERE email = $1', [cleanEmail]);
        if (checkRes.rows.length > 0) {
          return res.status(409).json({ error: 'E-mail já está em uso.' });
        }
      }
    }

    let senha_hash = current.senha_hash;
    if (senha && String(senha).trim()) {
      senha_hash = await bcrypt.hash(senha, 10);
    }

    const result = await queryTenant(
      tenant_slug,
      `UPDATE profissionais
       SET nome = COALESCE($1, nome),
           email = COALESCE($2, email),
           senha_hash = $3,
           cor_identificadora = COALESCE($4, cor_identificadora),
           aceita_atendimento_externo = COALESCE($5, aceita_atendimento_externo),
           ativo = COALESCE($6, ativo),
           updated_at = NOW()
       WHERE id = $7 RETURNING id, nome, email, cargo, cor_identificadora, aceita_atendimento_externo, ativo`,
      [
        nome ? nome.trim() : null,
        cleanEmail,
        senha_hash,
        cor_identificadora || null,
        aceita_atendimento_externo !== undefined ? Boolean(aceita_atendimento_externo) : null,
        ativo !== undefined ? Boolean(ativo) : null,
        id
      ]
    );

    res.json({ profissional: result.rows[0] });
  } catch (err) {
    console.error('[PUT PROFISSIONAL ERROR]', err);
    res.status(500).json({ error: 'Failed to update professional.' });
  }
});

// DELETE /api/profissionais/:id
router.delete('/:id', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;

    // Check cargo
    const checkRes = await queryTenant(tenant_slug, 'SELECT cargo FROM profissionais WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Professional not found.' });
    }
    if (checkRes.rows[0].cargo === 'proprietario') {
      return res.status(403).json({ error: 'Não é possível remover o proprietário do estabelecimento.' });
    }

    await queryTenant(tenant_slug, 'DELETE FROM profissionais WHERE id = $1', [id]);
    res.json({ message: 'Professional deleted successfully.' });
  } catch (err) {
    console.error('[DELETE PROFISSIONAL ERROR]', err);
    res.status(500).json({ error: 'Failed to delete professional.' });
  }
});

export default router;

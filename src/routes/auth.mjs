import express from 'express';
import bcrypt from 'bcryptjs';
import { queryPublic, queryTenant } from '../db/postgres.mjs';
import { initTenantSchema } from '../db/migrations.mjs';
import { signToken, authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

/**
 * POST /api/auth/register-tenant
 */
router.post('/register', async (req, res) => {
  try {
    const { slug, nome_empresa, email_proprietario, senha, telefone, foto_url, cor_primaria, cor_texto_principal, cor_texto_secundario } = req.body;

    if (!slug || !nome_empresa || !email_proprietario || !senha) {
      return res.status(400).json({ error: 'Missing required registration fields.' });
    }

    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');

    // Check if slug exists
    const existing = await queryPublic('SELECT id FROM public.tenants WHERE slug = $1', [cleanSlug]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Subdomain/Slug '${cleanSlug}' is already taken.` });
    }

    const salt = await bcrypt.genSalt(10);
    const senha_hash = await bcrypt.hash(senha, salt);

    // Insert tenant in public
    const tenantRes = await queryPublic(
      `INSERT INTO public.tenants (slug, nome_empresa, email_proprietario, telefone, senha_hash, foto_url, cor_primaria, cor_texto_principal, cor_texto_secundario)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, slug, nome_empresa`,
      [cleanSlug, nome_empresa, email_proprietario, telefone || null, senha_hash, foto_url || null, cor_primaria || '#0d9488', cor_texto_principal || '#ffffff', cor_texto_secundario || '#94a3b8']
    );

    const newTenant = tenantRes.rows[0];

    // Initialize tenant schema
    await initTenantSchema(cleanSlug);

    // Create owner in tenant's profissionais table
    const ownerRes = await queryTenant(
      cleanSlug,
      `INSERT INTO profissionais (nome, email, telefone, cargo, foto_url, senha_hash)
       VALUES ($1, $2, $3, 'proprietario', $4, $5) RETURNING id, nome, email, cargo`,
      [nome_empresa, email_proprietario, telefone || null, foto_url || null, senha_hash]
    );

    const owner = ownerRes.rows[0];
    const token = signToken({
      tenant_slug: cleanSlug,
      profissional_id: owner.id,
      email: owner.email,
      cargo: owner.cargo
    });

    res.status(201).json({
      message: 'Tenant registered successfully.',
      token,
      tenant: newTenant,
      user: owner
    });
  } catch (err) {
    console.error('[REGISTER TENANT ERROR]', err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { slug, email, senha } = req.body;

    if (!slug || !email || !senha) {
      return res.status(400).json({ error: 'Slug, email and password are required.' });
    }

    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');

    // Fetch tenant
    const tenantRes = await queryPublic('SELECT * FROM public.tenants WHERE slug = $1', [cleanSlug]);
    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }

    const tenant = tenantRes.rows[0];
    if (tenant.status !== 'ativo') {
      return res.status(403).json({ error: 'Tenant is inactive.' });
    }

    // Ensure schema initialized
    await initTenantSchema(cleanSlug);

    // Query professional in tenant schema
    const profRes = await queryTenant(
      cleanSlug,
      'SELECT id, nome, email, cargo, foto_url, senha_hash, ativo FROM profissionais WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (profRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = profRes.rows[0];
    if (!user.ativo) {
      return res.status(403).json({ error: 'User is inactive.' });
    }

    const validPass = await bcrypt.compare(senha, user.senha_hash);
    if (!validPass) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = signToken({
      tenant_slug: cleanSlug,
      profissional_id: user.id,
      email: user.email,
      cargo: user.cargo
    });

    delete user.senha_hash;

    res.json({
      token,
      tenant,
      user
    });
  } catch (err) {
    console.error('[LOGIN ERROR]', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug, email } = req.user;

    const tenantRes = await queryPublic('SELECT * FROM public.tenants WHERE slug = $1', [tenant_slug]);
    const profRes = await queryTenant(
      tenant_slug,
      'SELECT id, nome, email, telefone, cargo, foto_url, ativo FROM profissionais WHERE email = $1',
      [email]
    );

    if (tenantRes.rows.length === 0 || profRes.rows.length === 0) {
      return res.status(404).json({ error: 'Dados inválidos, verifique!' });
    }

    res.json({
      tenant: tenantRes.rows[0],
      user: profRes.rows[0]
    });
  } catch (err) {
    console.error('[ME ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch session profile.' });
  }
});

export default router;

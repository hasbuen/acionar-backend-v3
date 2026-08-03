import express from 'express';
import { queryPublic, queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';
import { clearTenantCache } from '../middleware/tenant.mjs';

const router = express.Router();

async function readPaymentSettings(tenantSlug) {
  const result = await queryTenant(tenantSlug, 'SELECT valor FROM configuracoes WHERE chave = $1', ['pagamentos']);
  return result.rows[0]?.valor || { asaas_enabled: false, asaas_environment: 'sandbox', pix_key: '', pix_key_type: 'aleatoria', asaas_api_key_configured: false };
}

router.get('/payments', authMiddleware, async (req, res) => {
  try {
    const settings = await readPaymentSettings(req.user.tenant_slug);
    res.json({ settings: { ...settings, asaas_api_key: undefined, asaas_api_key_configured: Boolean(settings.asaas_api_key) } });
  } catch (err) {
    console.error('[GET PAYMENT CONFIG ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch payment configuration.' });
  }
});

router.put('/payments', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const current = await readPaymentSettings(tenant_slug);
    const next = {
      asaas_enabled: Boolean(req.body.asaas_enabled),
      asaas_environment: req.body.asaas_environment === 'production' ? 'production' : 'sandbox',
      pix_key: String(req.body.pix_key || '').trim(),
      pix_key_type: String(req.body.pix_key_type || 'aleatoria'),
      asaas_api_key: req.body.asaas_api_key ? String(req.body.asaas_api_key).trim() : current.asaas_api_key || ''
    };
    await queryTenant(tenant_slug, `INSERT INTO configuracoes (chave, valor, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`, ['pagamentos', JSON.stringify(next)]);
    res.json({ message: 'Payment configuration saved.', settings: { ...next, asaas_api_key: undefined, asaas_api_key_configured: Boolean(next.asaas_api_key) } });
  } catch (err) {
    console.error('[UPDATE PAYMENT CONFIG ERROR]', err);
    res.status(500).json({ error: 'Failed to save payment configuration.' });
  }
});

/**
 * GET /api/config/public-schedule
 */
router.get('/public-schedule', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const result = await queryPublic(
      'SELECT slug, nome_empresa, foto_url, cor_primaria, cor_destaque, cor_fundo, agenda_publica_ativa FROM public.tenants WHERE slug = $1',
      [tenant_slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }

    res.json({ settings: result.rows[0] });
  } catch (err) {
    console.error('[GET CONFIG ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch public schedule configuration.' });
  }
});

/**
 * PUT /api/config/public-schedule
 */
router.put('/public-schedule', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { agenda_publica_ativa, foto_url, cor_primaria, cor_destaque, cor_fundo, novo_slug } = req.body;

    let targetSlug = tenant_slug;

    // Optional slug update
    if (novo_slug && novo_slug !== tenant_slug) {
      const cleanSlug = novo_slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
      const existing = await queryPublic('SELECT id FROM public.tenants WHERE slug = $1', [cleanSlug]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: `Subdomain/Slug '${cleanSlug}' is already taken.` });
      }
      targetSlug = cleanSlug;
    }

    const result = await queryPublic(
      `UPDATE public.tenants
       SET agenda_publica_ativa = COALESCE($1, agenda_publica_ativa),
           foto_url = COALESCE($2, foto_url),
           cor_primaria = COALESCE($3, cor_primaria),
           cor_destaque = COALESCE($4, cor_destaque),
           cor_fundo = COALESCE($5, cor_fundo),
           slug = $6,
           updated_at = NOW()
       WHERE slug = $7
       RETURNING slug, nome_empresa, foto_url, cor_primaria, cor_destaque, cor_fundo, agenda_publica_ativa`,
      [agenda_publica_ativa, foto_url, cor_primaria, cor_destaque, cor_fundo, targetSlug, tenant_slug]
    );

    clearTenantCache(tenant_slug);
    clearTenantCache(targetSlug);

    res.json({
      message: 'Public schedule configuration updated successfully.',
      settings: result.rows[0]
    });
  } catch (err) {
    console.error('[UPDATE CONFIG ERROR]', err);
    res.status(500).json({ error: 'Failed to update configuration.' });
  }
});

export default router;

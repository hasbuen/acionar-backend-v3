import { queryPublic } from '../db/postgres.mjs';
import { initTenantSchema } from '../db/migrations.mjs';

const tenantCache = new Map();

export async function tenantMiddleware(req, res, next) {
  try {
    const slug = (
      req.headers['x-tenant-slug'] ||
      req.query.tenant ||
      req.params.slug ||
      ''
    ).toString().toLowerCase().trim();

    if (!slug) {
      return res.status(400).json({ error: 'Tenant slug not provided.' });
    }

    let tenant = tenantCache.get(slug);

    if (!tenant) {
      const result = await queryPublic(
        'SELECT id, slug, nome_empresa, email_proprietario, status, foto_url, cor_primaria, cor_destaque, cor_fundo, cor_texto_principal, cor_texto_secundario, agenda_publica_ativa FROM public.tenants WHERE slug = $1',
        [slug]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: `Tenant '${slug}' not found.` });
      }

      tenant = result.rows[0];

      if (tenant.status !== 'ativo') {
        return res.status(403).json({ error: `Tenant '${slug}' is inactive.` });
      }

      // Ensure tenant schema and tables exist
      await initTenantSchema(slug);
      tenantCache.set(slug, tenant);
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    console.error('[TENANT MIDDLEWARE ERROR]', err);
    res.status(500).json({ error: 'Failed to resolve tenant.' });
  }
}

export function clearTenantCache(slug) {
  if (slug) tenantCache.delete(slug);
  else tenantCache.clear();
}

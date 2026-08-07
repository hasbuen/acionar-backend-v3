import express from 'express';
import fs from 'fs';
import path from 'path';
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
      'SELECT slug, nome_empresa, foto_url, cor_primaria, cor_destaque, cor_fundo, cor_texto_principal, cor_texto_secundario, agenda_publica_ativa FROM public.tenants WHERE slug = $1',
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
    const { agenda_publica_ativa, foto_url, cor_primaria, cor_destaque, cor_fundo, cor_texto_principal, cor_texto_secundario, novo_slug, nome_empresa } = req.body;

    const current = await queryPublic('SELECT agenda_publica_ativa, nome_empresa FROM public.tenants WHERE slug = $1', [tenant_slug]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }
    const currentTenant = current.rows[0];
    const isAtiva = agenda_publica_ativa !== undefined ? Boolean(agenda_publica_ativa) : currentTenant.agenda_publica_ativa;

    if (nome_empresa !== undefined && nome_empresa !== currentTenant.nome_empresa) {
      if (!isAtiva) {
        return res.status(400).json({ error: 'Não é possível alterar o nome da empresa com a agenda pública desativada.' });
      }
    }

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
           cor_texto_principal = COALESCE($6, cor_texto_principal),
           cor_texto_secundario = COALESCE($7, cor_texto_secundario),
           slug = $8,
           nome_empresa = COALESCE($9, nome_empresa),
           updated_at = NOW()
       WHERE slug = $10
       RETURNING slug, nome_empresa, foto_url, cor_primaria, cor_destaque, cor_fundo, cor_texto_principal, cor_texto_secundario, agenda_publica_ativa`,
      [
        agenda_publica_ativa,
        foto_url,
        cor_primaria,
        cor_destaque,
        cor_fundo,
        cor_texto_principal,
        cor_texto_secundario,
        targetSlug,
        nome_empresa !== undefined && isAtiva ? String(nome_empresa).trim() : null,
        tenant_slug
      ]
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

async function readMessageSettings(tenantSlug) {
  const result = await queryTenant(tenantSlug, 'SELECT valor FROM configuracoes WHERE chave = $1', ['mensagens']);
  return result.rows[0]?.valor || {
    endereco: 'Rua da amizade 515 bairro: 14 de novembro',
    template_confirmacao: `📍 *Endereço*: {endereco}

Por gentileza, informe se concorda com este horário ou se prefere realizar alguma alteração.

📌 *Lembrete importante*: Pedimos a gentileza de chegar com **15 minutos de antecedência**.

Agradecemos a preferência e aguardamos você!😊`,
    template_manutencao: `Olá, *{cliente}*! 👋

Passando para lembrar que sua *MANUTENÇÃO PERIÓDICA* de *{servico}* está agendada para o dia *{data}* às *{hora}*.

📍 *Endereço*: {endereco}`
  };
}

router.get('/messages', authMiddleware, async (req, res) => {
  try {
    const settings = await readMessageSettings(req.user.tenant_slug);
    res.json({ settings });
  } catch (err) {
    console.error('[GET MESSAGES CONFIG ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch messages configuration.' });
  }
});

router.put('/messages', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { endereco, template_confirmacao, template_manutencao } = req.body;
    const next = {
      endereco: String(endereco || '').trim(),
      template_confirmacao: String(template_confirmacao || '').trim(),
      template_manutencao: String(template_manutencao || '').trim(),
    };
    await queryTenant(
      tenant_slug,
      `INSERT INTO configuracoes (chave, valor, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (chave)
       DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
      ['mensagens', JSON.stringify(next)]
    );
    res.json({ message: 'Messages configuration saved.', settings: next });
  } catch (err) {
    console.error('[UPDATE MESSAGES CONFIG ERROR]', err);
    res.status(500).json({ error: 'Failed to save messages configuration.' });
  }
});

// POST /api/config/upload-logo
router.post('/upload-logo', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { imageBase64 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    }

    const matches = imageBase64.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: 'Formato de imagem base64 inválido.' });
    }

    const extension = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');

    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads', { recursive: true });
    }

    const filename = `${tenant_slug}_logo_${Date.now()}.${extension}`;
    const filepath = path.join('uploads', filename);

    fs.writeFileSync(filepath, buffer);

    const relativeUrl = `/uploads/${filename}`;

    await queryPublic(
      'UPDATE public.tenants SET foto_url = $1, updated_at = NOW() WHERE slug = $2',
      [relativeUrl, tenant_slug]
    );

    clearTenantCache(tenant_slug);

    res.json({
      message: 'Logotipo atualizado com sucesso!',
      foto_url: relativeUrl
    });
  } catch (err) {
    console.error('[UPLOAD LOGO ERROR]', err);
    res.status(500).json({ error: 'Falhou ao salvar a imagem do logotipo.' });
  }
});

export default router;

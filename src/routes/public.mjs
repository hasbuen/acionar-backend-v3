import express from 'express';
import { queryPublic, queryTenant } from '../db/postgres.mjs';
import { initTenantSchema } from '../db/migrations.mjs';
import { sendPushNotification } from '../services/push.mjs';

const router = express.Router();

/**
 * GET /api/public/tenant/:slug
 */
router.get('/tenant/:slug', async (req, res) => {
  try {
    const slug = req.params.slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    const result = await queryPublic(
      'SELECT slug, nome_empresa, foto_url, cor_primaria, cor_destaque, cor_fundo, agenda_publica_ativa FROM public.tenants WHERE slug = $1',
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }

    res.json({ tenant: result.rows[0] });
  } catch (err) {
    console.error('[PUBLIC TENANT INFO ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch public tenant details.' });
  }
});

/**
 * GET /api/public/tenant/:slug/servicos
 */
router.get('/tenant/:slug/servicos', async (req, res) => {
  try {
    const slug = req.params.slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    await initTenantSchema(slug);

    const servicosRes = await queryTenant(slug, 'SELECT * FROM servicos WHERE ativo = true ORDER BY nome ASC');
    const subservicosRes = await queryTenant(slug, 'SELECT * FROM subservicos WHERE ativo = true ORDER BY nome ASC');

    const servicos = servicosRes.rows.map(serv => ({
      ...serv,
      subservicos: subservicosRes.rows.filter(sub => sub.servico_id === serv.id)
    }));

    res.json({ servicos });
  } catch (err) {
    console.error('[PUBLIC SERVICES ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch public services.' });
  }
});

/**
 * GET /api/public/tenant/:slug/profissionais
 */
router.get('/tenant/:slug/profissionais', async (req, res) => {
  try {
    const slug = req.params.slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    await initTenantSchema(slug);

    const result = await queryTenant(
      slug,
      'SELECT id, nome, foto_url, cargo FROM profissionais WHERE ativo = true ORDER BY nome ASC'
    );

    res.json({ profissionais: result.rows });
  } catch (err) {
    console.error('[PUBLIC PROFESSIONALS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch public professionals.' });
  }
});

/**
 * POST /api/public/tenant/:slug/agendamentos
 */
router.post('/tenant/:slug/agendamentos', async (req, res) => {
  try {
    const slug = req.params.slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');

    // Check if public schedule is active
    const tenantRes = await queryPublic('SELECT agenda_publica_ativa FROM public.tenants WHERE slug = $1', [slug]);
    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant not found.' });
    }
    if (!tenantRes.rows[0].agenda_publica_ativa) {
      return res.status(403).json({ error: 'Public online scheduling is currently disabled for this establishment.' });
    }

    await initTenantSchema(slug);

    const {
      cliente_nome,
      cliente_whatsapp,
      cliente_email,
      profissional_id,
      servico_id,
      subservico_id,
      data_hora,
      observacao,
      tipo_atendimento,
      endereco_externo
    } = req.body;

    if (!cliente_nome || !cliente_whatsapp || !servico_id || !data_hora) {
      return res.status(400).json({ error: 'Name, WhatsApp, Service, and Date/Time are required.' });
    }

    // 1. Find or create customer
    let clienteId;
    const existingCliente = await queryTenant(
      slug,
      'SELECT id FROM clientes WHERE whatsapp = $1 OR (email IS NOT NULL AND email = $2) LIMIT 1',
      [cliente_whatsapp, cliente_email || '']
    );

    if (existingCliente.rows.length > 0) {
      clienteId = existingCliente.rows[0].id;
    } else {
      const newCliente = await queryTenant(
        slug,
        'INSERT INTO clientes (nome, whatsapp, email) VALUES ($1, $2, $3) RETURNING id',
        [cliente_nome, cliente_whatsapp, cliente_email || null]
      );
      clienteId = newCliente.rows[0].id;
    }

    // 2. Fetch service duration & price
    const servRes = await queryTenant(slug, 'SELECT nome, preco, duracao_minutos FROM servicos WHERE id = $1', [servico_id]);
    if (servRes.rows.length === 0) {
      return res.status(404).json({ error: 'Selected service not found.' });
    }

    let valorTotal = parseFloat(servRes.rows[0].preco || 0);
    let duracaoTotal = parseInt(servRes.rows[0].duracao_minutos || 60, 10);

    if (subservico_id) {
      const subRes = await queryTenant(slug, 'SELECT preco_adicional, duracao_adicional_minutos FROM subservicos WHERE id = $1', [subservico_id]);
      if (subRes.rows.length > 0) {
        valorTotal += parseFloat(subRes.rows[0].preco_adicional || 0);
        duracaoTotal += parseInt(subRes.rows[0].duracao_adicional_minutos || 0, 10);
      }
    }

    // 3. Create appointment
    const agendamentoRes = await queryTenant(
      slug,
      `INSERT INTO agendamentos (
        cliente_id, profissional_id, servico_id, subservico_id, data_hora,
        duracao_total_minutos, valor_total, status, observacao, tipo_atendimento, endereco_externo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'aguardando_confirmacao', $8, $9, $10)
      RETURNING *`,
      [
        clienteId,
        profissional_id || null,
        servico_id,
        subservico_id || null,
        data_hora,
        duracaoTotal,
        valorTotal,
        observacao || 'Agendado via Agenda Pública',
        tipo_atendimento || 'salao',
        endereco_externo || null
      ]
    );

    // Trigger push notification to active subscribers
    const serviceName = servRes.rows[0]?.nome || 'Serviço';
    const dateFormatted = new Date(data_hora).toLocaleDateString('pt-BR');
    const timeFormatted = new Date(data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const localLabel = tipo_atendimento === 'cliente' || tipo_atendimento === 'externo' ? 'No local do cliente' : 'No salão';

    sendPushNotification(slug, {
      title: `Novo agendamento: ${cliente_nome}`,
      body: `Serviço: ${serviceName}\nData: ${dateFormatted} às ${timeFormatted}\nLocal: ${localLabel}`,
      url: '/',
      agendamento_id: agendamentoRes.rows[0].id,
      tag: `new-agendamento-${agendamentoRes.rows[0].id}`,
      data: {
        url: '/',
        agendamento_id: agendamentoRes.rows[0].id,
        clienteNome: cliente_nome,
        servicoNome: serviceName,
        data: dateFormatted,
        hora: timeFormatted,
        local: localLabel,
        kind: 'new'
      }
    }).catch(err => console.error('[PUBLIC PUSH TRIGGER ERROR]', err));

    res.status(201).json({
      message: 'Appointment requested successfully.',
      agendamento: agendamentoRes.rows[0]
    });
  } catch (err) {
    console.error('[PUBLIC BOOKING ERROR]', err);
    res.status(500).json({ error: 'Failed to complete public appointment.' });
  }
});

/**
 * POST /api/public/asaas-webhook
 * Public webhook to receive payment status updates from Asaas
 */
router.post('/asaas-webhook', async (req, res) => {
  try {
    const body = req.body;
    const event = body?.event;
    const payment = body?.payment || body;
    const externalReference = payment?.externalReference;

    console.log(`[ASAAS WEBHOOK] Received event ${event} for externalReference ${externalReference}`);

    if (!event || !externalReference) {
      return res.status(200).json({ ok: true, message: 'Missing event or externalReference, ignored.' });
    }

    // Process only payment received or confirmed events
    if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'CHECKOUT_PAID', 'PIX_CREDIT_RECEIVED'].includes(event)) {
      if (externalReference.includes('_')) {
        const parts = externalReference.split('_');
        const tenantSlug = parts[0].toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
        const appointmentId = parseInt(parts[1], 10);

        if (!isNaN(appointmentId)) {
          // Fetch appointment details in the tenant's schema
          const agQuery = await queryTenant(
            tenantSlug,
            `SELECT a.id, a.valor_total, a.data_hora, a.profissional_id,
                    c.nome as cliente_nome, s.nome as servico_nome
             FROM agendamentos a
             LEFT JOIN clientes c ON a.cliente_id = c.id
             LEFT JOIN servicos s ON a.servico_id = s.id
             WHERE a.id = $1`,
            [appointmentId]
          );

          if (agQuery.rows.length > 0) {
            const ag = agQuery.rows[0];
            const checkFc = await queryTenant(tenantSlug, 'SELECT id FROM fluxo_caixa WHERE agendamento_id = $1', [appointmentId]);

            const billingType = payment.billingType || 'PIX';
            const formaPagamento = String(billingType).toUpperCase() === 'PIX' ? 'pix' : 'cartao_credito';
            const descricao = `Atendimento — ${ag.cliente_nome || 'Cliente'} / ${ag.servico_nome || 'Serviço'}`;
            const dataMovimento = new Date(ag.data_hora).toISOString().split('T')[0];

            if (checkFc.rows.length === 0) {
              // Insert into cashflow
              await queryTenant(
                tenantSlug,
                `INSERT INTO fluxo_caixa (agendamento_id, profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento)
                 VALUES ($1, $2, 'entrada', 'agendamento', $3, $4, 'pago', $5, $6::date)`,
                [appointmentId, ag.profissional_id, descricao, ag.valor_total ?? 0, formaPagamento, dataMovimento]
              );
              console.log(`[ASAAS WEBHOOK] Created cashflow entry for tenant ${tenantSlug}, appointment ${appointmentId}`);
            } else {
              // Update existing cashflow
              await queryTenant(
                tenantSlug,
                `UPDATE fluxo_caixa SET status = 'pago', forma_pagamento = $1, valor = $2 WHERE agendamento_id = $3`,
                [formaPagamento, ag.valor_total ?? 0, appointmentId]
              );
              console.log(`[ASAAS WEBHOOK] Updated cashflow entry to paid for tenant ${tenantSlug}, appointment ${appointmentId}`);
            }

            // Update appointment status if pending confirmation
            await queryTenant(
              tenantSlug,
              `UPDATE agendamentos SET status = 'confirmado' WHERE id = $1 AND status = 'aguardando_confirmacao'`,
              [appointmentId]
            );
          } else {
            console.warn(`[ASAAS WEBHOOK] Appointment ${appointmentId} not found in schema tenant_${tenantSlug}`);
          }
        }
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[ASAAS WEBHOOK ERROR]', err);
    // Send 200 to Asaas to prevent loop re-tries on server error, but log it
    res.status(200).json({ ok: false, error: err.message });
  }
});

export default router;

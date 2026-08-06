import express from 'express';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';
import {
  generatePixEmvPayload,
  getOrCreateAsaasCustomer,
  createAsaasPayment,
  getAsaasPixQrCode
} from '../services/payments.mjs';
import { sendPushNotification } from '../services/push.mjs';

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
      sql += ` AND (a.profissional_id = $${params.length} OR (a.profissional_id IS NULL AND a.status = 'aguardando_confirmacao'))`;
    }

    if (req.user.cargo === 'auxiliar') {
      params.push(req.user.profissional_id);
      sql += ` AND (a.profissional_id = $${params.length} OR (a.profissional_id IS NULL AND a.status IN ('aguardando_confirmacao', 'solicitado', 'pendente')))`;
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

    const agendamento = result.rows[0];

    // Trigger push notification asynchronously so it doesn't block the API response
    (async () => {
      try {
        const servRes = await queryTenant(tenant_slug, 'SELECT nome FROM servicos WHERE id = $1', [servico_id]);
        const serviceName = servRes.rows[0]?.nome || 'Serviço';
        
        const clientRes = await queryTenant(tenant_slug, 'SELECT nome FROM clientes WHERE id = $1', [cliente_id]);
        const clienteNome = clientRes.rows[0]?.nome || 'Cliente';

        const dateFormatted = new Date(data_hora).toLocaleDateString('pt-BR');
        const timeFormatted = new Date(data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const localLabel = tipo_atendimento === 'cliente' || tipo_atendimento === 'externo' ? 'No local do cliente' : 'No salão';

        await sendPushNotification(tenant_slug, {
          title: `Novo agendamento: ${clienteNome}`,
          body: `Serviço: ${serviceName}\nData: ${dateFormatted} às ${timeFormatted}\nLocal: ${localLabel}`,
          url: '/agenda',
          agendamento_id: agendamento.id,
          tag: `new-agendamento-${agendamento.id}`,
          data: {
            url: '/agenda',
            agendamento_id: agendamento.id,
            clienteNome,
            servicoNome: serviceName,
            data: dateFormatted,
            hora: timeFormatted,
            local: localLabel,
            kind: 'new'
          }
        });
      } catch (pushErr) {
        console.error('[POST AGENDAMENTO PUSH ERROR]', pushErr);
      }
    })();

    res.status(201).json({ agendamento });
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

    if (req.user.cargo === 'auxiliar') {
      const checkRes = await queryTenant(tenant_slug, 'SELECT profissional_id, status FROM agendamentos WHERE id = $1', [id]);
      if (checkRes.rows.length === 0) {
        return res.status(404).json({ error: 'Appointment not found.' });
      }
      const ag = checkRes.rows[0];
      const isUnassigned = !ag.profissional_id && ['aguardando_confirmacao', 'solicitado', 'pendente'].includes(ag.status);
      const isMine = Number(ag.profissional_id) === Number(req.user.profissional_id);
      if (!isMine && !isUnassigned) {
        return res.status(403).json({ error: 'You do not have permission to update this appointment.' });
      }
    }
    const { status, data_hora, valor_total, observacao, profissional_id } = req.body;

    let finalProfId = profissional_id;

    // Se for aceite de solicitação pública sem profissional, atribui automaticamente ao profissional logado
    if ((status === 'agendado' || status === 'confirmado') && !finalProfId) {
      const checkRes = await queryTenant(tenant_slug, 'SELECT profissional_id, status FROM agendamentos WHERE id = $1', [id]);
      if (checkRes.rows.length > 0) {
        const ag = checkRes.rows[0];
        if (!ag.profissional_id && ['aguardando_confirmacao', 'solicitado', 'pendente'].includes(ag.status)) {
          finalProfId = req.user.profissional_id;
        }
      }
    }

    const result = await queryTenant(
      tenant_slug,
      `UPDATE agendamentos
       SET status = COALESCE($1, status),
           data_hora = COALESCE($2, data_hora),
           valor_total = COALESCE($3, valor_total),
           observacao = COALESCE($4, observacao),
           profissional_id = COALESCE($5, profissional_id)
       WHERE id = $6 RETURNING *`,
      [status, data_hora, valor_total, observacao, finalProfId, id]
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

/**
 * GET /api/agendamentos/:id/payment
 * Generates online billing details (Asaas/Pix) or Fallback Static Pix
 */
router.get('/:id/payment', async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { id } = req.params;

    // 1. Fetch appointment details with client and service names
    const agQuery = `
      SELECT a.*,
             c.nome as cliente_nome, c.email as cliente_email, c.whatsapp as cliente_whatsapp,
             s.nome as servico_nome
      FROM agendamentos a
      LEFT JOIN clientes c ON a.cliente_id = c.id
      LEFT JOIN servicos s ON a.servico_id = s.id
      WHERE a.id = $1
    `;
    const agRes = await queryTenant(tenant_slug, agQuery, [id]);
    if (agRes.rows.length === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }
    const appointment = agRes.rows[0];

    // 2. Fetch tenant payment settings
    const configRes = await queryTenant(tenant_slug, 'SELECT valor FROM configuracoes WHERE chave = $1', ['pagamentos']);
    const settings = configRes.rows[0]?.valor || { asaas_enabled: false, pix_key: '', pix_key_type: 'aleatoria' };

    const valorFinal = Number(appointment.valor_total || 0);

    // 3. Try Asaas Billing if enabled
    if (settings.asaas_enabled && settings.asaas_api_key) {
      try {
        const customerData = {
          name: appointment.cliente_nome || 'Cliente Acionar',
          email: appointment.cliente_email || undefined,
          phone: appointment.cliente_whatsapp || ''
        };

        // Create/retrieve customer on Asaas
        const customer = await getOrCreateAsaasCustomer(customerData, settings);

        if (customer && customer.id) {
          // Asaas requires minimum value of R$ 5,00 for charge creation
          const chargeValue = Math.max(5.00, valorFinal);

          // Unique external reference format: slug_agendamentoId
          const externalReference = `${tenant_slug}_${appointment.id}`;
          const description = `Agendamento #${appointment.id} - ${appointment.servico_nome || 'Atendimento'}`;

          const payment = await createAsaasPayment({
            customerId: customer.id,
            value: chargeValue,
            description,
            externalReference
          }, settings);

          if (payment && payment.id) {
            const pixQrCode = await getAsaasPixQrCode(payment.id, settings);
            if (pixQrCode && pixQrCode.payload) {
              return res.json({
                pixKey: pixQrCode.payload,
                paymentLink: payment.invoiceUrl || payment.bankSlipUrl || null
              });
            }
          }
        }
      } catch (asaasErr) {
        console.warn(`[ASAAS BILLING FALLBACK] Failed to generate Asaas billing for appointment ${id}, falling back to static Pix:`, asaasErr.message || asaasErr);
      }
    }

    // 4. Fallback: Static Pix EMV (Direct Pix)
    const pixKeyConfig = settings.pix_key || '';
    if (!pixKeyConfig) {
      return res.status(422).json({ error: 'Nenhuma chave Pix configurada para este estabelecimento.' });
    }

    const emvPayload = generatePixEmvPayload({
      chavePix: pixKeyConfig,
      nome: tenant_slug.toUpperCase(),
      valor: valorFinal,
      txid: String(appointment.id)
    });

    if (!emvPayload) {
      return res.status(422).json({ error: 'Erro ao gerar payload do Pix estático.' });
    }

    res.json({
      pixKey: emvPayload,
      paymentLink: null
    });

  } catch (err) {
    console.error('[GET APPOINTMENT PAYMENT ERROR]', err);
    res.status(500).json({ error: 'Falhou ao gerar cobrança de pagamento.' });
  }
});

export default router;

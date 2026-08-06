import express from 'express';
import { queryTenant } from '../db/postgres.mjs';
import { authMiddleware } from '../middleware/auth.mjs';

const router = express.Router();

// GET /api/notifications/public-key
router.get('/public-key', async (req, res) => {
  try {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
      return res.status(503).json({ error: 'Push notifications are not configured on the server.' });
    }
    res.json({ publicKey: key });
  } catch (err) {
    console.error('[GET VAPID KEY ERROR]', err);
    res.status(500).json({ error: 'Failed to retrieve public key.' });
  }
});

// POST /api/notifications/subscribe
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug, profissional_id } = req.user;
    const { endpoint, p256dh, auth, user_agent, plataforma } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint is required.' });
    }

    // Upsert subscription
    const result = await queryTenant(
      tenant_slug,
      `INSERT INTO push_subscriptions (
        endpoint, p256dh, auth, profissional_id, user_agent, plataforma, ativo, atualizado_em
      ) VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
      ON CONFLICT (endpoint)
      DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        profissional_id = EXCLUDED.profissional_id,
        user_agent = EXCLUDED.user_agent,
        plataforma = EXCLUDED.plataforma,
        ativo = true,
        atualizado_em = NOW()
      RETURNING *`,
      [endpoint, p256dh || null, auth || null, profissional_id, user_agent || null, plataforma || null]
    );

    res.status(201).json({ subscription: result.rows[0] });
  } catch (err) {
    console.error('[SUBSCRIBE ERROR]', err);
    res.status(500).json({ error: 'Failed to subscribe to notifications.' });
  }
});

// POST /api/notifications/unsubscribe
router.post('/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug } = req.user;
    const { endpoint } = req.body;

    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint is required.' });
    }

    await queryTenant(
      tenant_slug,
      'UPDATE push_subscriptions SET ativo = false, atualizado_em = NOW() WHERE endpoint = $1',
      [endpoint]
    );

    res.json({ message: 'Unsubscribed successfully.' });
  } catch (err) {
    console.error('[UNSUBSCRIBE ERROR]', err);
    res.status(500).json({ error: 'Failed to unsubscribe.' });
  }
});

// GET /api/notifications
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug, profissional_id } = req.user;
    const result = await queryTenant(
      tenant_slug,
      'SELECT id, titulo, mensagem, lida, created_at FROM notificacoes WHERE profissional_id = $1 ORDER BY created_at DESC LIMIT 50',
      [profissional_id]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    console.error('[GET NOTIFICATIONS ERROR]', err);
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug, profissional_id } = req.user;
    const { id } = req.params;

    const result = await queryTenant(
      tenant_slug,
      'UPDATE notificacoes SET lida = true WHERE id = $1 AND profissional_id = $2 RETURNING *',
      [id, profissional_id]
    );

    res.json({ notification: result.rows[0] });
  } catch (err) {
    console.error('[MARK READ ERROR]', err);
    res.status(500).json({ error: 'Failed to mark notification as read.' });
  }
});

// DELETE /api/notifications
router.delete('/', authMiddleware, async (req, res) => {
  try {
    const { tenant_slug, profissional_id } = req.user;
    await queryTenant(
      tenant_slug,
      'DELETE FROM notificacoes WHERE profissional_id = $1',
      [profissional_id]
    );
    res.json({ message: 'Notifications cleared.' });
  } catch (err) {
    console.error('[CLEAR NOTIFICATIONS ERROR]', err);
    res.status(500).json({ error: 'Failed to clear notifications.' });
  }
});

export default router;

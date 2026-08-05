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

export default router;

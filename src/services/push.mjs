import webpush from 'web-push';
import { queryTenant } from '../db/postgres.mjs';

// Setup VAPID keys from environment variables
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:suporte@acionar.online',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export async function sendPushNotification(tenantSlug, payload) {
  try {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      console.warn('[PUSH SERVICE] VAPID keys not configured. Skipping push.');
      return;
    }

    // Fetch active push subscriptions for this tenant
    const res = await queryTenant(
      tenantSlug,
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE ativo = true'
    );

    const subscriptions = res.rows;
    if (subscriptions.length === 0) {
      return;
    }

    const payloadStr = JSON.stringify(payload);

    // Dispatch push notifications in parallel
    const promises = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth
            }
          },
          payloadStr
        );
      } catch (err) {
        console.error(`[PUSH SERVICE] Failed to send push to subscription ID ${sub.id}:`, err);
        // If subscription has expired or is invalid, mark it as inactive (404 or 410 Gone)
        if (err.statusCode === 404 || err.statusCode === 410 || err.statusCode === 401 || err.statusCode === 403) {
          try {
            await queryTenant(
              tenantSlug,
              'UPDATE push_subscriptions SET ativo = false, atualizado_em = NOW() WHERE id = $1',
              [sub.id]
            );
            console.log(`[PUSH SERVICE] Subscription ID ${sub.id} marked as inactive due to error status ${err.statusCode}`);
          } catch (updateErr) {
            console.error('[PUSH SERVICE] Failed to update subscription status:', updateErr);
          }
        }
      }
    });

    await Promise.all(promises);
  } catch (err) {
    console.error('[PUSH SERVICE ERROR]', err);
  }
}

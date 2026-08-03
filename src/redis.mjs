import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
});

redisClient.on('error', (err) => console.error('[REDIS] Error:', err));
redisClient.on('connect', () => console.log('[REDIS] Connected to Redis server.'));

export async function initRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

export function getTenantRedisKey(tenantSlug, key) {
  return `tenant:${tenantSlug}:${key}`;
}

export default redisClient;

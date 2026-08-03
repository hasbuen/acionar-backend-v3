import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'acionar',
  password: process.env.PGPASSWORD || 'Bu1v742G36K850',
  database: process.env.PGDATABASE || 'acionar_v3',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/**
 * Clean and sanitize a tenant slug for schema usage
 */
export function getTenantSchemaName(slug) {
  const safeSlug = (slug || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^[^a-z_]/, 't_$');
  return `tenant_${safeSlug}`;
}

/**
 * Execute a query within a specific tenant's schema
 */
export async function queryTenant(tenantSlug, text, params = []) {
  const client = await pool.connect();
  try {
    const schemaName = getTenantSchemaName(tenantSlug);
    // Sanitize schema name before setting search_path
    await client.query(`SET search_path TO "${schemaName}", public;`);
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

/**
 * Execute a query in the public schema
 */
export async function queryPublic(text, params = []) {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO public;');
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

export default pool;

import pg from 'pg';
import { config } from './config.js';

// DATE columns come back as plain 'YYYY-MM-DD' strings (no TZ shifting).
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  const r = await pool.query<T>(text, params);
  return r.rows;
}

export async function audit(action: string, entity: string, entityId: string, detail: unknown = {}) {
  await pool.query('INSERT INTO admin_audit(action, entity, entity_id, detail) VALUES ($1,$2,$3,$4)', [
    action, entity, entityId, JSON.stringify(detail),
  ]);
}

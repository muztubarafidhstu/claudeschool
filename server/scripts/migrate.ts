import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
await pool.query(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
console.log('Schema applied.');
await pool.end();

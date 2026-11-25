import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

function readPem(inlineVar: string, pathVar: string): string {
  const inline = process.env[inlineVar];
  if (inline) return inline.replace(/\\n/g, '\n');
  const p = process.env[pathVar];
  if (p && fs.existsSync(path.resolve(p))) return fs.readFileSync(path.resolve(p), 'utf8');
  throw new Error(`Missing ${inlineVar} or ${pathVar}. Run "npm run keys" first.`);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  adminEmail: required('ADMIN_EMAIL').toLowerCase(),
  adminPasswordHash: required('ADMIN_PASSWORD_HASH'),
  adminJwtSecret: new TextEncoder().encode(required('ADMIN_JWT_SECRET')),
  privateKeyPem: readPem('LICENSE_PRIVATE_KEY_PEM', 'LICENSE_PRIVATE_KEY_PATH'),
  publicKeyPem: readPem('LICENSE_PUBLIC_KEY_PEM', 'LICENSE_PUBLIC_KEY_PATH'),
  graceDays: Number(process.env.GRACE_DAYS ?? 7),
  releasesDir: path.resolve(process.env.RELEASES_DIR ?? './releases'),
};

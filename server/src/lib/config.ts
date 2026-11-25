import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const b64 = (name: string) => (process.env[name] ? Buffer.from(process.env[name]!, 'base64').toString('utf8') : undefined);

function readPem(inlineVar: string, pathVar: string): string {
  // *_B64 variants avoid quoting problems in docker .env files.
  const fromB64 = b64(inlineVar.replace(/_PEM$/, '_B64'));
  if (fromB64) return fromB64;
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
  adminEmail: (process.env.ADMIN_EMAIL ?? 'owner').toLowerCase(),
  // bcrypt hashes contain "$", so docker .env files use the base64 form ADMIN_PASSWORD_HASH_B64.
  adminPasswordHash: b64('ADMIN_PASSWORD_HASH_B64') ?? required('ADMIN_PASSWORD_HASH'),
  adminJwtSecret: new TextEncoder().encode(required('ADMIN_JWT_SECRET')),
  privateKeyPem: readPem('LICENSE_PRIVATE_KEY_PEM', 'LICENSE_PRIVATE_KEY_PATH'),
  publicKeyPem: readPem('LICENSE_PUBLIC_KEY_PEM', 'LICENSE_PUBLIC_KEY_PATH'),
  graceDays: Number(process.env.GRACE_DAYS ?? 7),
  releasesDir: path.resolve(process.env.RELEASES_DIR ?? './releases'),
  /** Built admin panel (admin/out). When present, the same service serves the panel at "/". */
  adminStaticDir: path.resolve(process.env.ADMIN_STATIC_DIR ?? '../admin/out'),
  autoMigrate: process.env.AUTO_MIGRATE !== 'false',
};

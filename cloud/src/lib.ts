import { SignJWT, importPKCS8, jwtVerify, type KeyLike } from 'jose';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GRACE_DAYS: string;
  ADMIN_PASSWORD_HASH: string;
  ADMIN_JWT_SECRET?: string;
  LICENSE_PRIVATE_KEY: string;
  LICENSE_PUBLIC_KEY: string;
  EMERGENCY_SECRET?: string;
}

export const nowSec = () => Math.floor(Date.now() / 1000);
export const isoNow = () => new Date().toISOString();
export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const uuid = () => crypto.randomUUID();
const pem = (s: string) => s.replace(/\\n/g, '\n').trim() + '\n';

export function addPeriod(dateIso: string, cycle: string, count = 1): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (cycle === 'LIFETIME') return '2099-12-31';
  if (cycle === 'TRIAL') { d.setUTCDate(d.getUTCDate() + 14 * count); return d.toISOString().slice(0, 10); }
  const months = cycle === 'YEARLY' ? 12 * count : count;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const block = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join('');
/** e.g. SCH-2026-7KQ4-M9XD (school) / COA-2026-… (coaching) */
export const generateLicenseKey = (product = 'SCHOOL') => `${product === 'COACHING' ? 'COA' : 'SCH'}-${new Date().getUTCFullYear()}-${block(4)}-${block(4)}`;

// ---------- owner password: PBKDF2-SHA256 (native WebCrypto, light enough for the Workers CPU limit) ----------
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export async function hashPassword(password: string, iterations = 20000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [alg, it, salt, hash] = (stored ?? '').split('$');
  if (alg !== 'pbkdf2' || !salt || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(it));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

// ---------- tokens ----------
let privKey: KeyLike | null = null;
export async function signGraceToken(env: Env, c: Record<string, unknown>, now: number, validUntil: string) {
  privKey ??= await importPKCS8(pem(env.LICENSE_PRIVATE_KEY), 'RS256');
  const subEnd = Math.floor(Date.parse(`${validUntil}T23:59:59Z`) / 1000);
  const exp = Math.min(now + Number(env.GRACE_DAYS || 7) * 86400, subEnd);
  const jwt = await new SignJWT(c)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'sd-license-1' })
    .setIssuer('scholardesk-license-server')
    .setAudience('scholardesk-desktop')
    .setIssuedAt(now).setNotBefore(now - 300).setExpirationTime(exp)
    .sign(privKey!);
  return { jwt, exp };
}
export const publicKeyPem = (env: Env) => pem(env.LICENSE_PUBLIC_KEY);

/** Panel session key: ADMIN_JWT_SECRET if set, otherwise derived from the license private key (one secret fewer). */
async function hs(env: Env) {
  if (env.ADMIN_JWT_SECRET) return new TextEncoder().encode(env.ADMIN_JWT_SECRET);
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`scholardesk-admin-session:${env.LICENSE_PRIVATE_KEY}`));
  return new Uint8Array(d);
}
export const signAdmin = async (env: Env) =>
  new SignJWT({ role: 'owner' }).setProtectedHeader({ alg: 'HS256' }).setSubject('owner').setIssuedAt().setExpirationTime('12h').sign(await hs(env));
export async function verifyAdmin(env: Env, token: string) {
  const { payload } = await jwtVerify(token, await hs(env), { algorithms: ['HS256'] });
  if (payload.role !== 'owner') throw new Error('bad role');
}

// ---------- D1 helpers ----------
export const all = async <T = any>(db: D1Database, sql: string, ...p: unknown[]) => (await db.prepare(sql).bind(...p).all<T>()).results;
export const one = <T = any>(db: D1Database, sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p).first<T>();
export const run = (db: D1Database, sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p).run();

/** Fixed-window counter. Returns the count after incrementing. */
export async function bump(db: D1Database, key: string, windowSec: number) {
  const ws = Math.floor(nowSec() / windowSec) * windowSec;
  const r = await one<{ count: number }>(db,
    `INSERT INTO rate_limits(key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
                                    window_start = excluded.window_start
     RETURNING count`, key, ws);
  return r?.count ?? 1;
}
export async function peek(db: D1Database, key: string, windowSec: number) {
  const ws = Math.floor(nowSec() / windowSec) * windowSec;
  const r = await one<{ count: number; window_start: number }>(db, 'SELECT count, window_start FROM rate_limits WHERE key = ?', key);
  return r && r.window_start === ws ? r.count : 0;
}

export const audit = (db: D1Database, action: string, entity: string, id: string, detail: unknown = {}) =>
  run(db, 'INSERT INTO admin_audit(action, entity, entity_id, detail) VALUES (?,?,?,?)', action, entity, id, JSON.stringify(detail));

// ---------- emergency unlock codes (must match desktop/src-tauri/src/emergency.rs) ----------
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normLockId = (s: string) => { const d = s.replace(/\D/g, ''); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4)}` : null; };
export async function emergencyCode(secret: string, machineId: string, lockId: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${machineId}:${lockId}`)));
  return Array.from(mac.slice(0, 8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

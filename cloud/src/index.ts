/**
 * ScholarDesk license & subscription server on Cloudflare Workers + D1.
 * Serves the owner panel (static assets) and the API at https://school.rafid0.com
 * One system for both products: SCHOOL and COACHING (licenses.product).
 */
import { Hono, type Context, type Next } from 'hono';
import { cors } from 'hono/cors';
import { z, ZodError } from 'zod';
import {
  type Env, addPeriod, all, audit, bump, generateLicenseKey, isoNow, nowSec, one, peek, publicKeyPem, run,
  signAdmin, signGraceToken, todayUtc, uuid, verifyAdmin, verifyPassword,
} from './lib';

type C = Context<{ Bindings: Env }>;
const app = new Hono<{ Bindings: Env }>();
const api = new Hono<{ Bindings: Env }>();
const ip = (c: C) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: err.issues[0]?.message ?? 'Validation failed', issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Security headers for the panel + API
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Strict-Transport-Security', 'max-age=31536000');
});

// API is token-based (no cookies), so cross-origin calls are safe; the desktop app uses native HTTP anyway.
api.use('*', cors({ origin: '*', allowHeaders: ['content-type', 'authorization'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));

const PRODUCTS = ['SCHOOL', 'COACHING'] as const;
type Status = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'INVALID' | 'MACHINE_MISMATCH' | 'PENDING';

async function paymentInstructions(db: D1Database) {
  return (await one<{ value: string }>(db, "SELECT value FROM owner_settings WHERE key='payment_instructions'"))?.value ?? '';
}

// =============================================================================================== public
api.get('/health', (c) => c.json({ ok: true, server_utc_timestamp: nowSec() }));
api.get('/public-key', (c) => c.text(publicKeyPem(c.env)));

const VerifyBody = z.object({
  license_key: z.string().trim().toUpperCase().regex(/^(SCH|COA)-\d{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?$/),
  machine_id: z.string().trim().min(6).max(80),
  app_version: z.string().max(32).default('0.0.0'),
  student_count: z.number().int().min(0).max(100000).default(0),
  local_utc_timestamp: z.number().int().nonnegative(),
});

/**
 * Activation + heartbeat. First successful call binds the license to the PC.
 * ACTIVE responses carry a fresh RS256 grace token (7 days).
 * Writes are sampled (last_seen hourly, log on change or every 6 h) to stay within D1's free tier.
 */
api.post('/verify-license', async (c) => {
  const serverUtc = nowSec();
  const parsed = VerifyBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ status: 'INVALID', error: 'Malformed request', server_utc_timestamp: serverUtc }, 400);
  const b = parsed.data;
  const db = c.env.DB;
  const lic = await one<any>(db, `SELECT l.*, s.name AS school_name FROM licenses l JOIN schools s ON s.id = l.school_id WHERE l.license_key = ?`, b.license_key);
  let status: Status;
  let grace: { jwt: string; exp: number } | null = null;
  let notice = '';

  if (!lic) {
    status = 'INVALID';
  } else if (lic.machine_id && lic.machine_id !== b.machine_id) {
    status = 'MACHINE_MISMATCH';
  } else {
    if (lic.status === 'ACTIVE' && lic.valid_until < todayUtc()) {
      await run(db, `UPDATE licenses SET status='EXPIRED', updated_at=? WHERE id=?`, isoNow(), lic.id);
      lic.status = 'EXPIRED';
    }
    status = lic.status;
    notice = lic.payment_notice ?? '';
    if (status === 'ACTIVE' && b.student_count > lic.max_students) {
      notice = `Student count ${b.student_count} exceeds your plan limit (${lic.max_students}). Please upgrade.`;
    }
    const stale = !lic.last_seen_at || Date.now() - Date.parse(lic.last_seen_at) > 3_600_000;
    if (!lic.machine_id || stale || lic.last_app_version !== b.app_version || lic.last_student_count !== b.student_count) {
      await run(db,
        `UPDATE licenses SET machine_id = COALESCE(machine_id, ?), activated_at = COALESCE(activated_at, ?),
                last_seen_at = ?, last_app_version = ?, last_student_count = ?, last_ip = ? WHERE id = ?`,
        b.machine_id, isoNow(), isoNow(), b.app_version, b.student_count, ip(c), lic.id);
    }
    if (status === 'ACTIVE') {
      grace = await signGraceToken(c.env, { sub: lic.license_key, mid: b.machine_id, sch: lic.school_id, name: lic.school_name, vu: lic.valid_until, st: 'ACTIVE', prd: lic.product }, serverUtc, lic.valid_until);
    }
    const last = await one<any>(db, 'SELECT result_status, created_at FROM heartbeat_logs WHERE license_id = ? ORDER BY id DESC LIMIT 1', lic.id);
    if (!last || last.result_status !== status || Date.now() - Date.parse(last.created_at) > 6 * 3_600_000) {
      await run(db,
        `INSERT INTO heartbeat_logs(license_id, license_key, machine_id, app_version, student_count, client_utc, server_utc, clock_skew_sec, result_status, ip)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        lic.id, b.license_key, b.machine_id, b.app_version, b.student_count, b.local_utc_timestamp, serverUtc, b.local_utc_timestamp - serverUtc, status, ip(c));
    }
  }

  const instructions = await paymentInstructions(db);
  if (status === 'MACHINE_MISMATCH') notice = 'This license is already activated on another computer. Contact your software provider to transfer it.';
  else if (status === 'INVALID') notice = 'License key not recognised. Please check the key or contact your software provider.';
  else if (status === 'PENDING') notice = 'Your request has been received. The software unlocks automatically as soon as it is approved.';
  else if (status !== 'ACTIVE') notice = lic?.payment_notice || instructions;

  return c.json({
    status,
    product: lic?.product ?? null,
    school_name: lic?.school_name ?? null,
    valid_until: lic?.valid_until ?? null,
    server_utc_timestamp: serverUtc,
    grace_token_jwt: grace?.jwt ?? null,
    grace_expires_at: grace?.exp ?? null,
    grace_days: Number(c.env.GRACE_DAYS || 7),
    payment_notice: notice,
    payment_instructions: instructions,
  }, status === 'INVALID' ? 404 : 200);
});

const RegisterBody = z.object({
  product: z.enum(PRODUCTS).default('SCHOOL'),
  machine_id: z.string().trim().min(6).max(80),
  app_version: z.string().max(32).default('0.0.0'),
  school_name: z.string().trim().min(2).max(160),
  school_name_bn: z.string().trim().max(160).optional().nullable(),
  contact_person: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^01\d{9}$/, 'Mobile must be 11 digits starting with 01'),
  email: z.string().trim().max(160).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  district: z.string().trim().max(80).optional().nullable(),
  students_estimate: z.number().int().min(0).max(100000).optional().nullable(),
  requested_plan: z.enum(['TRIAL', 'MONTHLY', 'YEARLY']).default('TRIAL'),
});

/** Self-registration from a fresh install → PENDING request in the owner's panel. */
api.post('/register', async (c) => {
  const db = c.env.DB;
  if ((await bump(db, `reg:${ip(c)}`, 3600)) > 5) return c.json({ error: 'Too many requests from this network. Please try again later.' }, 429);
  const parsed = RegisterBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid form' }, 400);
  const b = parsed.data;
  const existing = await one<any>(db, 'SELECT license_key, status FROM licenses WHERE machine_id = ? ORDER BY created_at DESC LIMIT 1', b.machine_id);
  if (existing) return c.json({ license_key: existing.license_key, status: existing.status, existing: true });
  const schoolId = uuid(), licenseId = uuid();
  let key = generateLicenseKey(b.product);
  while (await one(db, 'SELECT 1 FROM licenses WHERE license_key = ?', key)) key = generateLicenseKey(b.product);
  await db.batch([
    db.prepare(`INSERT INTO schools(id, name, name_bn, contact_person, phone, email, address, district, students_estimate, notes)
                VALUES (?,?,?,?,?,?,?,?,?,'Registered from the desktop app')`)
      .bind(schoolId, b.school_name, b.school_name_bn ?? null, b.contact_person, b.phone, b.email ?? null, b.address ?? null, b.district ?? null, b.students_estimate ?? null),
    db.prepare(`INSERT INTO licenses(id, school_id, license_key, product, status, billing_cycle, valid_until, machine_id, source, requested_at, requested_plan, last_app_version)
                VALUES (?,?,?,?,'PENDING','TRIAL',?,?,'app',?,?,?)`)
      .bind(licenseId, schoolId, key, b.product, addPeriod(todayUtc(), 'TRIAL'), b.machine_id, isoNow(), b.requested_plan, b.app_version),
  ]);
  return c.json({ license_key: key, status: 'PENDING' }, 201);
});

/** Tauri updater: put releases/latest.json in the panel's assets (admin/public/releases/latest.json). */
api.get('/updates/:target/:arch/:current', async (c) => {
  const r = await c.env.ASSETS.fetch(new URL('/releases/latest.json', c.req.url));
  if (!r.ok) return c.body(null, 204);
  const m: any = await r.json().catch(() => null);
  const cmp = (a: string, b: string) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); return 0; };
  if (!m || cmp(String(m.version).replace(/^v/, ''), c.req.param('current')) <= 0) return c.body(null, 204);
  const p = m.platforms?.[`${c.req.param('target')}-${c.req.param('arch')}`];
  if (!p) return c.body(null, 204);
  return c.json({ version: m.version, notes: m.notes, pub_date: m.pub_date, url: p.url, signature: p.signature });
});

// =============================================================================================== admin
const admin = new Hono<{ Bindings: Env }>();

admin.post('/login', async (c) => {
  const db = c.env.DB;
  const who = ip(c);
  // Brute-force protection: 5 failures / 15 min per IP, 30 failures / hour for everyone.
  if ((await peek(db, `loginfail:${who}`, 900)) >= 5) return c.json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  if ((await peek(db, 'loginfail:all', 3600)) >= 30) return c.json({ error: 'Login is temporarily locked after many failed attempts. Try again later.' }, 429);
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await c.req.json().catch(() => ({})));
  if (!(await verifyPassword(password, c.env.ADMIN_PASSWORD_HASH))) {
    await bump(db, `loginfail:${who}`, 900);
    await bump(db, 'loginfail:all', 3600);
    return c.json({ error: 'Wrong password' }, 401);
  }
  return c.json({ token: await signAdmin(c.env) });
});

admin.use('*', async (c: C, next: Next) => {
  if (c.req.path.endsWith('/login')) return next();
  const h = c.req.header('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try { await verifyAdmin(c.env, token); } catch { return c.json({ error: 'Unauthorized' }, 401); }
  return next();
});

const productFilter = (c: C) => {
  const p = (c.req.query('product') ?? '').toUpperCase();
  return (PRODUCTS as readonly string[]).includes(p) ? p : null;
};

admin.get('/stats', async (c) => {
  const db = c.env.DB;
  const p = productFilter(c);
  const w = p ? 'WHERE product = ?' : '';
  const args = p ? [p] : [];
  const counts = await one<any>(db, `
    SELECT COUNT(*) AS total,
           SUM(status='ACTIVE' AND valid_until >= date('now')) AS active,
           SUM(status='SUSPENDED') AS suspended,
           SUM(status='PENDING') AS pending,
           SUM(status='EXPIRED' OR (status='ACTIVE' AND valid_until < date('now'))) AS expired,
           SUM(status='ACTIVE' AND valid_until BETWEEN date('now') AND date('now','+15 day')) AS expiring_soon,
           SUM(last_seen_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 day')) AS online_7d,
           COALESCE(SUM(last_student_count),0) AS students,
           SUM(product='SCHOOL') AS schools, SUM(product='COACHING') AS coachings
      FROM licenses ${w}`, ...args);
  const rev = await one<any>(db, `
    SELECT COALESCE(SUM(CASE WHEN strftime('%Y-%m', p.paid_at) = strftime('%Y-%m','now') THEN p.amount_bdt END),0) AS this_month,
           COALESCE(SUM(p.amount_bdt),0) AS all_time
      FROM payment_logs p JOIN licenses l ON l.id = p.license_id ${p ? 'WHERE l.product = ?' : ''}`, ...args);
  const recent = await all(db, `
    SELECT p.*, s.name AS school_name, l.license_key, l.product FROM payment_logs p
      JOIN licenses l ON l.id=p.license_id JOIN schools s ON s.id=l.school_id ${p ? 'WHERE l.product = ?' : ''}
     ORDER BY p.paid_at DESC LIMIT 10`, ...args);
  const n = (x: unknown) => Number(x ?? 0);
  return c.json({
    total: n(counts.total), active: n(counts.active), suspended: n(counts.suspended), pending: n(counts.pending), expired: n(counts.expired),
    expiring_soon: n(counts.expiring_soon), online_7d: n(counts.online_7d), students: n(counts.students),
    schools: n(counts.schools), coachings: n(counts.coachings),
    revenue_this_month: n(rev.this_month), revenue_all_time: n(rev.all_time), recent_payments: recent,
  });
});

const LIST_SQL = `
  SELECT s.*, l.id AS license_id, l.license_key, l.product, l.status, l.source, l.requested_at, l.requested_plan, l.billing_cycle, l.price_bdt,
         l.valid_until, l.max_students, l.machine_id, l.last_seen_at, l.last_app_version, l.last_student_count, l.suspend_reason, l.payment_notice,
         (l.valid_until < date('now')) AS is_past_due
    FROM schools s LEFT JOIN licenses l ON l.school_id = s.id`;
const fixRow = (r: any) => (r ? { ...r, is_past_due: !!r.is_past_due } : r);

admin.get('/pending', async (c) => {
  const p = productFilter(c);
  return c.json((await all(c.env.DB, `${LIST_SQL} WHERE l.status = 'PENDING' ${p ? 'AND l.product = ?' : ''} ORDER BY l.requested_at ASC`, ...(p ? [p] : []))).map(fixRow));
});

admin.get('/schools', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const p = productFilter(c);
  const where: string[] = []; const args: unknown[] = [];
  if (q) { where.push('(s.name LIKE ? OR s.phone LIKE ? OR l.license_key LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (p) { where.push('l.product = ?'); args.push(p); }
  return c.json((await all(c.env.DB, `${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.created_at DESC`, ...args)).map(fixRow));
});

admin.get('/schools/:id', async (c) => {
  const db = c.env.DB;
  const school = fixRow(await one(db, `${LIST_SQL} WHERE s.id = ?`, c.req.param('id')));
  if (!school) return c.json({ error: 'Not found' }, 404);
  const payments = await all(db, 'SELECT * FROM payment_logs WHERE license_id=? ORDER BY paid_at DESC', school.license_id);
  const heartbeats = await all(db, 'SELECT * FROM heartbeat_logs WHERE license_id=? ORDER BY id DESC LIMIT 50', school.license_id);
  return c.json({ school, payments, heartbeats });
});

const SchoolBody = z.object({
  name: z.string().min(2), name_bn: z.string().optional().nullable(), contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(), email: z.string().optional().nullable(), address: z.string().optional().nullable(),
  district: z.string().optional().nullable(), notes: z.string().optional().nullable(),
});

admin.post('/schools', async (c) => {
  const db = c.env.DB;
  const b = SchoolBody.extend({
    product: z.enum(PRODUCTS).default('SCHOOL'),
    billing_cycle: z.enum(['MONTHLY', 'YEARLY', 'LIFETIME', 'TRIAL']).default('YEARLY'),
    price_bdt: z.coerce.number().min(0).default(0),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    max_students: z.coerce.number().int().min(1).max(100000).default(2000),
  }).parse(await c.req.json());
  const schoolId = uuid(), licenseId = uuid();
  let key = generateLicenseKey(b.product);
  while (await one(db, 'SELECT 1 FROM licenses WHERE license_key = ?', key)) key = generateLicenseKey(b.product);
  const validUntil = b.valid_until ?? addPeriod(todayUtc(), b.billing_cycle);
  await db.batch([
    db.prepare('INSERT INTO schools(id,name,name_bn,contact_person,phone,email,address,district,notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(schoolId, b.name, b.name_bn ?? null, b.contact_person ?? null, b.phone ?? null, b.email ?? null, b.address ?? null, b.district ?? null, b.notes ?? null),
    db.prepare('INSERT INTO licenses(id, school_id, license_key, product, billing_cycle, price_bdt, valid_until, max_students) VALUES (?,?,?,?,?,?,?,?)')
      .bind(licenseId, schoolId, key, b.product, b.billing_cycle, b.price_bdt, validUntil, b.max_students),
  ]);
  await audit(db, 'CREATE_SCHOOL', 'school', schoolId, { license_key: key, product: b.product });
  return c.json({ school: await one(db, 'SELECT * FROM schools WHERE id=?', schoolId), license: await one(db, 'SELECT * FROM licenses WHERE id=?', licenseId) }, 201);
});

admin.patch('/schools/:id', async (c) => {
  const b = SchoolBody.partial().parse(await c.req.json());
  const keys = Object.keys(b) as (keyof typeof b)[];
  if (!keys.length) return c.json({ ok: true });
  await run(c.env.DB, `UPDATE schools SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => b[k] ?? null), isoNow(), c.req.param('id'));
  await audit(c.env.DB, 'UPDATE_SCHOOL', 'school', c.req.param('id'), b);
  return c.json(await one(c.env.DB, 'SELECT * FROM schools WHERE id=?', c.req.param('id')));
});

admin.delete('/schools/:id', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  // D1 does not enforce ON DELETE CASCADE unless foreign keys are on, so delete children explicitly.
  await db.batch([
    db.prepare('DELETE FROM heartbeat_logs WHERE license_id IN (SELECT id FROM licenses WHERE school_id = ?)').bind(id),
    db.prepare('DELETE FROM payment_logs WHERE license_id IN (SELECT id FROM licenses WHERE school_id = ?)').bind(id),
    db.prepare('DELETE FROM licenses WHERE school_id = ?').bind(id),
    db.prepare('DELETE FROM schools WHERE id = ?').bind(id),
  ]);
  await audit(db, 'DELETE_SCHOOL', 'school', id);
  return c.json({ ok: true });
});

admin.post('/licenses/:id/status', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  const { status, reason } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().optional() }).parse(await c.req.json());
  const lic = await one<any>(db, 'SELECT * FROM licenses WHERE id=?', id);
  if (!lic) return c.json({ error: 'Not found' }, 404);
  if (status === 'ACTIVE' && lic.valid_until < todayUtc()) return c.json({ error: 'Subscription date has passed. Record a payment or extend the expiry date first.' }, 409);
  await run(db, 'UPDATE licenses SET status=?, suspend_reason=?, updated_at=? WHERE id=?', status, status === 'SUSPENDED' ? (reason ?? 'Subscription payment pending') : null, isoNow(), id);
  await audit(db, status === 'ACTIVE' ? 'ACTIVATE' : 'SUSPEND', 'license', id, { reason });
  return c.json(await one(db, 'SELECT * FROM licenses WHERE id=?', id));
});

admin.post('/licenses/:id/approve', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  const b = z.object({
    billing_cycle: z.enum(['MONTHLY', 'YEARLY', 'LIFETIME', 'TRIAL']).default('TRIAL'),
    price_bdt: z.coerce.number().min(0).default(0),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    max_students: z.coerce.number().int().min(1).max(100000).default(2000),
  }).parse(await c.req.json());
  const validUntil = b.valid_until ?? addPeriod(todayUtc(), b.billing_cycle);
  const r = await run(db,
    `UPDATE licenses SET status='ACTIVE', billing_cycle=?, price_bdt=?, valid_until=?, max_students=?, suspend_reason=NULL,
            activated_at=COALESCE(activated_at, ?), updated_at=? WHERE id=?`,
    b.billing_cycle, b.price_bdt, validUntil, b.max_students, isoNow(), isoNow(), id);
  if (!r.meta.changes) return c.json({ error: 'Not found' }, 404);
  await audit(db, 'APPROVE', 'license', id, b);
  return c.json(await one(db, 'SELECT * FROM licenses WHERE id=?', id));
});

admin.patch('/licenses/:id', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  const b = z.object({
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    billing_cycle: z.enum(['MONTHLY', 'YEARLY', 'LIFETIME', 'TRIAL']).optional(),
    price_bdt: z.coerce.number().min(0).optional(),
    max_students: z.coerce.number().int().min(1).optional(),
    payment_notice: z.string().nullable().optional(),
    product: z.enum(PRODUCTS).optional(),
  }).parse(await c.req.json());
  const keys = Object.keys(b) as (keyof typeof b)[];
  if (keys.length) await run(db, `UPDATE licenses SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at=? WHERE id=?`, ...keys.map((k) => b[k] ?? null), isoNow(), id);
  if (b.valid_until && b.valid_until >= todayUtc()) await run(db, "UPDATE licenses SET status='ACTIVE' WHERE id=? AND status='EXPIRED'", id);
  await audit(db, 'UPDATE_LICENSE', 'license', id, b);
  return c.json(await one(db, 'SELECT * FROM licenses WHERE id=?', id));
});

admin.post('/licenses/:id/reset-machine', async (c) => {
  await run(c.env.DB, 'UPDATE licenses SET machine_id=NULL, activated_at=NULL, updated_at=? WHERE id=?', isoNow(), c.req.param('id'));
  await audit(c.env.DB, 'RESET_MACHINE', 'license', c.req.param('id'));
  return c.json(await one(c.env.DB, 'SELECT * FROM licenses WHERE id=?', c.req.param('id')));
});

admin.post('/licenses/:id/regenerate-key', async (c) => {
  const lic = await one<any>(c.env.DB, 'SELECT product FROM licenses WHERE id=?', c.req.param('id'));
  if (!lic) return c.json({ error: 'Not found' }, 404);
  await run(c.env.DB, 'UPDATE licenses SET license_key=?, machine_id=NULL, activated_at=NULL, updated_at=? WHERE id=?', generateLicenseKey(lic.product), isoNow(), c.req.param('id'));
  await audit(c.env.DB, 'REGENERATE_KEY', 'license', c.req.param('id'));
  return c.json(await one(c.env.DB, 'SELECT * FROM licenses WHERE id=?', c.req.param('id')));
});

admin.post('/licenses/:id/payments', async (c) => {
  const db = c.env.DB, id = c.req.param('id');
  const b = z.object({
    amount_bdt: z.coerce.number().min(0),
    method: z.string().min(2),
    transaction_ref: z.string().optional().nullable(),
    periods: z.coerce.number().int().min(0).max(60).default(1),
    extend_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    note: z.string().optional().nullable(),
    paid_at: z.string().optional(),
  }).parse(await c.req.json());
  const lic = await one<any>(db, 'SELECT * FROM licenses WHERE id=?', id);
  if (!lic) return c.json({ error: 'Not found' }, 404);
  const base = lic.valid_until > todayUtc() ? lic.valid_until : todayUtc();
  const extendedTo = b.extend_to ?? (b.periods > 0 ? addPeriod(base, lic.billing_cycle, b.periods) : lic.valid_until);
  const payId = uuid();
  const active = extendedTo >= todayUtc();
  await db.batch([
    db.prepare(`INSERT INTO payment_logs(id, license_id, amount_bdt, method, transaction_ref, period_from, period_to, extended_to, note, paid_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(payId, id, b.amount_bdt, b.method, b.transaction_ref ?? null, base, extendedTo, extendedTo, b.note ?? null, b.paid_at ? new Date(b.paid_at).toISOString() : isoNow()),
    db.prepare(`UPDATE licenses SET valid_until=?, status=CASE WHEN ? THEN 'ACTIVE' ELSE status END,
                       suspend_reason=CASE WHEN ? THEN NULL ELSE suspend_reason END, updated_at=? WHERE id=?`)
      .bind(extendedTo, active ? 1 : 0, active ? 1 : 0, isoNow(), id),
  ]);
  await audit(db, 'PAYMENT', 'license', id, { amount: b.amount_bdt, extendedTo });
  return c.json(await one(db, 'SELECT * FROM payment_logs WHERE id=?', payId), 201);
});

admin.get('/payments', async (c) => {
  const p = productFilter(c);
  return c.json(await all(c.env.DB, `SELECT p.*, s.name AS school_name, l.license_key, l.product FROM payment_logs p
    JOIN licenses l ON l.id=p.license_id JOIN schools s ON s.id=l.school_id ${p ? 'WHERE l.product = ?' : ''} ORDER BY p.paid_at DESC LIMIT 500`, ...(p ? [p] : [])));
});

admin.get('/settings', async (c) => {
  const rows = await all<{ key: string; value: string }>(c.env.DB, 'SELECT key, value FROM owner_settings');
  return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

admin.put('/settings', async (c) => {
  const b = z.record(z.string()).parse(await c.req.json());
  for (const [k, v] of Object.entries(b)) {
    await run(c.env.DB, 'INSERT INTO owner_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', k, v);
  }
  await audit(c.env.DB, 'UPDATE_SETTINGS', 'settings', '-', Object.keys(b));
  return c.json({ ok: true });
});

/** One-click backup of the whole license database (JSON). */
admin.get('/export', async (c) => {
  const db = c.env.DB;
  const data: Record<string, unknown[]> = {};
  for (const t of ['schools', 'licenses', 'payment_logs', 'owner_settings']) data[t] = await all(db, `SELECT * FROM ${t}`);
  c.header('content-disposition', `attachment; filename="scholardesk-licenses-${todayUtc()}.json"`);
  return c.json({ type: 'scholardesk-license-backup', exported_at: isoNow(), ...data });
});

api.route('/admin', admin);
app.route('/api/v1', api);
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Anything else: the static panel (assets are normally served before the Worker even runs).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

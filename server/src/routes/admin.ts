import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { audit, pool, q } from '../lib/db.js';
import { asyncH, requireOwner } from '../lib/auth.js';
import { signAdminSession } from '../lib/tokens.js';
import { config } from '../lib/config.js';
import { generateLicenseKey } from '../lib/keys.js';
import { addPeriod, todayUtc } from '../lib/dates.js';

export const adminRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10 });

adminRouter.post('/login', loginLimiter, asyncH(async (req, res) => {
  const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(req.body);
  const ok = email.toLowerCase() === config.adminEmail && (await bcrypt.compare(password, config.adminPasswordHash));
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ token: await signAdminSession(config.adminEmail) });
}));

adminRouter.use(requireOwner);

// ---------- Dashboard ----------
adminRouter.get('/stats', asyncH(async (_req, res) => {
  const [counts] = await q(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status='ACTIVE' AND valid_until >= CURRENT_DATE)::int AS active,
           COUNT(*) FILTER (WHERE status='SUSPENDED')::int AS suspended,
           COUNT(*) FILTER (WHERE status='EXPIRED' OR valid_until < CURRENT_DATE)::int AS expired,
           COUNT(*) FILTER (WHERE status='ACTIVE' AND valid_until BETWEEN CURRENT_DATE AND CURRENT_DATE + 15)::int AS expiring_soon,
           COUNT(*) FILTER (WHERE last_seen_at > now() - interval '7 days')::int AS online_7d,
           COALESCE(SUM(last_student_count),0)::int AS students
      FROM licenses`);
  const [rev] = await q(`
    SELECT COALESCE(SUM(amount_bdt) FILTER (WHERE date_trunc('month', paid_at) = date_trunc('month', now())),0) AS this_month,
           COALESCE(SUM(amount_bdt),0) AS all_time FROM payment_logs`);
  const recentPayments = await q(`
    SELECT p.*, s.name AS school_name, l.license_key FROM payment_logs p
      JOIN licenses l ON l.id=p.license_id JOIN schools s ON s.id=l.school_id
     ORDER BY p.paid_at DESC LIMIT 10`);
  res.json({ ...counts, revenue_this_month: rev.this_month, revenue_all_time: rev.all_time, recent_payments: recentPayments });
}));

// ---------- Schools + licenses ----------
const LIST_SQL = `
  SELECT s.*, l.id AS license_id, l.license_key, l.status, l.billing_cycle, l.price_bdt, l.valid_until, l.max_students,
         l.machine_id, l.last_seen_at, l.last_app_version, l.last_student_count, l.suspend_reason, l.payment_notice,
         (l.valid_until < CURRENT_DATE) AS is_past_due
    FROM schools s LEFT JOIN licenses l ON l.school_id = s.id`;

adminRouter.get('/schools', asyncH(async (req, res) => {
  const search = String(req.query.q ?? '').trim();
  const rows = search
    ? await q(`${LIST_SQL} WHERE s.name ILIKE $1 OR s.phone ILIKE $1 OR l.license_key ILIKE $1 ORDER BY s.created_at DESC`, [`%${search}%`])
    : await q(`${LIST_SQL} ORDER BY s.created_at DESC`);
  res.json(rows);
}));

adminRouter.get('/schools/:id', asyncH(async (req, res) => {
  const [school] = await q(`${LIST_SQL} WHERE s.id = $1`, [req.params.id]);
  if (!school) return res.status(404).json({ error: 'Not found' });
  const payments = await q(`SELECT * FROM payment_logs WHERE license_id=$1 ORDER BY paid_at DESC`, [school.license_id]);
  const heartbeats = await q(`SELECT * FROM heartbeat_logs WHERE license_id=$1 ORDER BY created_at DESC LIMIT 50`, [school.license_id]);
  res.json({ school, payments, heartbeats });
}));

const SchoolBody = z.object({
  name: z.string().min(2),
  name_bn: z.string().optional().nullable(),
  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

adminRouter.post('/schools', asyncH(async (req, res) => {
  const body = SchoolBody.extend({
    billing_cycle: z.enum(['MONTHLY', 'YEARLY', 'LIFETIME', 'TRIAL']).default('YEARLY'),
    price_bdt: z.coerce.number().min(0).default(0),
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    max_students: z.coerce.number().int().min(1).max(100000).default(2000),
  }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query(
      `INSERT INTO schools(name,name_bn,contact_person,phone,email,address,district,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [body.name, body.name_bn, body.contact_person, body.phone, body.email, body.address, body.district, body.notes]);
    let key = generateLicenseKey();
    for (let i = 0; i < 5; i++) {
      const { rowCount } = await client.query('SELECT 1 FROM licenses WHERE license_key=$1', [key]);
      if (!rowCount) break;
      key = generateLicenseKey();
    }
    const validUntil = body.valid_until ?? addPeriod(todayUtc(), body.billing_cycle);
    const { rows: [l] } = await client.query(
      `INSERT INTO licenses(school_id, license_key, billing_cycle, price_bdt, valid_until, max_students)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [s.id, key, body.billing_cycle, body.price_bdt, validUntil, body.max_students]);
    await client.query('COMMIT');
    await audit('CREATE_SCHOOL', 'school', s.id, { license_key: key });
    res.status(201).json({ school: s, license: l });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

adminRouter.patch('/schools/:id', asyncH(async (req, res) => {
  const b = SchoolBody.partial().parse(req.body);
  const keys = Object.keys(b) as (keyof typeof b)[];
  if (!keys.length) return res.json({ ok: true });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const [row] = await q(`UPDATE schools SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`, [req.params.id, ...keys.map((k) => b[k])]);
  await audit('UPDATE_SCHOOL', 'school', req.params.id, b);
  res.json(row);
}));

adminRouter.delete('/schools/:id', asyncH(async (req, res) => {
  await q('DELETE FROM schools WHERE id=$1', [req.params.id]);
  await audit('DELETE_SCHOOL', 'school', req.params.id);
  res.json({ ok: true });
}));

// ---------- Remote ACTIVATE / SUSPEND ----------
adminRouter.post('/licenses/:id/status', asyncH(async (req, res) => {
  const { status, reason } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().optional() }).parse(req.body);
  const [lic] = await q(`SELECT * FROM licenses WHERE id=$1`, [req.params.id]);
  if (!lic) return res.status(404).json({ error: 'Not found' });
  if (status === 'ACTIVE' && lic.valid_until < todayUtc()) {
    return res.status(409).json({ error: 'Subscription date has passed. Record a payment or extend the expiry date first.' });
  }
  const [row] = await q(
    `UPDATE licenses SET status=$2, suspend_reason=$3, updated_at=now() WHERE id=$1 RETURNING *`,
    [req.params.id, status, status === 'SUSPENDED' ? (reason ?? 'Subscription payment pending') : null]);
  await audit(status === 'ACTIVE' ? 'ACTIVATE' : 'SUSPEND', 'license', req.params.id, { reason });
  res.json(row);
}));

adminRouter.patch('/licenses/:id', asyncH(async (req, res) => {
  const b = z.object({
    valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    billing_cycle: z.enum(['MONTHLY', 'YEARLY', 'LIFETIME', 'TRIAL']).optional(),
    price_bdt: z.coerce.number().min(0).optional(),
    max_students: z.coerce.number().int().min(1).optional(),
    payment_notice: z.string().nullable().optional(),
  }).parse(req.body);
  const keys = Object.keys(b) as (keyof typeof b)[];
  if (!keys.length) return res.json({ ok: true });
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  let [row] = await q(`UPDATE licenses SET ${sets}, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id, ...keys.map((k) => b[k])]);
  if (b.valid_until && row.status === 'EXPIRED' && b.valid_until >= todayUtc()) {
    [row] = await q(`UPDATE licenses SET status='ACTIVE', updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id]);
  }
  await audit('UPDATE_LICENSE', 'license', req.params.id, b);
  res.json(row);
}));

/** Unbind the PC so the school can activate on a new computer. */
adminRouter.post('/licenses/:id/reset-machine', asyncH(async (req, res) => {
  const [row] = await q(`UPDATE licenses SET machine_id=NULL, activated_at=NULL, updated_at=now() WHERE id=$1 RETURNING *`, [req.params.id]);
  await audit('RESET_MACHINE', 'license', req.params.id);
  res.json(row);
}));

adminRouter.post('/licenses/:id/regenerate-key', asyncH(async (req, res) => {
  const [row] = await q(`UPDATE licenses SET license_key=$2, machine_id=NULL, activated_at=NULL, updated_at=now() WHERE id=$1 RETURNING *`,
    [req.params.id, generateLicenseKey()]);
  await audit('REGENERATE_KEY', 'license', req.params.id);
  res.json(row);
}));

// ---------- Payments (auto-extends expiry & re-activates) ----------
adminRouter.post('/licenses/:id/payments', asyncH(async (req, res) => {
  const b = z.object({
    amount_bdt: z.coerce.number().min(0),
    method: z.string().min(2),
    transaction_ref: z.string().optional().nullable(),
    periods: z.coerce.number().int().min(0).max(60).default(1),   // how many billing cycles this pays for
    extend_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // or an explicit date
    note: z.string().optional().nullable(),
    paid_at: z.string().optional(),
  }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [lic] } = await client.query('SELECT * FROM licenses WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!lic) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const base = lic.valid_until > todayUtc() ? lic.valid_until : todayUtc();
    const extendedTo = b.extend_to ?? (b.periods > 0 ? addPeriod(base, lic.billing_cycle, b.periods) : lic.valid_until);
    const { rows: [p] } = await client.query(
      `INSERT INTO payment_logs(license_id, amount_bdt, method, transaction_ref, period_from, period_to, extended_to, note, paid_at)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,COALESCE($8::timestamptz, now())) RETURNING *`,
      [lic.id, b.amount_bdt, b.method, b.transaction_ref, base, extendedTo, b.note, b.paid_at ?? null]);
    await client.query(
      `UPDATE licenses SET valid_until=$2,
              status = CASE WHEN $2::date >= CURRENT_DATE THEN 'ACTIVE'::license_status ELSE status END,
              suspend_reason = CASE WHEN $2::date >= CURRENT_DATE THEN NULL ELSE suspend_reason END,
              updated_at=now() WHERE id=$1`, [lic.id, extendedTo]);
    await client.query('COMMIT');
    await audit('PAYMENT', 'license', lic.id, { amount: b.amount_bdt, extendedTo });
    res.status(201).json(p);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

adminRouter.get('/payments', asyncH(async (_req, res) => {
  res.json(await q(`SELECT p.*, s.name AS school_name, l.license_key FROM payment_logs p
    JOIN licenses l ON l.id=p.license_id JOIN schools s ON s.id=l.school_id ORDER BY p.paid_at DESC LIMIT 500`));
}));

// ---------- Owner settings ----------
adminRouter.get('/settings', asyncH(async (_req, res) => {
  const rows = await q<{ key: string; value: string }>('SELECT key, value FROM owner_settings');
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

adminRouter.put('/settings', asyncH(async (req, res) => {
  const b = z.record(z.string()).parse(req.body);
  for (const [k, v] of Object.entries(b)) {
    await q(`INSERT INTO owner_settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [k, v]);
  }
  await audit('UPDATE_SETTINGS', 'settings', '-', Object.keys(b));
  res.json({ ok: true });
}));

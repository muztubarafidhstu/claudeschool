import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool, q } from '../lib/db.js';
import { asyncH } from '../lib/auth.js';
import { signGraceToken } from '../lib/tokens.js';
import { config } from '../lib/config.js';
import { addPeriod, todayUtc } from '../lib/dates.js';
import { generateLicenseKey } from '../lib/keys.js';

export const publicRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

const VerifyBody = z.object({
  license_key: z.string().trim().toUpperCase().regex(/^SCH-\d{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?$/),
  machine_id: z.string().trim().min(6).max(80),
  app_version: z.string().max(32).default('0.0.0'),
  student_count: z.number().int().min(0).max(100000).default(0),
  local_utc_timestamp: z.number().int().nonnegative(),
});

type Status = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'INVALID' | 'MACHINE_MISMATCH' | 'PENDING';

async function paymentInstructions(override?: string | null) {
  if (override) return override;
  const r = await q<{ value: string }>("SELECT value FROM owner_settings WHERE key='payment_instructions'");
  return r[0]?.value ?? '';
}

/**
 * POST /api/v1/verify-license
 * Called on first activation and as the periodic heartbeat. The first successful call binds the
 * license to the PC's machine_id. ACTIVE responses carry a fresh RS256 grace token (7 days).
 */
publicRouter.post('/verify-license', limiter, asyncH(async (req, res) => {
  const parsed = VerifyBody.safeParse(req.body);
  const serverUtc = Math.floor(Date.now() / 1000);
  if (!parsed.success) {
    return res.status(400).json({ status: 'INVALID', error: 'Malformed request', server_utc_timestamp: serverUtc });
  }
  const b = parsed.data;
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT l.*, s.name AS school_name FROM licenses l JOIN schools s ON s.id = l.school_id
        WHERE l.license_key = $1 FOR UPDATE OF l`, [b.license_key]);
    const lic = rows[0];
    let status: Status;
    let grace: { jwt: string; exp: number } | null = null;

    if (!lic) {
      status = 'INVALID';
    } else if (lic.machine_id && lic.machine_id !== b.machine_id) {
      status = 'MACHINE_MISMATCH';
    } else {
      if (lic.status === 'ACTIVE' && lic.valid_until < todayUtc()) {
        await client.query(`UPDATE licenses SET status='EXPIRED', updated_at=now() WHERE id=$1`, [lic.id]);
        lic.status = 'EXPIRED';
      }
      status = lic.status;
      if (lic.status === 'ACTIVE' && b.student_count > lic.max_students) {
        // Over the plan's capacity: stay active but tell the school (owner sees it in the panel).
        lic.payment_notice = `Student count ${b.student_count} exceeds your plan limit (${lic.max_students}). Please upgrade.`;
      }
      await client.query(
        `UPDATE licenses SET machine_id = COALESCE(machine_id, $2),
                activated_at = COALESCE(activated_at, now()),
                last_seen_at = now(), last_app_version = $3, last_student_count = $4, last_ip = $5, updated_at = now()
          WHERE id = $1`, [lic.id, b.machine_id, b.app_version, b.student_count, ip]);
      if (status === 'ACTIVE') {
        grace = await signGraceToken(
          { sub: lic.license_key, mid: b.machine_id, sch: lic.school_id, name: lic.school_name, vu: lic.valid_until, st: 'ACTIVE' },
          serverUtc, lic.valid_until);
      }
    }

    await client.query(
      `INSERT INTO heartbeat_logs(license_id, license_key, machine_id, app_version, student_count, client_utc, server_utc, clock_skew_sec, result_status, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [lic?.id ?? null, b.license_key, b.machine_id, b.app_version, b.student_count, b.local_utc_timestamp, serverUtc,
       b.local_utc_timestamp - serverUtc, status, ip]);
    await client.query('COMMIT');

    const notice =
      status === 'MACHINE_MISMATCH'
        ? 'This license is already activated on another computer. Contact your software provider to transfer it.'
        : status === 'PENDING'
          ? 'Your request has been received. The software unlocks automatically as soon as it is approved.'
        : status === 'INVALID'
          ? 'License key not recognised. Please check the key or contact your software provider.'
          : status === 'ACTIVE'
            ? (lic.payment_notice ?? '')
            : await paymentInstructions(lic?.payment_notice);

    res.status(status === 'INVALID' ? 404 : 200).json({
      status,
      school_name: lic?.school_name ?? null,
      valid_until: lic?.valid_until ?? null,
      server_utc_timestamp: serverUtc,
      grace_token_jwt: grace?.jwt ?? null,
      grace_expires_at: grace?.exp ?? null,
      grace_days: config.graceDays,
      payment_notice: notice,
      payment_instructions: await paymentInstructions(),
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

/** Public key so you can rotate / audit what the desktop builds embed. */
publicRouter.get('/public-key', (_req, res) => res.type('text/plain').send(config.publicKeyPem));
publicRouter.get('/health', (_req, res) => res.json({ ok: true, server_utc_timestamp: Math.floor(Date.now() / 1000) }));

// ---------------------------------------------------------------------------------------------
// Self-registration from a freshly installed desktop app. Creates the school + a PENDING license
// bound to this PC. The owner approves (or rejects) it in the panel; the app then unlocks itself.
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many requests from this network. Please try again later.' } });

const RegisterBody = z.object({
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

publicRouter.post('/register', registerLimiter, asyncH(async (req, res) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid form' });
  const b = parsed.data;
  // One request per PC: return the existing license if this machine already registered.
  const [existing] = await q(`SELECT l.license_key, l.status FROM licenses l WHERE l.machine_id = $1 ORDER BY l.created_at DESC LIMIT 1`, [b.machine_id]);
  if (existing) return res.json({ license_key: existing.license_key, status: existing.status, existing: true });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [s] } = await client.query(
      `INSERT INTO schools(name, name_bn, contact_person, phone, email, address, district, students_estimate, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Registered from the desktop app') RETURNING id`,
      [b.school_name, b.school_name_bn, b.contact_person, b.phone, b.email, b.address, b.district, b.students_estimate]);
    let key = generateLicenseKey();
    for (let i = 0; i < 5; i++) { const r = await client.query('SELECT 1 FROM licenses WHERE license_key=$1', [key]); if (!r.rowCount) break; key = generateLicenseKey(); }
    await client.query(
      `INSERT INTO licenses(school_id, license_key, status, billing_cycle, valid_until, machine_id, source, requested_at, requested_plan, last_app_version)
       VALUES ($1,$2,'PENDING','TRIAL',$3,$4,'app',now(),$5,$6)`,
      [s.id, key, addPeriod(todayUtc(), 'TRIAL'), b.machine_id, b.requested_plan, b.app_version]);
    await client.query('COMMIT');
    res.status(201).json({ license_key: key, status: 'PENDING' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}));

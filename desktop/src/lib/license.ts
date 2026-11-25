/**
 * Licensing engine: activation, heartbeat, 7-day offline grace and anti-clock-tampering.
 *
 * Lock rules (any → full-screen lock):
 *   1. No valid RS256 grace token (bad signature / expired / other machine)          → OFFLINE_TOO_LONG / INVALID
 *   2. now < max(last_known_utc, token.iat) - tolerance (PC clock rolled backward)  → CLOCK_TAMPER
 *   3. now - last_online_sync > 7 days                                              → OFFLINE_TOO_LONG
 *   4. Last server status !== ACTIVE (owner turned it OFF / expired)                → SUSPENDED / EXPIRED
 */
import { decodeJwt, importSPKI, jwtVerify } from 'jose';
import { getConfig, setConfig } from './config';
import { getMachineId, httpFetch, invoke, isTauri } from './platform';
import { db } from './db';
import publicKeyPem from '../../src-tauri/keys/license_public.pem?raw';

export const LICENSE_API = import.meta.env.VITE_LICENSE_API ?? 'https://school.rafid0.com/api/v1';
export const APP_VERSION = '1.0.0';
/** One installer for both products; the server decides SCHOOL / COACHING from the license key. */
export const PRODUCT_NAME = { SCHOOL: 'ScholarDesk Pro — School', COACHING: 'ScholarDesk Pro — Coaching' } as const;
export const GRACE_SECONDS = 7 * 86400;
const CLOCK_TOLERANCE = 10 * 60; // 10 minutes of normal drift allowed

export type ServerStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'INVALID' | 'MACHINE_MISMATCH' | 'PENDING';
export interface LicenseState {
  license_key: string;
  machine_id: string;
  status: ServerStatus;
  school_name: string | null;
  valid_until: string | null;
  grace_token: string | null;
  last_known_utc: number;
  last_online_sync: number;
  payment_notice: string;
  payment_instructions: string;
  /** Decided by the server from the license key: SCHOOL or COACHING. */
  product?: 'SCHOOL' | 'COACHING';
  /** Salted hash of the owner's emergency PIN (pbkdf2$iterations$salt$hash), refreshed on every online check. */
  emergency_pin_hash?: string | null;
}
export type LockReason = 'NEEDS_ACTIVATION' | 'PENDING' | 'CLOCK_TAMPER' | 'OFFLINE_TOO_LONG' | 'SUSPENDED' | 'EXPIRED' | 'INVALID' | 'MACHINE_MISMATCH';
export interface Evaluation {
  locked: boolean;
  reason?: LockReason;
  state: LicenseState | null;
  daysLeftOffline?: number;
  daysToExpiry?: number;
  /** Set when the app runs on a 5-day emergency code although the license is locked. */
  emergency?: { daysLeft: number; until: number; reason: LockReason };
}

// ---------------------------------------------------------------- emergency unlock (5 days, once per lock)
export const EMERGENCY_DAYS = 5;
interface EmergencyGrant { lock_id: string; granted_at: number; until: number; last_seen: number }

/**
 * Lock ID shown on the lock screen. It only changes after a successful online verification
 * (last_online_sync), so each lock period allows exactly one emergency code.
 */
export async function currentLockId(st: LicenseState | null): Promise<string> {
  const mid = st?.machine_id || (await getMachineId());
  const raw = `${mid}:${st?.license_key ?? 'none'}:${st?.last_online_sync ?? 0}`;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  const n = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
  const digits = String(n % 100000000).padStart(8, '0');
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

// Development-only fallback so the browser preview can exercise the screens (never set in real builds).
const DEV_SECRET = import.meta.env.DEV ? (import.meta.env.VITE_DEV_EMERGENCY_SECRET as string | undefined) : undefined;
async function devCode(mid: string, lockId: string) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(DEV_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const m = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${mid}:${lockId}`)));
  return Array.from(m.slice(0, 8), (b) => A[b % A.length]).join('');
}

async function pinMatches(pin: string, stored?: string | null) {
  const [alg, it, salt, hash] = (stored ?? '').split('$');
  if (alg !== 'pbkdf2' || !salt || !hash) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)), iterations: Number(it) }, key, 256));
  return btoa(String.fromCharCode(...bits)) === hash;
}

export async function emergencyAvailable() {
  if ((await loadLicense())?.emergency_pin_hash) return true; // owner's emergency PIN
  if (isTauri) return invoke<boolean>('emergency_available').catch(() => false);
  return !!DEV_SECRET;
}

export async function applyEmergencyCode(code: string): Promise<{ ok: boolean; message: string }> {
  const st = await loadLicense();
  const lockId = await currentLockId(st);
  const prev = await getConfig<EmergencyGrant | null>('emergency', null);
  if (prev?.lock_id === lockId) return { ok: false, message: 'An emergency code was already used for this lock. Please pay and activate the subscription online.' };
  const typed = code.trim();
  const valid = (/^\d{4,8}$/.test(typed) && await pinMatches(typed, st?.emergency_pin_hash)) || (isTauri
    ? await invoke<boolean>('verify_emergency_code', { lockId, code }).catch(() => false)
    : !!DEV_SECRET && (await devCode(await getMachineId(), lockId)) === code.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
  if (!valid) return { ok: false, message: 'This PIN / code is not correct.' };
  const now = nowUtc();
  await setConfig('emergency', { lock_id: lockId, granted_at: now, until: now + EMERGENCY_DAYS * 86400, last_seen: now } satisfies EmergencyGrant);
  return { ok: true, message: `Unlocked for ${EMERGENCY_DAYS} days.` };
}

async function emergencyOverride(locked: Evaluation): Promise<Evaluation> {
  const g = await getConfig<EmergencyGrant | null>('emergency', null);
  if (!g) return locked;
  const now = nowUtc();
  if (g.lock_id !== (await currentLockId(locked.state))) return locked;
  if (now + CLOCK_TOLERANCE < g.last_seen || now > g.until) return locked; // expired or clock rolled back
  if (now > g.last_seen) await setConfig('emergency', { ...g, last_seen: now });
  return { locked: false, state: locked.state, emergency: { daysLeft: Math.max(1, Math.ceil((g.until - now) / 86400)), until: g.until, reason: locked.reason! } };
}

interface Claims { sub: string; mid: string; vu: string; iat: number; exp: number; name: string }

const nowUtc = () => Math.floor(Date.now() / 1000);

async function verifyToken(token: string): Promise<Claims | null> {
  try {
    if (isTauri) return await invoke<Claims>('verify_grace_token', { token });
    const key = await importSPKI(publicKeyPem, 'RS256');
    const { payload } = await jwtVerify(token, key, { audience: 'scholardesk-desktop', issuer: 'scholardesk-license-server', algorithms: ['RS256'] });
    const c = payload as unknown as Claims;
    return c.mid === (await getMachineId()) ? c : null;
  } catch {
    return null;
  }
}

export const loadLicense = () => getConfig<LicenseState | null>('license', null);
const saveLicense = (s: LicenseState) => setConfig('license', s);

export async function evaluate(): Promise<Evaluation> {
  const e = await evaluateLicense();
  return e.locked ? emergencyOverride(e) : e;
}

async function evaluateLicense(): Promise<Evaluation> {
  const st = await loadLicense();
  if (!st?.license_key) return { locked: true, reason: 'NEEDS_ACTIVATION', state: st };
  const now = nowUtc();
  const claims = st.grace_token ? await verifyToken(st.grace_token) : null;
  // Signed issue-time is a floor that cannot be edited in SQLite.
  const signedFloor = st.grace_token ? (decodeJwt(st.grace_token).iat ?? 0) : 0;
  const floor = Math.max(st.last_known_utc, signedFloor);
  const base: Evaluation = { locked: true, state: st };

  if (now + CLOCK_TOLERANCE < floor) return { ...base, reason: 'CLOCK_TAMPER' };
  if (st.status !== 'ACTIVE') return { ...base, reason: st.status as LockReason };
  if (!claims || claims.sub !== st.license_key || claims.mid !== st.machine_id) return { ...base, reason: 'OFFLINE_TOO_LONG' };
  if (now - st.last_online_sync > GRACE_SECONDS) return { ...base, reason: 'OFFLINE_TOO_LONG' };

  if (now > st.last_known_utc) await saveLicense({ ...st, last_known_utc: now });
  const daysLeftOffline = Math.max(0, Math.ceil((Math.min(claims.exp, st.last_online_sync + GRACE_SECONDS) - now) / 86400));
  const daysToExpiry = st.valid_until ? Math.ceil((Date.parse(`${st.valid_until}T23:59:59Z`) / 1000 - now) / 86400) : undefined;
  return { locked: false, state: st, daysLeftOffline, daysToExpiry };
}

export interface SyncResult { ok: boolean; status?: ServerStatus; message?: string }

/** Heartbeat / activation. Also used by "Verify Payment & Sync Online Now" and Google Drive backup. */
export async function syncOnline(licenseKey?: string): Promise<SyncResult> {
  const prev = await loadLicense();
  const key = (licenseKey ?? prev?.license_key ?? '').trim().toUpperCase();
  if (!key) return { ok: false, message: 'Enter your license key.' };
  const machine_id = await getMachineId();
  const studentCount = (await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM students WHERE status='active'"))?.n ?? 0;
  let res: Response;
  try {
    res = await httpFetch(`${LICENSE_API}/verify-license`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ license_key: key, machine_id, app_version: APP_VERSION, student_count: studentCount, local_utc_timestamp: nowUtc() }),
    });
  } catch (e) {
    return { ok: false, message: `Cannot reach the license server. Check your internet connection and try again. (${String((e as Error)?.message ?? e).slice(0, 160)})` };
  }
  const body = await res.json().catch(() => null);
  if (!body?.status) return { ok: false, message: `License server error (${res.status}).` };

  if (body.status === 'INVALID' && !prev?.license_key) return { ok: false, status: 'INVALID', message: body.payment_notice };

  const serverNow: number = body.server_utc_timestamp ?? nowUtc();
  const next: LicenseState = {
    license_key: key,
    machine_id,
    status: body.status,
    school_name: body.school_name ?? prev?.school_name ?? null,
    valid_until: body.valid_until ?? prev?.valid_until ?? null,
    grace_token: body.status === 'ACTIVE' ? body.grace_token_jwt : null,
    // Server time becomes the new floor: a PC clock that is behind real time will stay locked.
    last_known_utc: serverNow,
    last_online_sync: body.status === 'ACTIVE' ? serverNow : (prev?.last_online_sync ?? 0),
    payment_notice: body.payment_notice ?? '',
    payment_instructions: body.payment_instructions ?? '',
    product: body.product ?? prev?.product ?? 'SCHOOL',
    emergency_pin_hash: body.emergency_pin_hash ?? prev?.emergency_pin_hash ?? null,
  };
  if (body.status === 'ACTIVE' && !(await verifyToken(body.grace_token_jwt))) {
    return { ok: false, message: 'The server response could not be verified (signature mismatch). Contact support.' };
  }
  await saveLicense(next);
  return { ok: body.status === 'ACTIVE', status: body.status, message: body.payment_notice };
}

export const LOCK_TEXT: Record<LockReason, { title: string; body: string }> = {
  NEEDS_ACTIVATION: { title: 'Activate ScholarDesk Pro', body: 'Enter the School License Key you received from your software provider.' },
  PENDING: { title: 'Waiting for Approval', body: 'Your activation request has been sent. The software unlocks automatically as soon as it is approved — keep this PC connected to the internet.' },
  SUSPENDED: { title: 'Subscription Payment Required', body: 'Your ScholarDesk Pro subscription has been turned off by the provider. Please complete the payment below, then verify online.' },
  EXPIRED: { title: 'Subscription Expired', body: 'Your subscription period has ended. Please renew using the payment instructions below, then verify online.' },
  OFFLINE_TOO_LONG: { title: 'Online Verification Required', body: 'ScholarDesk Pro must connect to the internet at least once every 7 days. Connect this PC to the internet and press the button below.' },
  CLOCK_TAMPER: { title: 'System Clock Problem Detected', body: 'Your computer’s date/time is earlier than the last verified time. Correct the Windows/Mac date & time (enable automatic time), then verify online.' },
  INVALID: { title: 'License Not Recognised', body: 'This license key is no longer valid. Contact your software provider.' },
  MACHINE_MISMATCH: { title: 'License Bound to Another PC', body: 'This license is activated on a different computer. Ask your provider to reset the PC binding.' },
};

export interface RegistrationForm {
  product: 'SCHOOL' | 'COACHING';
  school_name: string; school_name_bn?: string; contact_person: string; phone: string; email?: string;
  address?: string; district?: string; students_estimate?: number | null; requested_plan: 'TRIAL' | 'MONTHLY' | 'YEARLY';
}

/** First-install self-registration: the school appears in the owner's panel under "Pending requests". */
export async function requestActivation(form: RegistrationForm): Promise<SyncResult> {
  const machine_id = await getMachineId();
  let res: Response;
  try {
    res = await httpFetch(`${LICENSE_API}/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, machine_id, app_version: APP_VERSION }),
    });
  } catch {
    return { ok: false, message: 'Cannot reach the server. Check the internet connection and try again.' };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.license_key) return { ok: false, message: body?.error ?? `Request failed (${res.status})` };
  await setConfig('registration', form);
  return syncOnline(body.license_key);
}

/**
 * Switch this PC to a different license key (e.g. a School key → a Coaching key).
 * The new key is checked with the server first; if it is not usable the current license is kept.
 */
export async function switchLicenseKey(newKey: string): Promise<SyncResult> {
  const key = newKey.trim().toUpperCase();
  if (!/^(SCH|COA)-\d{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return { ok: false, message: 'License key format is SCH-2026-XXXX-XXXX (school) or COA-2026-XXXX-XXXX (coaching).' };
  const prev = await loadLicense();
  if (prev?.license_key === key) return syncOnline(key);
  const r = await syncOnline(key);
  if (r.ok || r.status === 'PENDING') return r;
  if (prev) await saveLicense(prev); // keep the working license
  return { ...r, message: r.message || `This key could not be used (${r.status ?? 'offline'}). Your current license was kept.` };
}

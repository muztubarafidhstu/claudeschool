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

export const LICENSE_API = import.meta.env.VITE_LICENSE_API ?? 'https://scool.rafid5.com/api/v1';
export const APP_VERSION = '1.0.0';
export const GRACE_SECONDS = 7 * 86400;
const CLOCK_TOLERANCE = 10 * 60; // 10 minutes of normal drift allowed

export type ServerStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'INVALID' | 'MACHINE_MISMATCH';
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
}
export type LockReason = 'NEEDS_ACTIVATION' | 'CLOCK_TAMPER' | 'OFFLINE_TOO_LONG' | 'SUSPENDED' | 'EXPIRED' | 'INVALID' | 'MACHINE_MISMATCH';
export interface Evaluation {
  locked: boolean;
  reason?: LockReason;
  state: LicenseState | null;
  daysLeftOffline?: number;
  daysToExpiry?: number;
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
  } catch {
    return { ok: false, message: 'Cannot reach the license server. Check your internet connection and try again.' };
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
  };
  if (body.status === 'ACTIVE' && !(await verifyToken(body.grace_token_jwt))) {
    return { ok: false, message: 'The server response could not be verified (signature mismatch). Contact support.' };
  }
  await saveLicense(next);
  return { ok: body.status === 'ACTIVE', status: body.status, message: body.payment_notice };
}

export const LOCK_TEXT: Record<LockReason, { title: string; body: string }> = {
  NEEDS_ACTIVATION: { title: 'Activate ScholarDesk Pro', body: 'Enter the School License Key you received from your software provider.' },
  SUSPENDED: { title: 'Subscription Payment Required', body: 'Your ScholarDesk Pro subscription has been turned off by the provider. Please complete the payment below, then verify online.' },
  EXPIRED: { title: 'Subscription Expired', body: 'Your subscription period has ended. Please renew using the payment instructions below, then verify online.' },
  OFFLINE_TOO_LONG: { title: 'Online Verification Required', body: 'ScholarDesk Pro must connect to the internet at least once every 7 days. Connect this PC to the internet and press the button below.' },
  CLOCK_TAMPER: { title: 'System Clock Problem Detected', body: 'Your computer’s date/time is earlier than the last verified time. Correct the Windows/Mac date & time (enable automatic time), then verify online.' },
  INVALID: { title: 'License Not Recognised', body: 'This license key is no longer valid. Contact your software provider.' },
  MACHINE_MISMATCH: { title: 'License Bound to Another PC', body: 'This license is activated on a different computer. Ask your provider to reset the PC binding.' },
};

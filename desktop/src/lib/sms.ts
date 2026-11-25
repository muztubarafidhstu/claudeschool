/**
 * SMS sending for result summaries (and later OTP).
 *  - HTTP: any Bangladeshi bulk-SMS API. The owner pastes the provider's URL with {to} and {msg} placeholders
 *          (GET) or a POST body template. {to} = 01XXXXXXXXX, {to88} = 8801XXXXXXXXX.
 *  - ESP32: the owner's own ESP32 + GSM (SIM800/SIM7600) gateway on the LAN:
 *           GET {espUrl}/send?to=01XXXXXXXXX&msg=<text>&key=<espKey>  → reply containing "OK".
 */
import type { AppSettings, SmsSettings } from './config';
import { db } from './db';
import { invoke, isTauri } from './platform';

export const normalizeBdMobile = (n: string | null | undefined) => {
  const d = (n ?? '').replace(/\D/g, '');
  if (/^8801\d{9}$/.test(d)) return d.slice(2);
  if (/^01\d{9}$/.test(d)) return d;
  return null;
};

export function fillTemplate(t: string, vars: Record<string, string | number | null | undefined>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k]))).replace(/\s{2,}/g, ' ').trim();
}

/** Number of SMS parts the provider will charge (Bangla/emoji use 70/67-char parts, plain English 160/153). */
export function smsParts(text: string) {
  const unicode = /[^\x00-\x7F]/.test(text);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

async function httpCall(method: 'GET' | 'POST', url: string, contentType?: string, body?: string): Promise<{ status: number; text: string }> {
  if (isTauri) {
    const [status, text] = await invoke<[number, string]>('http_request', { method, url, contentType: contentType ?? null, body: body ?? null });
    return { status, text };
  }
  const r = await fetch(url, { method, headers: contentType ? { 'content-type': contentType } : undefined, body: method === 'POST' ? body : undefined });
  return { status: r.status, text: await r.text() };
}

export const smsConfigured = (s: SmsSettings) =>
  (s.provider === 'HTTP' && !!s.url.trim()) || (s.provider === 'ESP32' && !!s.espUrl.trim());

export async function sendSms(s: SmsSettings, toRaw: string, msg: string, purpose = 'RESULT'): Promise<{ ok: boolean; detail: string }> {
  const to = normalizeBdMobile(toRaw);
  if (!to) return { ok: false, detail: 'Invalid mobile number' };
  let res: { status: number; text: string };
  try {
    if (s.provider === 'ESP32') {
      const base = s.espUrl.trim().replace(/\/+$/, '');
      const u = `${base}/send?to=${encodeURIComponent(to)}&msg=${encodeURIComponent(msg)}&key=${encodeURIComponent(s.espKey)}`;
      res = await httpCall('GET', u);
    } else if (s.provider === 'HTTP') {
      const enc = { to, to88: `88${to}`, msg: encodeURIComponent(msg) };
      const url = fillTemplate(s.url, enc);
      if (s.method === 'POST') {
        const isJson = s.contentType.includes('json');
        const body = fillTemplate(s.body, { to, to88: `88${to}`, msg: isJson ? JSON.stringify(msg).slice(1, -1) : encodeURIComponent(msg) });
        res = await httpCall('POST', url, s.contentType, body);
      } else res = await httpCall('GET', url);
    } else return { ok: false, detail: 'SMS is not set up (Settings → SMS)' };
  } catch (e) {
    await log(to, msg, 'FAILED', String(e), purpose);
    return { ok: false, detail: String(e) };
  }
  const want = (s.provider === 'ESP32' ? 'OK' : s.successText).trim().toLowerCase();
  const ok = res.status >= 200 && res.status < 300 && (!want || res.text.toLowerCase().includes(want));
  await log(to, msg, ok ? 'SENT' : 'FAILED', `${res.status} ${res.text.slice(0, 300)}`, purpose);
  return { ok, detail: ok ? 'Sent' : `Gateway answered ${res.status}: ${res.text.slice(0, 160)}` };
}

const log = (to: string, message: string, status: string, response: string, purpose: string) =>
  db.execute('INSERT INTO sms_log(to_number, message, status, response, purpose) VALUES (?,?,?,?,?)', [to, message, status, response, purpose]).catch(() => null);

/** Sends one by one with a small pause (gateways and GSM modules dislike bursts). */
export async function sendBatch(settings: AppSettings, items: { to: string; msg: string; onDone?: (ok: boolean) => void }[], progress?: (done: number, sent: number, failed: number) => void) {
  let sent = 0, failed = 0, done = 0;
  for (const it of items) {
    const r = await sendSms(settings.sms, it.to, it.msg);
    r.ok ? sent++ : failed++;
    done++;
    it.onDone?.(r.ok);
    progress?.(done, sent, failed);
    await new Promise((res) => setTimeout(res, settings.sms.provider === 'ESP32' ? 2500 : 400));
  }
  return { sent, failed };
}

/**
 * Backup destinations:
 *  - Local folder (any drive / USB / synced folder): automatic once a day on the first app start, before the app opens,
 *    plus manual backups. Daily files: ScholarDesk_<school>_YYYY-MM-DD.json (newest 30 kept).
 *    Manual files: ScholarDesk_<school>_YYYY-MM-DD_manual_HH-MM.json (never deleted automatically).
 *  - Google Drive and Telegram: automatic once a day in the background whenever the PC is online.
 * Cloud copies are text-only (photos stripped) to stay small; local copies include photos.
 */
import type { AppSettings } from './config';
import { getConfig, setConfig } from './config';
import { buildBackup } from './backup';
import { getDriveAuth, uploadBackup } from './gdrive';
import { httpFetch, invoke, isTauri } from './platform';
import { syncOnline } from './license';
import { pad2, todayISO } from './util';

export interface BackupPrefs {
  localFolder: string | null;
  localAuto: boolean;
  driveAuto: boolean;
  telegram: { enabled: boolean; botToken: string; chatId: string };
}
export interface BackupStatus {
  local?: string; drive?: string; telegram?: string;            // YYYY-MM-DD of last automatic backup
  lastAt?: Partial<Record<'local' | 'drive' | 'telegram', string>>; // ISO time of last backup of any kind
  errors?: Partial<Record<'local' | 'drive' | 'telegram', string>>;
}
export interface FolderFile { name: string; size: number; modified: number }

const DEFAULT_PREFS: BackupPrefs = { localFolder: null, localAuto: true, driveAuto: true, telegram: { enabled: false, botToken: '', chatId: '' } };
export const KEEP_DAILY = 30;

export const getPrefs = async () => ({ ...DEFAULT_PREFS, ...(await getConfig<Partial<BackupPrefs>>('backup_prefs', {})) }) as BackupPrefs;
export const setPrefs = (p: BackupPrefs) => setConfig('backup_prefs', p);
export const getStatus = () => getConfig<BackupStatus>('backup_status', {});
async function mark(kind: 'local' | 'drive' | 'telegram', ok: boolean, daily: boolean, error?: string) {
  const s = await getStatus();
  const next: BackupStatus = { ...s, lastAt: { ...s.lastAt }, errors: { ...s.errors } };
  if (ok) { next.lastAt![kind] = new Date().toISOString(); delete next.errors![kind]; if (daily) next[kind] = todayISO(); }
  else next.errors![kind] = error ?? 'Failed';
  await setConfig('backup_status', next);
}

const slug = (s: AppSettings) => (s.school.name || 'School').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'School';
export function backupFileName(s: AppSettings, manual: boolean) {
  const d = new Date();
  return `ScholarDesk_${slug(s)}_${todayISO()}${manual ? `_manual_${pad2(d.getHours())}-${pad2(d.getMinutes())}` : ''}.json`;
}

// ------------------------------------------------------------------ local folder
export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ directory: true, multiple: false, title: 'Choose a folder for daily backups' });
  return typeof r === 'string' ? r : null;
}

export async function backupToFolder(s: AppSettings, manual: boolean): Promise<string> {
  const prefs = await getPrefs();
  if (!prefs.localFolder) throw new Error('Choose a backup folder first.');
  if (!isTauri) throw new Error('Local folder backup works in the desktop app.');
  try {
    const json = JSON.stringify(await buildBackup(s, true));
    const path = await invoke<string>('backup_write', { dir: prefs.localFolder, name: backupFileName(s, manual), content: json });
    if (!manual) await invoke<number>('backup_prune', { dir: prefs.localFolder, keep: KEEP_DAILY }).catch(() => 0);
    await mark('local', true, !manual);
    return path;
  } catch (e) {
    await mark('local', false, !manual, String(e));
    throw e;
  }
}

export const listFolder = async (dir: string) => (isTauri ? invoke<FolderFile[]>('backup_list', { dir }) : []);
export const readFromFolder = (dir: string, name: string) => invoke<string>('backup_read', { dir, name });

/** First app start of the day: back up to the local folder BEFORE the app opens. */
export async function dailyLocalIfNeeded(s: AppSettings): Promise<'done' | 'skipped' | string> {
  const [prefs, status] = await Promise.all([getPrefs(), getStatus()]);
  if (!isTauri || !prefs.localAuto || !prefs.localFolder || status.local === todayISO()) return 'skipped';
  try { await backupToFolder(s, false); return 'done'; } catch (e) { return String(e); }
}

// ------------------------------------------------------------------ Telegram
const tg = (token: string, method: string) => `https://api.telegram.org/bot${token.trim()}/${method}`;

/** Reads the newest chat that messaged the bot (user must send any message to the bot first). */
export async function telegramFindChat(token: string): Promise<{ id: string; name: string } | null> {
  const r = await httpFetch(tg(token, 'getUpdates'));
  const body = await r.json().catch(() => null);
  if (!body?.ok) throw new Error(body?.description ?? 'Bot token is not correct.');
  const msgs = (body.result as any[]).map((u) => u.message ?? u.channel_post).filter(Boolean);
  const last = msgs[msgs.length - 1];
  if (!last) return null;
  return { id: String(last.chat.id), name: last.chat.title ?? [last.chat.first_name, last.chat.last_name].filter(Boolean).join(' ') ?? 'chat' };
}

export async function telegramSend(token: string, chatId: string, fileName: string, json: string, caption: string) {
  const boundary = 'sd' + Math.random().toString(36).slice(2);
  const part = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const body = part('chat_id', chatId) + part('caption', caption)
    + `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--\r\n`;
  const r = await httpFetch(tg(token, 'sendDocument'), { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body: new TextEncoder().encode(body) });
  const out = await r.json().catch(() => null);
  if (!out?.ok) throw new Error(out?.description ?? `Telegram error (${r.status})`);
}

export async function backupToTelegram(s: AppSettings, daily: boolean) {
  const { telegram } = await getPrefs();
  if (!telegram.botToken || !telegram.chatId) throw new Error('Set the Telegram bot token and chat ID first.');
  try {
    const b = await buildBackup(s, false);
    const counts = `${b.tables.students.length} students · ${b.tables.fee_ledger.length} fee records · ${b.tables.attendance_logs.length} attendance`;
    await telegramSend(telegram.botToken, telegram.chatId, backupFileName(s, !daily), JSON.stringify(b), `📦 ${s.school.name || 'School'} backup ${todayISO()}\n${counts}`);
    await mark('telegram', true, daily);
  } catch (e) {
    await mark('telegram', false, daily, String(e));
    throw e;
  }
}

// ------------------------------------------------------------------ Google Drive
export async function backupToDrive(s: AppSettings, daily: boolean) {
  try {
    const out = await uploadBackup(backupFileName(s, !daily), JSON.stringify(await buildBackup(s, false)));
    await syncOnline().catch(() => null); // online moment → refresh the 7-day license timer too
    await mark('drive', true, daily);
    return out;
  } catch (e) {
    await mark('drive', false, daily, String(e));
    throw e;
  }
}

/** Background, once per day per destination, only when online. Never blocks the app. */
export async function dailyCloudIfNeeded(s: AppSettings) {
  if (!navigator.onLine) return;
  const [prefs, status] = await Promise.all([getPrefs(), getStatus()]);
  const today = todayISO();
  if (prefs.driveAuto && status.drive !== today && (await getDriveAuth())) await backupToDrive(s, true).catch(() => null);
  if (prefs.telegram.enabled && status.telegram !== today && prefs.telegram.botToken && prefs.telegram.chatId) await backupToTelegram(s, true).catch(() => null);
}

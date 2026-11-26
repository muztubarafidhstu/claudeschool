/**
 * Owner-requested "factory reset" (from the web panel). Runs once per reset id:
 *  1. full safety backup (with photos) into <AppData>/safety-backups and, if set, the school's backup folder
 *  2. erase every table and all settings — only the license stays
 *  3. remember the reset id (sent back to the server as an acknowledgement) and reload → setup screen
 */
import { db, TABLES } from './db';
import { buildBackup } from './backup';
import { loadSettings, getConfig } from './config';
import { getPrefs } from './autobackup';
import { invoke, isTauri } from './platform';
import { todayISO } from './util';

export async function lastResetId() { return getConfig<string | null>('last_reset_id', null); }

// Two license checks can run at the same time (timer + "Verify" button) — only one may ever wipe.
let running: Promise<boolean> | null = null;
export function applyRemoteReset(resetId: string): Promise<boolean> {
  if (running) return running.then(() => false);
  running = doReset(resetId);
  return running;
}

async function doReset(resetId: string) {
  if ((await lastResetId()) === resetId) return false;
  const settings = await loadSettings();
  const json = JSON.stringify(await buildBackup(settings, true));
  const name = `ScholarDesk_before-reset_${todayISO()}_${resetId.slice(0, 8)}.json`;
  if (isTauri) {
    const dir = await invoke<string>('safety_backup_dir');
    await invoke('backup_write', { dir, name, content: json });          // must succeed before anything is erased
    const prefs = await getPrefs().catch(() => null);
    if (prefs?.localFolder) await invoke('backup_write', { dir: prefs.localFolder, name, content: json }).catch(() => null);
  }
  await db.batch([
    ...[...TABLES].reverse().map((t) => ({ sql: `DELETE FROM ${t}` })),
    { sql: 'DELETE FROM sms_log' },
    { sql: "DELETE FROM app_config WHERE key NOT IN ('license')" },
    // Recorded in the same transaction as the wipe, so it can never run twice for one request.
    { sql: "INSERT INTO app_config(key, value, updated_at) VALUES ('last_reset_id', ?, datetime('now'))", params: [JSON.stringify(resetId)] },
  ]);
  return true;
}

import { db, TABLES, type Stmt } from './db';
import { applyImportedConfig, exportableConfig, saveSettings, type AppSettings } from './config';

export interface BackupFile {
  type: 'scholardesk-backup'; version: 1; created_at: string; school: string; include_photos: boolean;
  config: ReturnType<typeof exportableConfig>;
  tables: Record<(typeof TABLES)[number], Record<string, unknown>[]>;
}

/** Structured JSON backup. Text-only by default (photo blobs stripped) to keep Drive uploads tiny. */
export async function buildBackup(settings: AppSettings, includePhotos = false): Promise<BackupFile> {
  const tables = {} as BackupFile['tables'];
  for (const t of TABLES) {
    const rows = await db.select(`SELECT * FROM ${t}`);
    tables[t] = includePhotos ? rows : rows.map(({ photo: _p, ...rest }) => rest);
  }
  return { type: 'scholardesk-backup', version: 1, created_at: new Date().toISOString(), school: settings.school.name, include_photos: includePhotos, config: exportableConfig(settings), tables };
}

/** Replaces all school data with the backup (atomic) and restores the configuration. */
export async function restoreBackup(raw: unknown, current: AppSettings): Promise<AppSettings> {
  const b = raw as BackupFile;
  if (b?.type !== 'scholardesk-backup' || !b.tables) throw new Error('This is not a ScholarDesk backup file.');
  // Keep existing photos when restoring a text-only backup onto the same PC.
  const photos = new Map<string, string>();
  if (!b.include_photos) {
    for (const r of await db.select<{ student_id: string; photo: string }>('SELECT student_id, photo FROM students WHERE photo IS NOT NULL')) photos.set(`s:${r.student_id}`, r.photo);
    for (const r of await db.select<{ staff_code: string; photo: string }>('SELECT staff_code, photo FROM staff WHERE photo IS NOT NULL')) photos.set(`t:${r.staff_code}`, r.photo);
  }
  const stmts: Stmt[] = [...TABLES].reverse().map((t) => ({ sql: `DELETE FROM ${t}` }));
  for (const t of TABLES) {
    for (const row of b.tables[t] ?? []) {
      const r = { ...row } as Record<string, any>;
      if (t === 'students' && !r.photo && photos.has(`s:${r.student_id}`)) r.photo = photos.get(`s:${r.student_id}`);
      if (t === 'staff' && !r.photo && photos.has(`t:${r.staff_code}`)) r.photo = photos.get(`t:${r.staff_code}`);
      const cols = Object.keys(r).filter((k) => /^[a-z_]+$/.test(k));
      stmts.push({ sql: `INSERT INTO ${t}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, params: cols.map((c) => r[c] ?? null) });
    }
  }
  await db.batch(stmts);
  const next = applyImportedConfig(current, b);
  await saveSettings(next);
  return next;
}

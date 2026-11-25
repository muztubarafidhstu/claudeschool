/** Optional copy of every photo as a picture file in a folder the school chooses (Settings → photo folder). */
import type { AppSettings } from './config';
import { db } from './db';
import { invoke, isTauri } from './platform';

const safe = (s: string) => s.normalize('NFKD').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'photo';
export const photoFileName = (code: string, name: string, dataUrl: string) => `${safe(code)}_${safe(name)}.${dataUrl.startsWith('data:image/png') ? 'png' : 'jpg'}`;

/** Never blocks saving a record: errors are returned, not thrown. */
export async function savePhotoFile(s: AppSettings, code: string, name: string, dataUrl: string | null | undefined): Promise<string | null> {
  if (!isTauri || !s.photoFolder || !dataUrl?.startsWith('data:image/')) return null;
  try { await invoke<string>('photo_write', { dir: s.photoFolder, name: photoFileName(code, name, dataUrl), dataUrl }); return null; }
  catch (e) { return String(e); }
}

export async function exportAllPhotos(s: AppSettings) {
  if (!s.photoFolder) throw new Error('Choose a photo folder first.');
  const rows = [
    ...(await db.select<{ code: string; name: string; photo: string }>("SELECT student_id AS code, name_en AS name, photo FROM students WHERE photo IS NOT NULL")),
    ...(await db.select<{ code: string; name: string; photo: string }>("SELECT staff_code AS code, name_en AS name, photo FROM staff WHERE photo IS NOT NULL")),
  ];
  let saved = 0, failed = 0;
  for (const r of rows) (await savePhotoFile(s, r.code, r.name, r.photo)) ? failed++ : saved++;
  return { saved, failed };
}

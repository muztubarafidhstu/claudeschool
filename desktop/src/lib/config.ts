import { db } from './db';
import type { Stream } from './util';

export interface Modules { exams: boolean; payroll: boolean; fees: boolean; sections: boolean; attendance: boolean }
export interface Subject { name: string; name_bn?: string; full: number }
/** Subject groups: 'C1'..'C8' and 'C9-10-Science' | 'C9-10-Arts' | 'C9-10-Commerce'. */
export type SubjectGroup = string;
export interface SchoolProfile { name: string; name_bn: string; address: string; phone: string; email: string; eiin: string; principal: string; logo: string | null }

export interface AppSettings {
  school: SchoolProfile;
  modules: Modules;
  sectionsPerClass: Record<number, number>;
  subjects: Record<SubjectGroup, Subject[]>;
  examFees: { HALF_YEARLY: number; FINAL: number };
  defaultFees: Record<number, { monthly: number; admission: number }>;
  academicYear: number;
  lang: 'en' | 'bn';
  onboarded: boolean;
  /** Lock the screen after this many idle minutes (needs the Screen lock PIN). */
  screenLock: { enabled: boolean; minutes: number };
}

export const subjectGroup = (classNo: number, stream?: string | null): SubjectGroup =>
  classNo >= 9 ? `C9-10-${(stream as Stream) ?? 'Science'}` : `C${classNo}`;

export const SUBJECT_GROUPS: { key: SubjectGroup; label: string }[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((c) => ({ key: `C${c}`, label: `Class ${c}` })),
  { key: 'C9-10-Science', label: 'Class 9–10 Science' },
  { key: 'C9-10-Arts', label: 'Class 9–10 Arts' },
  { key: 'C9-10-Commerce', label: 'Class 9–10 Commerce' },
];

const s = (name: string, name_bn: string, full = 100): Subject => ({ name, name_bn, full });
const primary = [s('Bangla', 'বাংলা'), s('English', 'ইংরেজি'), s('Mathematics', 'গণিত'), s('Science', 'বিজ্ঞান'), s('Bangladesh & Global Studies', 'বাংলাদেশ ও বিশ্বপরিচয়'), s('Religion', 'ধর্ম')];
const junior = [...primary, s('ICT', 'তথ্য ও যোগাযোগ প্রযুক্তি', 50), s('Agriculture', 'কৃষিশিক্ষা', 50)];
const common = [s('Bangla', 'বাংলা'), s('English', 'ইংরেজি'), s('Mathematics', 'গণিত'), s('Religion', 'ধর্ম'), s('ICT', 'তথ্য ও যোগাযোগ প্রযুক্তি', 50)];

export function defaultSettings(): AppSettings {
  const year = new Date().getFullYear();
  return {
    school: { name: '', name_bn: '', address: '', phone: '', email: '', eiin: '', principal: '', logo: null },
    modules: { exams: true, payroll: true, fees: true, sections: true, attendance: true },
    sectionsPerClass: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => [c, 1])),
    subjects: {
      C1: [s('Bangla', 'বাংলা'), s('English', 'ইংরেজি'), s('Mathematics', 'গণিত')],
      C2: [s('Bangla', 'বাংলা'), s('English', 'ইংরেজি'), s('Mathematics', 'গণিত')],
      C3: primary, C4: primary, C5: primary, C6: junior, C7: junior, C8: junior,
      'C9-10-Science': [...common, s('Physics', 'পদার্থবিজ্ঞান'), s('Chemistry', 'রসায়ন'), s('Biology', 'জীববিজ্ঞান')],
      'C9-10-Arts': [...common, s('History', 'ইতিহাস'), s('Geography', 'ভূগোল'), s('Civics', 'পৌরনীতি')],
      'C9-10-Commerce': [...common, s('Accounting', 'হিসাববিজ্ঞান'), s('Finance & Banking', 'ফিন্যান্স ও ব্যাংকিং'), s('Business Entrepreneurship', 'ব্যবসায় উদ্যোগ')],
    },
    examFees: { HALF_YEARLY: 300, FINAL: 400 },
    defaultFees: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => [c, { monthly: 500 + c * 100, admission: 3000 + c * 300 }])),
    academicYear: year,
    lang: 'en',
    onboarded: false,
    screenLock: { enabled: true, minutes: 2 },
  };
}

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const r = await db.one<{ value: string }>('SELECT value FROM app_config WHERE key = ?', [key]);
  if (!r) return fallback;
  try { return JSON.parse(r.value) as T; } catch { return fallback; }
}

export async function setConfig(key: string, value: unknown) {
  await db.execute(
    `INSERT INTO app_config(key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value)]);
}

export async function loadSettings(): Promise<AppSettings> {
  const d = defaultSettings();
  const saved = await getConfig<Partial<AppSettings>>('settings', {});
  return { ...d, ...saved, school: { ...d.school, ...saved.school }, modules: { ...d.modules, ...saved.modules }, screenLock: { ...d.screenLock, ...saved.screenLock } };
}
export const saveSettings = (s: AppSettings) => setConfig('settings', s);

/** Portable school configuration (.json) — no student data, no PINs. */
export function exportableConfig(s: AppSettings) {
  return {
    type: 'scholardesk-config', version: 1, exported_at: new Date().toISOString(),
    school: { ...s.school }, modules: s.modules, sectionsPerClass: s.sectionsPerClass, subjects: s.subjects,
    examFees: s.examFees, defaultFees: s.defaultFees, academicYear: s.academicYear, lang: s.lang,
  };
}

export function applyImportedConfig(current: AppSettings, raw: any): AppSettings {
  if (!raw || (raw.type !== 'scholardesk-config' && raw.type !== 'scholardesk-backup')) throw new Error('This is not a ScholarDesk configuration file.');
  const c = raw.type === 'scholardesk-backup' ? raw.config : raw;
  return {
    ...current,
    school: { ...current.school, ...(c.school ?? {}) },
    modules: { ...current.modules, ...(c.modules ?? {}) },
    sectionsPerClass: c.sectionsPerClass ?? current.sectionsPerClass,
    subjects: c.subjects ?? current.subjects,
    examFees: c.examFees ?? current.examFees,
    defaultFees: c.defaultFees ?? current.defaultFees,
    academicYear: c.academicYear ?? current.academicYear,
    lang: c.lang ?? current.lang,
    onboarded: true,
  };
}

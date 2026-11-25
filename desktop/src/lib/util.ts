export const pad2 = (n: number) => String(n).padStart(2, '0');
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
export const CLASSES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const SECTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const STREAMS = ['Science', 'Arts', 'Commerce'] as const;
export type Stream = (typeof STREAMS)[number];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const WEEKLY_HOLIDAY = 5; // Friday (JS getDay)

export const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
export const dateOf = (ym: string, day: number) => `${ym}-${pad2(day)}`;
export const isFriday = (iso: string) => new Date(`${iso}T00:00:00`).getDay() === WEEKLY_HOLIDAY;
export const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

export const money = (n: number | null | undefined) => `৳ ${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const fmtDate = (iso?: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const classLabel = (c: number, stream?: string | null) => `Class ${c}${stream ? ` (${stream})` : ''}`;

/** YYCCRR — admission year (2) + class (2) + roll (2, or 3 when roll ≥ 100). */
export function makeStudentId(year: number, classNo: number, roll: number) {
  return `${String(year % 100).padStart(2, '0')}${pad2(classNo)}${pad2(roll)}`;
}

export function csvEscape(v: unknown) {
  let s = v == null ? '' : String(v);
  // CSV/formula injection: text starting with = + - @ would run as a formula in Excel/Sheets.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');

export function uid(prefix: string) {
  const d = new Date();
  return `${prefix}-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

export function clsx(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' '); }

import { db } from './db';
import { dateOf, daysInMonth, isFriday, todayISO } from './util';

export interface MonthlyAttendance {
  days: { day: number; date: string; status: 'P' | 'A' | 'F' | '-' }[];
  working: number; present: number; absent: number; pct: number;
}

/** Working days = all non-Friday days of the month up to today (for the current month). */
export async function studentMonth(studentId: number, ym: string): Promise<MonthlyAttendance> {
  const rows = await db.select<{ date: string; status: 'P' | 'A' }>(
    'SELECT date, status FROM attendance_logs WHERE student_id = ? AND date LIKE ?', [studentId, `${ym}-%`]);
  const map = new Map(rows.map((r) => [r.date, r.status]));
  return summarise(ym, map);
}

export function summarise(ym: string, map: Map<string, 'P' | 'A'>): MonthlyAttendance {
  const today = todayISO();
  const days = Array.from({ length: daysInMonth(ym) }, (_, i) => {
    const date = dateOf(ym, i + 1);
    const status = isFriday(date) ? 'F' : (map.get(date) ?? '-');
    return { day: i + 1, date, status: status as 'P' | 'A' | 'F' | '-' };
  });
  const working = days.filter((d) => d.status !== 'F' && d.date <= today).length;
  const present = days.filter((d) => d.status === 'P').length;
  const absent = days.filter((d) => d.status === 'A').length;
  const marked = present + absent;
  return { days, working, present, absent, pct: marked ? Math.round((present / marked) * 1000) / 10 : 0 };
}

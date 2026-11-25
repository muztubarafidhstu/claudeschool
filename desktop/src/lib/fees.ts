import { db } from './db';
import type { AppSettings } from './config';
import { monthKey, monthLabel, pad2 } from './util';

export interface Student {
  id: number; student_id: string; admission_year: number; admission_date: string; class_no: number; section: string; stream: string | null;
  roll: number; name_en: string; name_bn: string | null; gender: string | null; dob: string | null; blood_group: string | null;
  birth_cert_no: string | null; father_name: string | null; father_mobile: string | null; mother_name: string | null; mother_mobile: string | null;
  address: string | null; monthly_fee: number; admission_fee: number; photo: string | null; status: string; created_at: string;
}
export interface LedgerRow { id: number; student_id: number; receipt_no: string; fee_type: string; period: string; regular_amount: number; paid_amount: number; due_after: number; paid_on: string; note: string | null }
export interface FeeHead { key: string; type: 'ADMISSION' | 'MONTHLY' | 'EXAM'; label: string; regular: number; paid: number; due: number }

export const headLabel = (period: string) =>
  period === 'ADMISSION' ? 'Admission Fee' : /^\d{4}-\d{2}$/.test(period) ? `Tuition — ${monthLabel(period)}` : period.startsWith('HALF_YEARLY') ? `Half Yearly Exam Fee ${period.slice(-4)}` : period.startsWith('FINAL') ? `Final Exam Fee ${period.slice(-4)}` : period;

/** Month keys from the admission month up to (and including) `upTo`. */
export function billableMonths(admissionDate: string, upTo = monthKey()) {
  const out: string[] = [];
  let [y, m] = admissionDate.slice(0, 7).split('-').map(Number);
  const [ey, em] = upTo.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${pad2(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/**
 * Dues engine. A head is "billed" when it is due by date (admission, every month since admission)
 * or when an exam fee has been charged/paid at least once.
 */
export function computeHeads(st: Student, ledger: LedgerRow[], settings: AppSettings, examHeadsWithResults: string[] = []): FeeHead[] {
  const paidBy = new Map<string, number>();
  for (const r of ledger) paidBy.set(r.period, (paidBy.get(r.period) ?? 0) + r.paid_amount);
  const heads: FeeHead[] = [];
  const push = (key: string, type: FeeHead['type'], regular: number) => {
    const paid = paidBy.get(key) ?? 0;
    heads.push({ key, type, label: headLabel(key), regular, paid, due: Math.max(0, regular - paid) });
  };
  push('ADMISSION', 'ADMISSION', st.admission_fee);
  for (const m of billableMonths(st.admission_date)) push(m, 'MONTHLY', st.monthly_fee);
  const examKeys = new Set([...ledger.filter((r) => r.fee_type === 'EXAM').map((r) => r.period), ...examHeadsWithResults]);
  for (const k of examKeys) push(k, 'EXAM', k.startsWith('HALF') ? settings.examFees.HALF_YEARLY : settings.examFees.FINAL);
  return heads;
}

export async function loadStudentFinance(st: Student, settings: AppSettings) {
  const ledger = await db.select<LedgerRow>('SELECT * FROM fee_ledger WHERE student_id = ? ORDER BY paid_on DESC, id DESC', [st.id]);
  const results = await db.select<{ exam: string; academic_year: number }>('SELECT exam, academic_year FROM exam_results WHERE student_id = ?', [st.id]);
  const heads = computeHeads(st, ledger, settings, results.map((r) => `${r.exam}-${r.academic_year}`));
  return { ledger, heads, totalDue: heads.reduce((a, h) => a + h.due, 0) };
}

/** Fast school-wide outstanding dues (aggregated in SQL, no per-student loop). */
export async function schoolOutstanding(): Promise<number> {
  const students = await db.select<{ id: number; admission_date: string; monthly_fee: number; admission_fee: number }>(
    "SELECT id, admission_date, monthly_fee, admission_fee FROM students WHERE status='active'");
  const paid = await db.select<{ student_id: number; period: string; paid: number }>(
    "SELECT student_id, period, SUM(paid_amount) AS paid FROM fee_ledger WHERE fee_type IN ('ADMISSION','MONTHLY') GROUP BY student_id, period");
  const map = new Map(paid.map((p) => [`${p.student_id}|${p.period}`, p.paid]));
  let total = 0;
  for (const s of students) {
    total += Math.max(0, s.admission_fee - (map.get(`${s.id}|ADMISSION`) ?? 0));
    for (const m of billableMonths(s.admission_date)) total += Math.max(0, s.monthly_fee - (map.get(`${s.id}|${m}`) ?? 0));
  }
  return total;
}

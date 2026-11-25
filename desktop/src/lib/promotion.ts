import { db, type Stmt } from './db';
import type { AppSettings } from './config';

export interface PromotionPreview { classNo: number; total: number; passed: number; failed: number; noResult: number }

/** Year-end promotion based on FINAL exam results of the current academic year. */
export async function previewPromotion(settings: AppSettings): Promise<PromotionPreview[]> {
  const rows = await db.select<{ class_no: number; total: number; passed: number; failed: number }>(
    `SELECT s.class_no, COUNT(*) AS total,
            SUM(CASE WHEN r.passed = 1 THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN r.passed = 0 THEN 1 ELSE 0 END) AS failed
       FROM students s LEFT JOIN exam_results r ON r.student_id = s.id AND r.exam = 'FINAL' AND r.academic_year = ?
      WHERE s.status = 'active' GROUP BY s.class_no ORDER BY s.class_no`, [settings.academicYear]);
  return rows.map((r) => ({ classNo: r.class_no, total: r.total, passed: r.passed ?? 0, failed: r.failed ?? 0, noResult: r.total - (r.passed ?? 0) - (r.failed ?? 0) }));
}

/**
 * Passed students move Class N → N+1 (Class 10 → graduated). Failed / no-result students repeat.
 * Rolls in every class are re-assigned by merit: highest FINAL total = Roll 01; repeaters follow.
 */
export async function runPromotion(settings: AppSettings) {
  const year = settings.academicYear;
  const list = await db.select<{ id: number; class_no: number; section: string; stream: string | null; passed: number | null; obtained: number | null; pct: number | null }>(
    `SELECT s.id, s.class_no, s.section, s.stream, r.passed, r.obtained, r.percentage AS pct
       FROM students s LEFT JOIN exam_results r ON r.student_id = s.id AND r.exam = 'FINAL' AND r.academic_year = ?
      WHERE s.status = 'active'`, [year]);
  const stmts: Stmt[] = [{ sql: "UPDATE students SET status = 'promoting' WHERE status = 'active'" }]; // frees the (class, roll) unique index
  const buckets = new Map<number, { id: number; promoted: boolean; score: number; section: string; stream: string | null }[]>();
  let graduated = 0, promoted = 0, repeated = 0;
  for (const s of list) {
    const passed = s.passed === 1;
    if (passed && s.class_no === 10) {
      stmts.push({ sql: "UPDATE students SET status = 'graduated', updated_at = datetime('now') WHERE id = ?", params: [s.id] });
      graduated++;
      continue;
    }
    const target = passed ? s.class_no + 1 : s.class_no;
    passed ? promoted++ : repeated++;
    if (!buckets.has(target)) buckets.set(target, []);
    buckets.get(target)!.push({ id: s.id, promoted: passed, score: s.pct ?? -1, section: s.section, stream: target >= 9 ? (s.stream ?? 'Science') : null });
  }
  for (const [cls, arr] of buckets) {
    arr.sort((a, b) => Number(b.promoted) - Number(a.promoted) || b.score - a.score);
    const sections = settings.modules.sections ? Math.max(1, settings.sectionsPerClass[cls] ?? 1) : 1;
    arr.forEach((s, i) => {
      const section = s.section.charCodeAt(0) - 65 < sections ? s.section : 'A';
      stmts.push({ sql: "UPDATE students SET status = 'active', class_no = ?, roll = ?, section = ?, stream = ?, updated_at = datetime('now') WHERE id = ?", params: [cls, i + 1, section, s.stream, s.id] });
    });
  }
  await db.batch(stmts);
  return { promoted, repeated, graduated };
}

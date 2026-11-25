/** Bangladesh national grading (NCTB): per-subject percentage → letter grade & grade point. */
export const GRADE_SCALE = [
  { min: 80, grade: 'A+', gp: 5.0 },
  { min: 70, grade: 'A', gp: 4.0 },
  { min: 60, grade: 'A-', gp: 3.5 },
  { min: 50, grade: 'B', gp: 3.0 },
  { min: 40, grade: 'C', gp: 2.0 },
  { min: 33, grade: 'D', gp: 1.0 },
  { min: 0, grade: 'F', gp: 0.0 },
];

export function gradeOf(pct: number) { return GRADE_SCALE.find((g) => pct >= g.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1]; }

export interface MarkLine { subject: string; full: number; obtained: number }
export interface ResultCalc { totalFull: number; obtained: number; percentage: number; gpa: number; grade: string; passed: boolean; lines: (MarkLine & { grade: string; gp: number })[] }

export function calculate(lines: MarkLine[]): ResultCalc {
  const graded = lines.map((l) => {
    const pct = l.full > 0 ? (l.obtained / l.full) * 100 : 0;
    const g = gradeOf(pct);
    return { ...l, grade: g.grade, gp: g.gp };
  });
  const totalFull = lines.reduce((a, l) => a + l.full, 0);
  const obtained = lines.reduce((a, l) => a + (Number(l.obtained) || 0), 0);
  const failed = graded.some((l) => l.gp === 0);
  const gpa = !graded.length || failed ? 0 : Math.min(5, graded.reduce((a, l) => a + l.gp, 0) / graded.length);
  const gpaR = Math.round(gpa * 100) / 100;
  const overall = failed ? 'F' : (GRADE_SCALE.find((g) => gpaR >= g.gp) ?? GRADE_SCALE[6]).grade;
  return { totalFull, obtained, percentage: totalFull ? Math.round((obtained / totalFull) * 10000) / 100 : 0, gpa: gpaR, grade: overall, passed: !failed && graded.length > 0, lines: graded };
}

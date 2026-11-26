import { useEffect, useMemo, useState } from 'react';
import { Printer, Save, Lock, Trophy, MessageSquare } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Badge, Card, Empty, Field, Modal, Tabs } from '../components/ui';
import ClassPicker from '../components/ClassPicker';
import StudentSearch from '../components/StudentSearch';
import PrintPreview from '../components/PrintPreview';
import { Marksheet } from '../docs/Documents';
import { db, type Param } from '../lib/db';
import { groupLabel, placement } from '../lib/groups';
import { fillTemplate } from '../lib/sms';
import SmsSendModal from '../components/SmsSendModal';
import { subjectGroup } from '../lib/config';
import { calculate, type MarkLine } from '../lib/grading';
import type { Student } from '../lib/fees';

type Exam = 'HALF_YEARLY' | 'FINAL';
interface ResultRow { student_id: number; exam: Exam; obtained: number; total_full: number; percentage: number; gpa: number; grade: string; passed: number; marks_json: string }

export default function Exams({ focus }: { focus?: { id: number; n: number } | null }) {
  const { settings, dataVersion } = useApp();
  const [sel, setSel] = useState({ classNo: 1, section: '', stream: null as string | null });
  const [exam, setExam] = useState<Exam>('HALF_YEARLY');
  const [students, setStudents] = useState<Student[]>([]);
  const [results, setResults] = useState<Map<number, ResultRow>>(new Map());
  const [open, setOpen] = useState<Student | null>(null);
  const [sms, setSms] = useState(false);
  const year = settings.academicYear;

  useEffect(() => {
    const p: Param[] = [sel.classNo]; const w: string[] = [];
    if (sel.section && settings.modules.sections) { w.push('section = ?'); p.push(sel.section); }
    if (sel.stream && sel.classNo >= 9) { w.push('stream = ?'); p.push(sel.stream); }
    db.select<Student>(`SELECT * FROM students WHERE status='active' AND class_no = ?${w.map((x) => ` AND ${x}`).join('')} ORDER BY roll`, p).then(setStudents);
    db.select<ResultRow>('SELECT * FROM exam_results WHERE academic_year = ? AND exam = ? AND class_no = ?', [year, exam, sel.classNo]).then((r) => setResults(new Map(r.map((x) => [x.student_id, x]))));
  }, [sel, exam, year, dataVersion, settings.modules.sections]);

  useEffect(() => {
    if (!focus) return;
    db.one<Student>('SELECT * FROM students WHERE id = ?', [focus.id]).then((s) => {
      if (!s) return;
      setSel({ classNo: s.class_no, section: '', stream: s.class_no >= 9 ? s.stream : null });
      setOpen(s);
    });
  }, [focus?.n]);

  const ranked = useMemo(() => [...results.values()].sort((a, b) => b.obtained - a.obtained).map((r) => r.student_id), [results]);
  const done = students.filter((s) => results.has(s.id)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Exams & Results <span className="text-base font-normal text-slate-400">· {year}</span></h1>
        <Tabs value={exam} onChange={setExam} items={[{ value: 'HALF_YEARLY', label: 'Half Yearly Exam' }, { value: 'FINAL', label: 'Final Exam' }]} />
      </div>
      <Card>
        <div className="grid gap-4 p-4 md:grid-cols-5">
          <ClassPicker classNo={sel.classNo} section={sel.section} stream={sel.classNo >= 9 ? sel.stream ?? '' : null} onChange={(v) => setSel({ classNo: v.classNo || 1, section: v.section, stream: v.stream })} />
          <div className="md:col-span-2"><span className="label">Quick find student</span><StudentSearch onPick={(s) => setOpen(s)} /></div>
        </div>
      </Card>
      <Card title={`${groupLabel(settings, sel.classNo)} — ${done}/${students.length} results entered`} actions={done > 0 ? <button className="btn-ghost btn-sm" onClick={() => setSms(true)}><MessageSquare size={14} /> Send result SMS</button> : null}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Roll</th><th>Name</th>{sel.classNo >= 9 && <th>Stream</th>}<th>Obtained</th><th>%</th><th>GPA</th><th>Grade</th><th>Merit</th><th /></tr></thead>
            <tbody>
              {students.map((s) => {
                const r = results.get(s.id);
                const rank = ranked.indexOf(s.id) + 1;
                return (
                  <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(s)}>
                    <td>{s.roll}</td><td className="font-medium">{s.name_en}</td>{sel.classNo >= 9 && <td>{s.stream}</td>}
                    <td>{r ? `${r.obtained} / ${r.total_full}` : <span className="text-slate-400">—</span>}</td>
                    <td>{r ? `${r.percentage}%` : ''}</td><td>{r ? r.gpa.toFixed(2) : ''}</td>
                    <td>{r && <Badge tone={r.passed ? 'ok' : 'bad'}>{r.grade}</Badge>}</td>
                    <td>{r && rank <= 3 ? <span className="flex items-center gap-1 font-semibold text-due"><Trophy size={14} /> {rank}</span> : r ? rank : ''}</td>
                    <td className="text-right"><button className="btn-ghost btn-sm">{r ? 'View / Edit' : 'Enter marks'}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!students.length && <Empty>No students in this selection.</Empty>}
        </div>
      </Card>
      {open && <MarksModal student={open} initialExam={exam} onClose={() => setOpen(null)} />}
      {sms && <SmsSendModal title={`Send result SMS · ${exam === 'FINAL' ? 'Final' : 'Half Yearly'} Exam ${year}`} onClose={() => setSms(false)}
        items={students.filter((st) => results.has(st.id)).map((st) => {
          const r = results.get(st.id)!;
          return { key: st.id, label: `${st.roll} · ${st.name_en}`, to: st.father_mobile, msg: fillTemplate(settings.sms.resultTemplate, {
            name: st.name_en, roll: st.roll, group: placement(settings, st), exam: `${exam === 'FINAL' ? 'Final' : 'Half Yearly'} Exam ${year}`, date: '',
            marks: r.obtained, full: r.total_full, percent: r.percentage, position: ranked.indexOf(st.id) + 1, total: ranked.length,
            remark: `GPA ${r.gpa.toFixed(2)} (${r.grade}).`, school: settings.school.name }) };
        })} />}
    </div>
  );
}

function MarksModal({ student, initialExam, onClose }: { student: Student; initialExam: Exam; onClose: () => void }) {
  const { settings, requirePin, toast, bump } = useApp();
  const [exam, setExam] = useState<Exam>(initialExam);
  const [lines, setLines] = useState<MarkLine[]>([]);
  const [existing, setExisting] = useState<ResultRow | null>(null);
  const [print, setPrint] = useState<false | 'view' | 'auto'>(false);
  const year = settings.academicYear;
  const subjects = settings.subjects[subjectGroup(student.class_no, student.stream)] ?? [];

  useEffect(() => {
    db.one<ResultRow>('SELECT * FROM exam_results WHERE student_id = ? AND academic_year = ? AND exam = ?', [student.id, year, exam]).then((r) => {
      setExisting(r);
      const saved: MarkLine[] = r ? JSON.parse(r.marks_json) : [];
      setLines(subjects.map((s) => ({ subject: s.name, full: s.full, obtained: saved.find((x) => x.subject === s.name)?.obtained ?? 0 })));
    });
  }, [exam, student.id]); // eslint-disable-line

  const calc = calculate(lines);
  const invalid = lines.some((l) => l.obtained < 0 || l.obtained > l.full);

  async function save(): Promise<boolean> {
    if (invalid) { toast('Marks cannot exceed full marks.', 'err'); return false; }
    if (existing && !(await requirePin('modify', 'Editing an already-submitted result requires the Modify PIN.'))) return false;
    await db.execute(`INSERT INTO exam_results(student_id, academic_year, exam, class_no, section, stream, marks_json, total_full, obtained, percentage, gpa, grade, passed)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(student_id, academic_year, exam) DO UPDATE SET marks_json=excluded.marks_json, total_full=excluded.total_full, obtained=excluded.obtained,
        percentage=excluded.percentage, gpa=excluded.gpa, grade=excluded.grade, passed=excluded.passed, class_no=excluded.class_no, updated_at=datetime('now')`,
      [student.id, year, exam, student.class_no, student.section, student.stream, JSON.stringify(lines), calc.totalFull, calc.obtained, calc.percentage, calc.gpa, calc.grade, calc.passed ? 1 : 0]);
    toast(`Result ${existing ? 'updated' : 'submitted'}: GPA ${calc.gpa.toFixed(2)} (${calc.grade})`);
    bump();
    setExisting({ ...(existing ?? ({} as ResultRow)), obtained: calc.obtained } as ResultRow);
    return true;
  }

  return (
    <>
      <Modal open onClose={onClose} width="max-w-3xl" title={`Marks Entry · ${student.name_en} · ${placement(settings, student)} · Roll ${student.roll}`}
        footer={<>
          {existing && <button className="btn-ghost" onClick={() => setPrint('view')}><Printer size={16} /> Print saved marksheet</button>}
          <button className="btn-ghost" onClick={save}>{existing ? <Lock size={16} /> : <Save size={16} />} {existing ? 'Update only (PIN)' : 'Submit only'}</button>
          <button className="btn-primary" onClick={async () => { if (await save()) setPrint('auto'); }}><Printer size={16} /> {existing ? 'Update & Print (PIN)' : 'Submit & Print Marksheet'}</button>
        </>}>
        <div className="mb-4 flex items-center justify-between">
          <Tabs value={exam} onChange={setExam} items={[{ value: 'HALF_YEARLY', label: 'Half Yearly Exam' }, { value: 'FINAL', label: 'Final Exam' }]} />
          {existing && <Badge tone="brand">Submitted — editing needs PIN</Badge>}
        </div>
        {!subjects.length ? <Empty>No subjects configured for this class. Add them in Settings → Subjects.</Empty> : (
          <table className="table">
            <thead><tr><th>Subject</th><th className="w-28">Full marks</th><th className="w-32">Obtained</th><th className="w-20">Grade</th><th className="w-20">GP</th></tr></thead>
            <tbody>
              {calc.lines.map((l, i) => (
                <tr key={l.subject}>
                  <td className="font-medium">{l.subject}</td><td>{l.full}</td>
                  <td><input type="number" min={0} max={l.full} className={`input py-1 ${l.obtained > l.full ? 'border-bad' : ''}`} value={lines[i].obtained}
                    onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, obtained: Math.max(0, Number(e.target.value)) } : x)))} /></td>
                  <td><Badge tone={l.gp ? 'ok' : 'bad'}>{l.grade}</Badge></td><td>{l.gp.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[['Total Exam Marks', calc.totalFull], ['Obtained Marks', calc.obtained], ['Percentage', `${calc.percentage}%`], ['GPA', calc.gpa.toFixed(2)], ['Letter Grade', calc.grade]].map(([k, v]) => (
            <Field key={k} label={String(k)}><div className={`rounded-lg border border-line px-3 py-2 text-lg font-bold ${k === 'Letter Grade' ? (calc.passed ? 'text-ok' : 'text-bad') : ''}`}>{v}</div></Field>
          ))}
        </div>
      </Modal>
      <PrintPreview open={!!print} openWindow={print === 'auto'} fileName={`Marksheet_${student.student_id}_${exam}_${year}`} onClose={() => setPrint(false)} title="Marksheet"><Marksheet school={settings.school} s={student} exam={exam} year={year} calc={calc} /></PrintPreview>
    </>
  );
}

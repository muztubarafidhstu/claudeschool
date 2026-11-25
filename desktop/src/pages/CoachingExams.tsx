import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Printer, Save, Trash2, MessageSquare, ArrowLeft, Trophy, Lock } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Badge, Card, Empty, Field, Kpi, Modal } from '../components/ui';
import PrintPreview from '../components/PrintPreview';
import { DocHeader, Signatures } from '../docs/Documents';
import { db } from '../lib/db';
import { gradeOf } from '../lib/grading';
import { groupLabel, groups, terms } from '../lib/groups';
import { fillTemplate } from '../lib/sms';
import { DEFAULT_ABSENT_SMS } from '../lib/config';
import SmsSendModal, { type SmsItem } from '../components/SmsSendModal';
import { fmtDate, todayISO } from '../lib/util';

export interface CExam { id: number; class_no: number; name: string; exam_date: string; note: string | null; full_marks: number; pass_marks: number; entered?: number; avg?: number | null; top?: number | null }
interface Row { student_id: number; roll: number; name_en: string; name_bn: string | null; father_mobile: string | null; obtained: number | null; absent: number; remark: string | null; sms_sent_at: string | null }
export interface Ranked extends Row { percent: number | null; grade: string; position: number | null; passed: boolean }

/** Percent, grade and merit position (ties share a position; absent students have none). */
export function rankRows(rows: Row[], exam: Pick<CExam, 'full_marks' | 'pass_marks'>): Ranked[] {
  const scored = rows.filter((r) => !r.absent && r.obtained != null).sort((a, b) => (b.obtained ?? 0) - (a.obtained ?? 0));
  const pos = new Map<number, number>();
  scored.forEach((r, i) => pos.set(r.student_id, i > 0 && scored[i - 1].obtained === r.obtained ? pos.get(scored[i - 1].student_id)! : i + 1));
  return rows.map((r) => {
    const percent = !r.absent && r.obtained != null ? Math.round((r.obtained / exam.full_marks) * 1000) / 10 : null;
    return { ...r, percent, grade: percent == null ? (r.absent ? 'ABS' : '—') : gradeOf(percent).grade, position: pos.get(r.student_id) ?? null, passed: percent != null && (r.obtained ?? 0) >= exam.pass_marks };
  });
}

export default function CoachingExams() {
  const { settings, dataVersion } = useApp();
  const [batch, setBatch] = useState(groups(settings)[0]?.no ?? 1);
  const [exams, setExams] = useState<CExam[]>([]);
  const [open, setOpen] = useState<CExam | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => db.select<CExam>(`
      SELECT e.*, COUNT(m.id) FILTER (WHERE m.obtained IS NOT NULL OR m.absent = 1) AS entered,
             ROUND(AVG(m.obtained), 1) AS avg, MAX(m.obtained) AS top
        FROM coaching_exams e LEFT JOIN coaching_marks m ON m.exam_id = e.id
       WHERE e.class_no = ? GROUP BY e.id ORDER BY e.exam_date DESC, e.id DESC`, [batch]).then(setExams), [batch]);
  useEffect(() => { void load(); }, [load, dataVersion]);

  if (open) return <ExamDetail exam={open} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Exams & Results</h1><p className="text-sm text-slate-500">Weekly tests, model tests — any exam, any time, per batch.</p></div>
        <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> New exam</button>
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 p-4">
          {groups(settings).map((g) => (
            <button key={g.no} onClick={() => setBatch(g.no)} className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${batch === g.no ? 'border-brand bg-brand text-white shadow' : 'border-line bg-white text-slate-600 hover:border-brand'}`}>{g.label}</button>
          ))}
        </div>
      </Card>
      <Card title={`${groupLabel(settings, batch)} — ${exams.length} exam${exams.length === 1 ? '' : 's'}`}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Date</th><th>Exam</th><th>Note</th><th>Full</th><th>Entered</th><th>Average</th><th>Highest</th><th /></tr></thead>
            <tbody>{exams.map((e) => (
              <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(e)}>
                <td className="whitespace-nowrap">{fmtDate(e.exam_date)}</td>
                <td className="font-semibold">{e.name}</td>
                <td className="max-w-xs truncate text-xs text-slate-500">{e.note}</td>
                <td>{e.full_marks}</td><td>{e.entered ?? 0}</td><td>{e.avg ?? '—'}</td><td>{e.top ?? '—'}</td>
                <td className="text-right"><button className="btn-ghost btn-sm">Open</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!exams.length && <Empty>No exams yet for this batch. Press “New exam”.</Empty>}
        </div>
      </Card>
      {creating && <ExamForm batch={batch} onClose={() => setCreating(false)} onSaved={(e) => { setCreating(false); setOpen(e); }} />}
    </div>
  );
}

function ExamForm({ batch, exam, onClose, onSaved }: { batch: number; exam?: CExam; onClose: () => void; onSaved: (e: CExam) => void }) {
  const { settings, toast, bump } = useApp();
  const [f, setF] = useState({ class_no: exam?.class_no ?? batch, name: exam?.name ?? '', exam_date: exam?.exam_date ?? todayISO(), note: exam?.note ?? '', full_marks: exam?.full_marks ?? 50, pass_marks: exam?.pass_marks ?? 17 });
  async function save() {
    if (!f.name.trim()) return toast('Give the exam a name, e.g. “Weekly Test 3”.', 'err');
    if (f.full_marks <= 0 || f.pass_marks < 0 || f.pass_marks > f.full_marks) return toast('Check full marks and pass marks.', 'err');
    if (exam) {
      await db.execute('UPDATE coaching_exams SET class_no=?, name=?, exam_date=?, note=?, full_marks=?, pass_marks=? WHERE id=?', [f.class_no, f.name.trim(), f.exam_date, f.note || null, f.full_marks, f.pass_marks, exam.id]);
      bump(); onSaved({ ...exam, ...f, name: f.name.trim() });
    } else {
      const r = await db.execute('INSERT INTO coaching_exams(class_no, name, exam_date, note, full_marks, pass_marks) VALUES (?,?,?,?,?,?)', [f.class_no, f.name.trim(), f.exam_date, f.note || null, f.full_marks, f.pass_marks]);
      bump(); onSaved({ id: r.last_insert_id, ...f, name: f.name.trim(), note: f.note || null });
    }
  }
  return (
    <Modal open onClose={onClose} title={exam ? 'Edit exam' : 'New exam'} width="max-w-xl" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}><Save size={16} /> Save & enter marks</button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={terms(settings).group}><select className="input" value={f.class_no} onChange={(e) => setF({ ...f, class_no: Number(e.target.value) })}>{groups(settings).map((g) => <option key={g.no} value={g.no}>{g.label}</option>)}</select></Field>
        <Field label="Date"><input type="date" className="input" value={f.exam_date} onChange={(e) => setF({ ...f, exam_date: e.target.value })} /></Field>
        <Field label="Exam name" className="sm:col-span-2"><input className="input" autoFocus placeholder="Weekly Test 3 / Model Test 1 / Chapter 5 Quiz" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Full marks"><input type="number" className="input" value={f.full_marks} onChange={(e) => setF({ ...f, full_marks: Number(e.target.value) })} /></Field>
        <Field label="Pass marks"><input type="number" className="input" value={f.pass_marks} onChange={(e) => setF({ ...f, pass_marks: Number(e.target.value) })} /></Field>
        <Field label="Short note about the exam" className="sm:col-span-2"><textarea className="input" rows={3} placeholder="Syllabus: Chapter 4–5, MCQ 25 + Written 25…" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ExamDetail({ exam: initial, onBack }: { exam: CExam; onBack: () => void }) {
  const { settings, toast, bump, requirePin } = useApp();
  const [exam, setExam] = useState(initial);
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [print, setPrint] = useState(false);
  const [sms, setSms] = useState(false);
  const load = useCallback(async () => {
    const r = await db.select<Row>(`
      SELECT s.id AS student_id, s.roll, s.name_en, s.name_bn, s.father_mobile, m.obtained, COALESCE(m.absent, 0) AS absent, m.remark, m.sms_sent_at
        FROM students s LEFT JOIN coaching_marks m ON m.student_id = s.id AND m.exam_id = ?
       WHERE s.status = 'active' AND s.class_no = ? ORDER BY s.roll`, [exam.id, exam.class_no]);
    setRows(r); setSaved(JSON.stringify(r));
  }, [exam.id, exam.class_no]);
  useEffect(() => { void load(); }, [load]);
  const ranked = useMemo(() => rankRows(rows, exam), [rows, exam]);
  const dirty = JSON.stringify(rows) !== saved;
  const hadMarks = useMemo(() => (JSON.parse(saved || '[]') as Row[]).some((r) => r.obtained != null || r.absent), [saved]);
  const setRow = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.student_id === id ? { ...r, ...patch } : r)));
  const bad = rows.some((r) => r.obtained != null && (r.obtained < 0 || r.obtained > exam.full_marks));

  async function save() {
    if (bad) return toast(`Marks must be between 0 and ${exam.full_marks}.`, 'err');
    if (hadMarks && !(await requirePin('modify', 'Changing already-saved marks requires the Modify PIN.'))) return;
    await db.batch(rows.map((r) => ({
      sql: `INSERT INTO coaching_marks(exam_id, student_id, obtained, absent, remark) VALUES (?,?,?,?,?)
            ON CONFLICT(exam_id, student_id) DO UPDATE SET obtained=excluded.obtained, absent=excluded.absent, remark=excluded.remark`,
      params: [exam.id, r.student_id, r.absent ? null : r.obtained, r.absent ? 1 : 0, r.remark || null],
    })));
    toast('Marks saved'); bump(); await load();
  }
  async function remove() {
    if (!(await requirePin('modify', `Delete “${exam.name}” and all its marks?`))) return;
    await db.execute('DELETE FROM coaching_marks WHERE exam_id = ?', [exam.id]);
    await db.execute('DELETE FROM coaching_exams WHERE id = ?', [exam.id]);
    toast('Exam deleted'); bump(); onBack();
  }
  const scored = ranked.filter((r) => r.percent != null);
  const avg = scored.length ? Math.round((scored.reduce((a, r) => a + (r.obtained ?? 0), 0) / scored.length) * 10) / 10 : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand" onClick={() => (dirty && !confirm('Leave without saving the marks?') ? null : onBack())}><ArrowLeft size={14} /> All exams</button>
          <h1 className="text-2xl font-bold">{exam.name} <span className="text-base font-normal text-slate-400">· {groupLabel(settings, exam.class_no)} · {fmtDate(exam.exam_date)}</span></h1>
          {exam.note && <p className="mt-1 max-w-3xl text-sm text-slate-600">{exam.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setEditing(true)}>Edit exam</button>
          <button className="btn-ghost" disabled={dirty || !scored.length} onClick={() => setPrint(true)}><Printer size={16} /> Print result sheet</button>
          <button className="btn-ghost" disabled={dirty || !scored.length} onClick={() => setSms(true)}><MessageSquare size={16} /> Send result SMS</button>
          <button className="btn-ghost text-bad" onClick={remove}><Trash2 size={16} /></button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Kpi label="Students" value={rows.length} icon={<Trophy />} tone="slate" />
        <Kpi label="Average" value={`${avg} / ${exam.full_marks}`} icon={<Trophy />} tone="brand" />
        <Kpi label="Passed" value={scored.filter((r) => r.passed).length} icon={<Trophy />} tone="ok" sub={`Pass mark ${exam.pass_marks}`} />
        <Kpi label="Absent" value={ranked.filter((r) => r.absent).length} icon={<Trophy />} tone="bad" />
      </div>
      <Card title={`Marks entry (out of ${exam.full_marks})`} actions={<button className="btn-primary" disabled={!dirty} onClick={save}>{hadMarks ? <Lock size={16} /> : <Save size={16} />} Save marks</button>}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="w-16">Roll</th><th>Name</th><th className="w-32">Marks</th><th className="w-20">Absent</th><th>%</th><th>Grade</th><th>Position</th><th>Remark</th></tr></thead>
            <tbody>{ranked.map((r) => (
              <tr key={r.student_id} className={r.absent ? 'bg-red-50/40' : ''}>
                <td className="font-mono">{String(r.roll).padStart(2, '0')}</td>
                <td className="font-medium">{r.name_en}{r.name_bn && <div className="bn text-xs font-normal text-slate-500">{r.name_bn}</div>}</td>
                <td><input type="number" min={0} max={exam.full_marks} disabled={!!r.absent} className={`input py-1 ${r.obtained != null && (r.obtained > exam.full_marks || r.obtained < 0) ? 'border-bad' : ''}`}
                  value={r.obtained ?? ''} onChange={(e) => setRow(r.student_id, { obtained: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                <td><input type="checkbox" className="h-5 w-5 accent-[#EF4444]" checked={!!r.absent} onChange={(e) => setRow(r.student_id, { absent: e.target.checked ? 1 : 0 })} /></td>
                <td>{r.percent ?? '—'}</td>
                <td>{r.percent != null ? <Badge tone={r.passed ? 'ok' : 'bad'}>{r.grade}</Badge> : <span className="text-xs text-slate-400">{r.grade}</span>}</td>
                <td>{r.position ? <span className={r.position <= 3 ? 'font-bold text-due' : ''}>{r.position}</span> : '—'}</td>
                <td><input className="input py-1 text-sm" placeholder="Excellent / Needs practice…" value={r.remark ?? ''} onChange={(e) => setRow(r.student_id, { remark: e.target.value })} /></td>
              </tr>
            ))}</tbody>
          </table>
          {!rows.length && <Empty>No students in this batch.</Empty>}
        </div>
      </Card>
      {editing && <ExamForm batch={exam.class_no} exam={exam} onClose={() => setEditing(false)} onSaved={(e) => { setEditing(false); setExam(e); }} />}
      <PrintPreview open={print} onClose={() => setPrint(false)} title="Result sheet">
        <ResultSheet exam={exam} rows={ranked} />
      </PrintPreview>
      {sms && <ResultSms exam={exam} rows={ranked} onClose={() => { setSms(false); void load(); }} />}
    </div>
  );
}

export function ResultSheet({ exam, rows }: { exam: CExam; rows: Ranked[] }) {
  const { settings } = useApp();
  const T = terms(settings);
  const sorted = [...rows].sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999) || a.roll - b.roll);
  const scored = rows.filter((r) => r.percent != null);
  return (
    <div className="a4">
      <DocHeader school={settings.school} title="Exam Result Sheet" subtitle={`${exam.name} · ${groupLabel(settings, exam.class_no)} · ${fmtDate(exam.exam_date)} · Full marks ${exam.full_marks} (pass ${exam.pass_marks})`} />
      {exam.note && <p className="mb-3 rounded border border-slate-200 bg-slate-50 p-2 text-[11px]"><b>Note:</b> {exam.note}</p>}
      <div className="mb-3 grid grid-cols-4 gap-2 text-center text-[11px]">
        {[['Students', rows.length], ['Appeared', scored.length], ['Passed', scored.filter((r) => r.passed).length], ['Highest', Math.max(0, ...scored.map((r) => r.obtained ?? 0))]].map(([k, v]) => (
          <div key={String(k)} className="rounded border border-slate-300 p-1.5"><div className="text-[9px] uppercase text-slate-500">{k}</div><div className="text-base font-bold">{v}</div></div>
        ))}
      </div>
      <table className="doc text-[11px]">
        <thead><tr><th>Pos.</th><th>Roll</th><th>Name</th><th className="text-center">Marks</th><th className="text-center">%</th><th className="text-center">Grade</th><th>Remark</th></tr></thead>
        <tbody>{sorted.map((r) => (
          <tr key={r.student_id}><td className="text-center font-bold">{r.position ?? '—'}</td><td>{r.roll}</td><td>{r.name_en}</td>
            <td className="text-center">{r.absent ? 'Absent' : r.obtained ?? '—'}</td><td className="text-center">{r.percent ?? ''}</td>
            <td className="text-center font-semibold" style={{ color: r.percent != null && !r.passed ? '#DC2626' : undefined }}>{r.percent != null ? r.grade : ''}</td><td>{r.remark}</td></tr>
        ))}</tbody>
      </table>
      <Signatures labels={[`${T.teacher} Signature`, `${T.head} Signature & Seal`]} />
    </div>
  );
}

function ResultSms({ exam, rows, onClose }: { exam: CExam; rows: Ranked[]; onClose: () => void }) {
  const { settings } = useApp();
  const total = rows.filter((r) => r.percent != null).length;
  const items: SmsItem[] = rows.filter((r) => r.percent != null || r.absent).map((r) => ({
    key: r.student_id, label: `${r.roll} · ${r.name_en}`, to: r.father_mobile, sentAt: r.sms_sent_at,
    msg: fillTemplate(r.absent ? DEFAULT_ABSENT_SMS : settings.sms.resultTemplate, {
      name: r.name_en, roll: r.roll, group: groupLabel(settings, exam.class_no), exam: exam.name, date: fmtDate(exam.exam_date),
      marks: r.absent ? 'ABSENT' : r.obtained, full: exam.full_marks, percent: r.percent ?? 0, position: r.position ?? '-', total,
      remark: r.remark ? `${r.remark}.` : '', school: settings.school.name,
    }),
  }));
  return <SmsSendModal title={`Send result SMS · ${exam.name}`} items={items} onClose={onClose}
    onSent={(id) => void db.execute("UPDATE coaching_marks SET sms_sent_at = datetime('now') WHERE exam_id = ? AND student_id = ?", [exam.id, id])} />;
}

import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, Download, Printer, Send, XCircle } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Card, Empty, Field, Kpi, Tabs } from '../components/ui';
import ClassPicker from '../components/ClassPicker';
import PrintPreview from '../components/PrintPreview';
import { DocHeader, Signatures } from '../docs/Documents';
import { db, type Param } from '../lib/db';
import { summarise } from '../lib/attendance';
import { saveTextFile } from '../lib/platform';
import { CLASSES, MONTHS, dateOf, daysInMonth, fmtDate, isFriday, monthKey, monthLabel, toCsv, todayISO } from '../lib/util';

type View = 'mark' | 'summary' | 'monthly';

export default function Attendance() {
  const [view, setView] = useState<View>('mark');
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Attendance</h1>
        <Tabs value={view} onChange={setView} items={[{ value: 'mark', label: 'Mark Daily Attendance' }, { value: 'summary', label: 'Daily Summary' }, { value: 'monthly', label: 'Monthly Matrix' }]} />
      </div>
      {view === 'mark' && <MarkDaily />}
      {view === 'summary' && <DailySummary />}
      {view === 'monthly' && <MonthlyMatrix />}
    </div>
  );
}

interface Roster { id: number; roll: number; name_en: string; name_bn: string | null; section: string; status: 'P' | 'A' | null }

// ---------------------------------------------------------------- 1. Mark daily
function MarkDaily() {
  const { settings, toast, bump } = useApp();
  const [date, setDate] = useState(todayISO());
  const [sel, setSel] = useState({ classNo: 1, section: 'A', stream: null as string | null });
  const [rows, setRows] = useState<Roster[]>([]);
  const [present, setPresent] = useState<Set<number>>(new Set());
  const [already, setAlready] = useState(false);
  const useSections = settings.modules.sections && (settings.sectionsPerClass[sel.classNo] ?? 1) > 1;

  useEffect(() => {
    const p: Param[] = [date, sel.classNo];
    let w = '';
    if (useSections) { w = ' AND s.section = ?'; p.push(sel.section || 'A'); }
    db.select<Roster>(`SELECT s.id, s.roll, s.name_en, s.name_bn, s.section, a.status FROM students s
      LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.date = ?
      WHERE s.status='active' AND s.class_no = ?${w} ORDER BY s.roll`, p).then((r) => {
      setRows(r);
      const marked = r.some((x) => x.status);
      setAlready(marked);
      setPresent(new Set(r.filter((x) => !marked || x.status === 'P').map((x) => x.id))); // all present by default
    });
  }, [date, sel.classNo, sel.section, useSections]);

  async function submit() {
    if (isFriday(date) && !confirm('This date is a Friday (weekly holiday). Submit anyway?')) return;
    await db.batch(rows.map((r) => ({
      sql: `INSERT INTO attendance_logs(student_id, date, class_no, section, status) VALUES (?,?,?,?,?)
            ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, class_no = excluded.class_no, section = excluded.section`,
      params: [r.id, date, sel.classNo, r.section, present.has(r.id) ? 'P' : 'A'],
    })));
    setAlready(true); bump();
    toast(`Attendance saved: ${present.size} present, ${rows.length - present.size} absent`);
  }
  const toggle = (id: number) => setPresent((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <Card>
      <div className="grid gap-4 border-b border-line p-4 md:grid-cols-5">
        <Field label="Date"><input type="date" className="input" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
        <ClassPicker classNo={sel.classNo} section={sel.section || 'A'} allowAllSections={false} onChange={(v) => setSel({ classNo: v.classNo || 1, section: v.section || 'A', stream: null })} />
        <div className="flex items-end gap-2 md:col-span-2">
          <button className="btn-ghost" onClick={() => setPresent(new Set(rows.map((r) => r.id)))}><CheckCheck size={16} /> All present</button>
          <button className="btn-ghost" onClick={() => setPresent(new Set())}><XCircle size={16} /> All absent</button>
        </div>
      </div>
      {already && <div className="bg-amber-50 px-4 py-2 text-sm text-amber-800">Attendance for this date was already submitted — changes will update it.</div>}
      {isFriday(date) && <div className="bg-slate-100 px-4 py-2 text-sm text-slate-600">Friday — weekly holiday.</div>}
      <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {rows.map((r) => {
          const on = present.has(r.id);
          return (
            <label key={r.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition ${on ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
              <input type="checkbox" className="h-5 w-5 accent-[#10B981]" checked={on} onChange={() => toggle(r.id)} />
              <span className="w-8 font-mono text-sm font-semibold text-slate-500">{String(r.roll).padStart(2, '0')}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name_en}{r.name_bn && <span className="bn block truncate text-xs font-normal text-slate-500">{r.name_bn}</span>}</span>
              <span className={`text-xs font-bold ${on ? 'text-ok' : 'text-bad'}`}>{on ? 'P' : 'A'}</span>
            </label>
          );
        })}
      </div>
      {!rows.length && <Empty>No students in this class{useSections ? '/section' : ''}.</Empty>}
      {rows.length > 0 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <span className="text-sm text-slate-600"><b className="text-ok">{present.size}</b> present · <b className="text-bad">{rows.length - present.size}</b> absent · {rows.length} total</span>
          <button className="btn-primary" onClick={submit}><Send size={16} /> Submit Attendance</button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- 2. Daily summary
interface SumRow { class_no: number; section: string; enrolled: number; present: number; absent: number; absentees: { roll: number; name_en: string }[] }

function DailySummary() {
  const { settings } = useApp();
  const [date, setDate] = useState(todayISO());
  const [classNo, setClassNo] = useState(0);
  const [rows, setRows] = useState<SumRow[]>([]);
  const [printFor, setPrintFor] = useState<null | { classNo: number; roster: { roll: number; name_en: string; section: string; status: string | null }[] | null }>(null);

  useEffect(() => {
    (async () => {
      const p: Param[] = [date]; let w = '';
      if (classNo) { w = ' AND s.class_no = ?'; p.push(classNo); }
      const agg = await db.select<{ class_no: number; section: string; enrolled: number; present: number; absent: number }>(
        `SELECT s.class_no, ${settings.modules.sections ? 's.section' : "'A'"} AS section, COUNT(*) AS enrolled,
                SUM(a.status = 'P') AS present, SUM(a.status = 'A') AS absent
           FROM students s LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.date = ?
          WHERE s.status = 'active'${w} GROUP BY 1, 2 ORDER BY 1, 2`, p);
      const abs = await db.select<{ class_no: number; section: string; roll: number; name_en: string }>(
        `SELECT s.class_no, s.section, s.roll, s.name_en FROM attendance_logs a JOIN students s ON s.id = a.student_id WHERE a.date = ? AND a.status = 'A'${w} ORDER BY s.class_no, s.roll`, p);
      setRows(agg.map((r) => ({ ...r, present: r.present ?? 0, absent: r.absent ?? 0, absentees: abs.filter((a) => a.class_no === r.class_no && (!settings.modules.sections || a.section === r.section)) })));
    })();
  }, [date, classNo, settings.modules.sections]);

  const tot = rows.reduce((a, r) => ({ enrolled: a.enrolled + r.enrolled, present: a.present + r.present, absent: a.absent + r.absent }), { enrolled: 0, present: 0, absent: 0 });
  const pct = (p: number, a: number) => (p + a ? `${Math.round((p / (p + a)) * 1000) / 10}%` : '—');

  function csvFor(cls: number | null) {
    const list = cls ? rows.filter((r) => r.class_no === cls) : rows;
    return toCsv([['Date', 'Class', 'Section', 'Enrolled', 'Present', 'Absent', 'Attendance %', 'Absent Rolls & Names'],
      ...list.map((r) => [date, r.class_no, r.section, r.enrolled, r.present, r.absent, pct(r.present, r.absent), r.absentees.map((a) => `${a.roll}-${a.name_en}`).join('; ')])]);
  }
  async function classRoster(cls: number) {
    return db.select<{ roll: number; name_en: string; section: string; status: string | null }>(
      "SELECT s.roll, s.name_en, s.section, a.status FROM students s LEFT JOIN attendance_logs a ON a.student_id = s.id AND a.date = ? WHERE s.status='active' AND s.class_no = ? ORDER BY s.section, s.roll", [date, cls]);
  }
  async function classCsv(cls: number) {
    const roster = await classRoster(cls);
    const body = [['Date', 'Class', 'Section', 'Roll', 'Name', 'Status'], ...roster.map((r) => [date, cls, r.section, r.roll, r.name_en, r.status === 'P' ? 'Present' : r.status === 'A' ? 'Absent' : 'Not marked'])];
    await saveTextFile(`attendance-${date}-class-${cls}.csv`, csvFor(cls) + '\r\n\r\n' + toCsv(body).slice(1), 'text/csv');
  }

  const printRows = printFor?.classNo ? rows.filter((r) => r.class_no === printFor.classNo) : rows;
  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 p-4 md:grid-cols-5">
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Class filter"><select className="input" value={classNo} onChange={(e) => setClassNo(Number(e.target.value))}><option value={0}>All Classes (1–10)</option>{CLASSES.map((c) => <option key={c} value={c}>Class {c}</option>)}</select></Field>
          <div className="flex items-end gap-2 md:col-span-3">
            <button className="btn-ghost" onClick={() => saveTextFile(`attendance-summary-${date}${classNo ? `-class-${classNo}` : ''}.csv`, csvFor(null), 'text/csv')}><Download size={16} /> Download CSV</button>
            <button className="btn-ghost" onClick={async () => setPrintFor({ classNo, roster: classNo ? await classRoster(classNo) : null })}><Printer size={16} /> Print / Save A4 Summary PDF</button>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-4">
        <Kpi label="Total Enrolled" value={tot.enrolled} icon={<CheckCheck />} tone="slate" />
        <Kpi label="Present" value={tot.present} icon={<CheckCheck />} tone="ok" />
        <Kpi label="Absent" value={tot.absent} icon={<XCircle />} tone="bad" />
        <Kpi label="Attendance %" value={pct(tot.present, tot.absent)} icon={<CheckCheck />} tone="brand" />
      </div>
      <Card title={`Class / Section breakdown — ${fmtDate(date)}`}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Class</th>{settings.modules.sections && <th>Section</th>}<th>Enrolled</th><th>Present</th><th>Absent</th><th>%</th><th>Absent students</th><th className="text-right">Export</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.class_no}${r.section}`}>
                  <td className="font-semibold">Class {r.class_no}</td>{settings.modules.sections && <td>{r.section}</td>}
                  <td>{r.enrolled}</td><td className="text-ok">{r.present}</td><td className="text-bad">{r.absent}</td><td>{pct(r.present, r.absent)}</td>
                  <td className="max-w-md text-xs">{r.present + r.absent === 0 ? <span className="text-slate-400">Not taken</span> : r.absentees.map((a) => <span key={a.roll} className="mr-1 inline-block rounded bg-red-50 px-1.5 py-0.5 text-bad">{a.roll} · {a.name_en}</span>)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn-ghost btn-sm" onClick={() => classCsv(r.class_no)}><Download size={12} /> CSV</button>{' '}
                    <button className="btn-ghost btn-sm" onClick={async () => setPrintFor({ classNo: r.class_no, roster: await classRoster(r.class_no) })}><Printer size={12} /> A4</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty>No students.</Empty>}
        </div>
      </Card>
      <PrintPreview open={!!printFor} onClose={() => setPrintFor(null)} title="Daily attendance summary">
        <div className="a4">
          <DocHeader school={settings.school} title="Daily Attendance Summary" subtitle={`${fmtDate(date)} · ${printFor?.classNo ? `Class ${printFor.classNo}` : 'All Classes'}`} />
          <table className="doc text-[11px]">
            <thead><tr><th>Class</th><th>Section</th><th>Enrolled</th><th>Present</th><th>Absent</th><th>%</th><th>Absent Rolls & Names</th></tr></thead>
            <tbody>{printRows.map((r) => <tr key={`${r.class_no}${r.section}`}><td>{r.class_no}</td><td>{r.section}</td><td>{r.enrolled}</td><td>{r.present}</td><td>{r.absent}</td><td>{pct(r.present, r.absent)}</td><td>{r.absentees.map((a) => `${a.roll}-${a.name_en}`).join(', ')}</td></tr>)}</tbody>
          </table>
          {printFor?.roster && (
            <>
              <h4 className="mb-1 mt-5 font-semibold">Student-by-student roster</h4>
              <table className="doc text-[11px]">
                <thead><tr><th>Section</th><th>Roll</th><th>Name</th><th>Status</th></tr></thead>
                <tbody>{printFor.roster.map((r) => <tr key={`${r.section}${r.roll}`}><td>{r.section}</td><td>{r.roll}</td><td>{r.name_en}</td><td className={r.status === 'P' ? 'cell-p' : r.status === 'A' ? 'cell-a' : ''}>{r.status === 'P' ? 'Present' : r.status === 'A' ? 'Absent' : '—'}</td></tr>)}</tbody>
              </table>
            </>
          )}
          <Signatures labels={['Class Teacher', 'Assistant Head Teacher', 'Principal Signature & Seal']} />
        </div>
      </PrintPreview>
    </div>
  );
}

// ---------------------------------------------------------------- 3. Monthly matrix
function MonthlyMatrix() {
  const { settings } = useApp();
  const [sel, setSel] = useState({ classNo: 1, section: '', stream: null as string | null });
  const [ym, setYm] = useState(monthKey());
  const [students, setStudents] = useState<{ id: number; roll: number; name_en: string; section: string }[]>([]);
  const [marks, setMarks] = useState<Map<string, 'P' | 'A'>>(new Map());
  const [print, setPrint] = useState(false);
  const year = Number(ym.slice(0, 4));
  const days = daysInMonth(ym);

  useEffect(() => {
    const p: Param[] = [sel.classNo]; let w = '';
    if (sel.section && settings.modules.sections) { w = ' AND section = ?'; p.push(sel.section); }
    db.select<{ id: number; roll: number; name_en: string; section: string }>(`SELECT id, roll, name_en, section FROM students WHERE status='active' AND class_no = ?${w} ORDER BY section, roll`, p).then(setStudents);
    db.select<{ student_id: number; date: string; status: 'P' | 'A' }>(`SELECT a.student_id, a.date, a.status FROM attendance_logs a WHERE a.class_no = ? AND a.date LIKE ?${sel.section && settings.modules.sections ? ' AND a.section = ?' : ''}`,
      sel.section && settings.modules.sections ? [sel.classNo, `${ym}-%`, sel.section] : [sel.classNo, `${ym}-%`]).then((r) => setMarks(new Map(r.map((x) => [`${x.student_id}|${x.date}`, x.status]))));
  }, [sel, ym, settings.modules.sections]);

  const matrix = useMemo(() => students.map((s) => {
    const m = new Map<string, 'P' | 'A'>();
    for (let d = 1; d <= days; d++) { const k = marks.get(`${s.id}|${dateOf(ym, d)}`); if (k) m.set(dateOf(ym, d), k); }
    return { s, sum: summarise(ym, m) };
  }), [students, marks, ym, days]);

  const title = `Class ${sel.classNo}${sel.section ? ` · Section ${sel.section}` : ''} · ${monthLabel(ym)}`;
  function csv() {
    const header = ['Roll', 'Name', ...Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, '0')), 'P', 'A', '%'];
    saveTextFile(`attendance-matrix-class-${sel.classNo}${sel.section}-${ym}.csv`, toCsv([header, ...matrix.map(({ s, sum }) => [s.roll, s.name_en, ...sum.days.map((d) => (d.status === '-' ? '' : d.status)), sum.present, sum.absent, sum.pct])]), 'text/csv');
  }
  const Grid = ({ compact }: { compact?: boolean }) => (
    <table className={compact ? 'doc text-[8.5px]' : 'w-full border-collapse text-xs'}>
      <thead>
        <tr>
          <th className={compact ? '' : 'sticky left-0 z-10 border border-line bg-slate-50 px-2 py-1.5 text-left'}>Roll</th>
          <th className={compact ? '' : 'sticky left-10 z-10 min-w-[160px] border border-line bg-slate-50 px-2 py-1.5 text-left'}>Name</th>
          {Array.from({ length: days }, (_, i) => <th key={i} className={compact ? '' : `border border-line px-1 py-1.5 text-center ${isFriday(dateOf(ym, i + 1)) ? 'bg-slate-200' : 'bg-slate-50'}`} style={compact ? { padding: '2px', textAlign: 'center' } : undefined}>{String(i + 1).padStart(2, '0')}</th>)}
          {['P', 'A', '%'].map((h) => <th key={h} className={compact ? '' : 'border border-line bg-slate-50 px-2 py-1.5 text-center'} style={compact ? { textAlign: 'center' } : undefined}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {matrix.map(({ s, sum }) => (
          <tr key={s.id}>
            <td className={compact ? '' : 'sticky left-0 border border-line bg-white px-2 py-1 font-mono'}>{s.roll}</td>
            <td className={compact ? '' : 'sticky left-10 border border-line bg-white px-2 py-1'} style={compact ? { whiteSpace: 'nowrap' } : undefined}>{s.name_en}</td>
            {sum.days.map((d) => (
              <td key={d.day} className={`${d.status === 'P' ? 'cell-p' : d.status === 'A' ? 'cell-a' : d.status === 'F' ? 'cell-f' : ''} ${compact ? '' : 'border border-line px-0.5 py-1 text-center'}`} style={compact ? { padding: '2px' } : { minWidth: 22 }}>
                {d.status === '-' ? '' : d.status}
              </td>
            ))}
            <td className={compact ? '' : 'border border-line px-2 text-center font-semibold text-ok'} style={compact ? { textAlign: 'center' } : undefined}>{sum.present}</td>
            <td className={compact ? '' : 'border border-line px-2 text-center font-semibold text-bad'} style={compact ? { textAlign: 'center' } : undefined}>{sum.absent}</td>
            <td className={compact ? '' : 'border border-line px-2 text-center font-semibold'} style={compact ? { textAlign: 'center' } : undefined}>{sum.pct}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 p-4 md:grid-cols-6">
          <ClassPicker classNo={sel.classNo} section={sel.section} onChange={(v) => setSel({ classNo: v.classNo || 1, section: v.section, stream: null })} />
          <Field label="Month"><select className="input" value={ym.slice(5)} onChange={(e) => setYm(`${year}-${e.target.value}`)}>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</select></Field>
          <Field label="Year"><input type="number" className="input" value={year} onChange={(e) => setYm(`${e.target.value}-${ym.slice(5)}`)} /></Field>
          <div className="flex items-end gap-2 md:col-span-2">
            <button className="btn-ghost" onClick={csv}><Download size={16} /> Download CSV</button>
            <button className="btn-ghost" onClick={() => setPrint(true)}><Printer size={16} /> Print / Save Color Grid PDF</button>
          </div>
        </div>
      </Card>
      <Card title={title} actions={<div className="flex gap-3 text-xs"><span><span className="cell-p inline-block w-5 rounded">P</span> Present</span><span><span className="cell-a inline-block w-5 rounded">A</span> Absent</span><span><span className="cell-f inline-block w-5 rounded">F</span> Friday</span></div>}>
        <div className="overflow-x-auto">{matrix.length ? <Grid /> : <Empty>No students.</Empty>}</div>
      </Card>
      <PrintPreview open={print} onClose={() => setPrint(false)} title="Monthly attendance grid (A4 landscape)">
        <div className="a4 a4-landscape">
          <DocHeader school={settings.school} title="Monthly Class Attendance Sheet" subtitle={title} />
          <Grid compact />
          <Signatures labels={['Class Teacher', 'Principal Signature & Seal']} />
        </div>
      </PrintPreview>
    </div>
  );
}

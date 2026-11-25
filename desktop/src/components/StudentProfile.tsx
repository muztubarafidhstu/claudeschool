import { useEffect, useState } from 'react';
import { Eye, EyeOff, Printer, Phone, MapPin, Droplet, Wallet, PenLine, CalendarCheck, FileText, Pencil } from 'lucide-react';
import { useApp } from './AppContext';
import { Modal, Badge, Empty } from './ui';
import PrintPreview from './PrintPreview';
import { AdmissionInvoice, Marksheet, StudentAttendanceReport } from '../docs/Documents';
import { studentMonth, type MonthlyAttendance } from '../lib/attendance';
import { db } from '../lib/db';
import { loadStudentFinance, type FeeHead, type LedgerRow, type Student } from '../lib/fees';
import { calculate, type MarkLine } from '../lib/grading';
import { fmtDate, money, monthKey } from '../lib/util';

interface ResultRow { id: number; exam: string; academic_year: number; marks_json: string; obtained: number; total_full: number; percentage: number; gpa: number; grade: string; passed: number }

/** Omnibox target: Personal profile + fee/due history FIRST; results hidden until "View Result". */
export default function StudentProfile() {
  const { openStudentId, closeStudent, settings, t, dataVersion, navigate, requirePin } = useApp();
  const [doc, setDoc] = useState<null | { kind: 'admission' } | { kind: 'attendance'; att: MonthlyAttendance; ym: string }>(null);
  const [s, setS] = useState<Student | null>(null);
  const [fin, setFin] = useState<{ ledger: LedgerRow[]; heads: FeeHead[]; totalDue: number } | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [print, setPrint] = useState<ResultRow | null>(null);

  useEffect(() => {
    setShowResult(false); setResults(null); setFin(null);
    if (!openStudentId) return setS(null);
    db.one<Student>('SELECT * FROM students WHERE id = ?', [openStudentId]).then(async (st) => {
      setS(st);
      if (st && settings.modules.fees) setFin(await loadStudentFinance(st, settings));
    });
  }, [openStudentId, dataVersion]); // eslint-disable-line

  async function revealResults() {
    setShowResult(true);
    setResults(await db.select<ResultRow>('SELECT * FROM exam_results WHERE student_id = ? ORDER BY academic_year DESC, exam DESC', [openStudentId]));
  }

  if (!s) return null;
  const m = settings.modules;
  const admissionPaid = fin?.ledger.filter((r) => r.period === 'ADMISSION').reduce((a, r) => a + r.paid_amount, 0) ?? 0;
  const actions = [
    m.fees && { label: 'Pay Fee / Collect Bill', icon: Wallet, primary: true, run: () => navigate('fees', s.id) },
    m.exams && { label: 'Enter / Edit Marks', icon: PenLine, run: () => navigate('exams', s.id) },
    m.attendance && { label: 'Attendance Report (this month)', icon: CalendarCheck, run: async () => { const ym = monthKey(); setDoc({ kind: 'attendance', att: await studentMonth(s.id, ym), ym }); } },
    { label: 'Print Admission Form', icon: FileText, run: () => setDoc({ kind: 'admission' }) },
    { label: 'Edit Student Info', icon: Pencil, run: async () => { if (await requirePin('modify', `Edit the saved record of ${s.name_en}?`)) navigate('edit-student', s.id); } },
  ].filter(Boolean) as { label: string; icon: typeof Wallet; primary?: boolean; run: () => void }[];
  const dueHeads = fin?.heads.filter((h) => h.due > 0) ?? [];
  return (
    <>
      <Modal open onClose={closeStudent} width="max-w-4xl" title={`Student Profile · ${s.student_id}`}>
        <div className="flex gap-5">
          {s.photo ? <img src={s.photo} className="h-36 w-30 rounded-lg border border-line object-cover" style={{ width: 120 }} /> : <div className="grid h-36 w-[120px] place-items-center rounded-lg bg-slate-100 text-3xl font-bold text-slate-300">{s.name_en[0]}</div>}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">{s.name_en}</h2>
            {s.name_bn && <div className="bn text-lg text-slate-600">{s.name_bn}</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="brand">Class {s.class_no}{settings.modules.sections && s.section ? ` · Sec ${s.section}` : ''}</Badge>
              {s.stream && <Badge tone="slate">{s.stream}</Badge>}
              <Badge tone="slate">Roll {s.roll}</Badge>
              <Badge tone={s.status === 'active' ? 'ok' : 'slate'}>{s.status}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div><span className="text-slate-500">Father:</span> {s.father_name ?? '—'}</div>
              <div className="flex items-center gap-1"><Phone size={13} className="text-slate-400" /> {s.father_mobile ?? '—'}</div>
              <div><span className="text-slate-500">Mother:</span> {s.mother_name ?? '—'}</div>
              <div className="flex items-center gap-1"><Phone size={13} className="text-slate-400" /> {s.mother_mobile ?? '—'}</div>
              <div><span className="text-slate-500">DOB:</span> {fmtDate(s.dob)} · {s.gender}</div>
              <div className="flex items-center gap-1"><Droplet size={13} className="text-bad" /> {s.blood_group ?? '—'}</div>
              <div className="col-span-2 flex items-center gap-1"><MapPin size={13} className="text-slate-400" /> {s.address ?? '—'}</div>
              <div><span className="text-slate-500">Birth Cert:</span> {s.birth_cert_no ?? '—'}</div>
              <div><span className="text-slate-500">Admitted:</span> {fmtDate(s.admission_date)}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2 rounded-xl border border-line bg-slate-50 p-3">
          {actions.map(({ label, icon: Icon, primary, run }) => (
            <button key={label} className={primary ? 'btn-primary' : 'btn-ghost'} onClick={run}><Icon size={16} /> {label}</button>
          ))}
        </div>

        {settings.modules.fees && fin && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">Fee & Due Payment History</h3>
              <Badge tone={fin.totalDue ? 'due' : 'ok'}>Total due {money(fin.totalDue)}</Badge>
            </div>
            {dueHeads.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">{dueHeads.map((h) => <span key={h.key} className="badge bg-amber-50 text-amber-700">{h.label}: {money(h.due)}</span>)}</div>
            )}
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="table">
                <thead><tr><th>Date</th><th>Receipt</th><th>Fee head</th><th className="text-right">Regular</th><th className="text-right">Paid</th><th className="text-right">Due after</th></tr></thead>
                <tbody>
                  {fin.ledger.slice(0, 30).map((r) => (
                    <tr key={r.id}><td>{fmtDate(r.paid_on)}</td><td className="font-mono text-xs">{r.receipt_no}</td><td>{fin.heads.find((h) => h.key === r.period)?.label ?? r.period}</td>
                      <td className="text-right">{money(r.regular_amount)}</td><td className="text-right font-semibold text-ok">{money(r.paid_amount)}</td><td className={`text-right ${r.due_after ? 'text-due' : 'text-slate-400'}`}>{money(r.due_after)}</td></tr>
                  ))}
                  {!fin.ledger.length && <tr><td colSpan={6}><Empty>No payments recorded.</Empty></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {settings.modules.exams && (
          <div className="mt-6">
            <button className={showResult ? 'btn-ghost' : 'btn-primary'} onClick={() => (showResult ? setShowResult(false) : revealResults())}>
              {showResult ? <><EyeOff size={16} /> Hide Result</> : <><Eye size={16} /> {t('viewResult')}</>}
            </button>
            {showResult && results && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {results.map((r) => (
                  <div key={r.id} className="rounded-lg border border-line p-4">
                    <div className="flex items-center justify-between"><b>{r.exam === 'FINAL' ? 'Final' : 'Half Yearly'} {r.academic_year}</b><Badge tone={r.passed ? 'ok' : 'bad'}>{r.passed ? 'PASS' : 'FAIL'}</Badge></div>
                    <div className="mt-2 grid grid-cols-3 text-center text-sm">
                      <div><div className="text-xs text-slate-500">Marks</div><b>{r.obtained}/{r.total_full}</b></div>
                      <div><div className="text-xs text-slate-500">GPA</div><b>{r.gpa.toFixed(2)}</b></div>
                      <div><div className="text-xs text-slate-500">Grade</div><b>{r.grade}</b></div>
                    </div>
                    <button className="btn-ghost btn-sm mt-3 w-full" onClick={() => setPrint(r)}><Printer size={14} /> Download / Print Marksheet</button>
                  </div>
                ))}
                {!results.length && <p className="text-sm text-slate-400">No results recorded yet.</p>}
              </div>
            )}
          </div>
        )}
      </Modal>
      <PrintPreview open={!!doc} onClose={() => setDoc(null)} title={doc?.kind === 'admission' ? 'Admission form' : 'Monthly attendance report'}>
        {doc?.kind === 'admission' && <AdmissionInvoice school={settings.school} s={s} paid={admissionPaid} showFees={m.fees} />}
        {doc?.kind === 'attendance' && <StudentAttendanceReport school={settings.school} s={s} att={doc.att} attMonth={doc.ym} />}
      </PrintPreview>
      <PrintPreview open={!!print} onClose={() => setPrint(null)} title="Marksheet">
        {print && <Marksheet school={settings.school} s={s} exam={print.exam} year={print.academic_year} calc={calculate(JSON.parse(print.marks_json) as MarkLine[])} />}
      </PrintPreview>
    </>
  );
}

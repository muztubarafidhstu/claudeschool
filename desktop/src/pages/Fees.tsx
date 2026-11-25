import { useEffect, useState } from 'react';
import { Receipt, Printer, X } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Badge, Card, Empty, Field } from '../components/ui';
import StudentSearch from '../components/StudentSearch';
import PrintPreview from '../components/PrintPreview';
import { FeeReceipt } from '../docs/Documents';
import { db } from '../lib/db';
import { headLabel, loadStudentFinance, type FeeHead, type LedgerRow, type Student } from '../lib/fees';
import { studentMonth, type MonthlyAttendance } from '../lib/attendance';
import { MONTHS, fmtDate, money, monthKey, pad2, todayISO, uid } from '../lib/util';

export default function Fees() {
  const { settings, toast, bump } = useApp();
  const [st, setSt] = useState<Student | null>(null);
  const [fin, setFin] = useState<{ ledger: LedgerRow[]; heads: FeeHead[]; totalDue: number } | null>(null);
  const [head, setHead] = useState(monthKey());
  const [amount, setAmount] = useState(0);
  const [paidOn, setPaidOn] = useState(todayISO());
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<{ row: LedgerRow; totalDue: number; att: MonthlyAttendance; attMonth: string } | null>(null);
  const year = settings.academicYear;

  const options = [
    { key: 'ADMISSION', label: 'Admission Fee / Admission Due' },
    ...MONTHS.map((m, i) => ({ key: `${year}-${pad2(i + 1)}`, label: `Monthly Tuition — ${m} ${year}` })),
    { key: `HALF_YEARLY-${year}`, label: `Half Yearly Exam Fee ${year}` },
    { key: `FINAL-${year}`, label: `Final Exam Fee ${year}` },
  ];

  async function load(s: Student) { setSt(s); setFin(await loadStudentFinance(s, settings)); }
  useEffect(() => { if (st) void load(st); }, []); // eslint-disable-line

  const regularFor = (key: string) => (!st ? 0 : key === 'ADMISSION' ? st.admission_fee : key.startsWith('HALF') ? settings.examFees.HALF_YEARLY : key.startsWith('FINAL') ? settings.examFees.FINAL : st.monthly_fee);
  const paidFor = (key: string) => fin?.ledger.filter((r) => r.period === key).reduce((a, r) => a + r.paid_amount, 0) ?? 0;
  const regular = regularFor(head);
  const already = paidFor(head);
  const remaining = Math.max(0, regular - already);
  useEffect(() => { setAmount(remaining); }, [head, st?.id, fin]); // eslint-disable-line

  async function collect() {
    if (!st) return;
    if (amount <= 0) return toast('Enter an amount greater than zero.', 'err');
    if (amount > remaining) return toast(`Amount exceeds the remaining due (${money(remaining)}) for this head.`, 'err');
    const row = { receipt_no: uid('R'), fee_type: head === 'ADMISSION' ? 'ADMISSION' : /^\d{4}-\d{2}$/.test(head) ? 'MONTHLY' : 'EXAM', period: head, regular_amount: regular, paid_amount: amount, due_after: remaining - amount, paid_on: paidOn, note: note || null };
    const r = await db.execute('INSERT INTO fee_ledger(student_id, receipt_no, fee_type, period, regular_amount, paid_amount, due_after, paid_on, note) VALUES (?,?,?,?,?,?,?,?,?)',
      [st.id, row.receipt_no, row.fee_type, row.period, row.regular_amount, row.paid_amount, row.due_after, row.paid_on, row.note]);
    const nextFin = await loadStudentFinance(st, settings);
    setFin(nextFin);
    const attMonth = /^\d{4}-\d{2}$/.test(head) ? head : paidOn.slice(0, 7);
    setReceipt({ row: { ...row, id: r.last_insert_id, student_id: st.id }, totalDue: nextFin.totalDue, att: await studentMonth(st.id, attMonth), attMonth });
    setNote(''); bump();
    toast(`Payment of ${money(amount)} recorded`);
  }

  async function reprint(r: LedgerRow) {
    if (!st || !fin) return;
    const attMonth = /^\d{4}-\d{2}$/.test(r.period) ? r.period : r.paid_on.slice(0, 7);
    setReceipt({ row: r, totalDue: fin.totalDue, att: await studentMonth(st.id, attMonth), attMonth });
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Student Fee Collection</h1>
      <Card><div className="p-4"><span className="label">Find student by ID, Roll or Guardian Mobile</span><StudentSearch onPick={load} autoFocus /></div></Card>
      {st && fin ? (
        <div className="grid gap-5 xl:grid-cols-5">
          <div className="space-y-5 xl:col-span-3">
            <Card title={<span className="flex items-center gap-3">{st.photo && <img src={st.photo} className="h-10 w-9 rounded object-cover" />}<span>{st.name_en} <span className="text-sm font-normal text-slate-500">· {st.student_id} · Class {st.class_no}{st.section ? `-${st.section}` : ''} · Roll {st.roll}</span></span></span>}
              actions={<><Badge tone={fin.totalDue ? 'due' : 'ok'}>Cumulative due {money(fin.totalDue)}</Badge><button className="btn-ghost btn-sm" onClick={() => { setSt(null); setFin(null); }}><X size={14} /></button></>}>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                <Field label="Fee head"><select className="input" value={head} onChange={(e) => setHead(e.target.value)}>
                  {options.map((o) => { const d = Math.max(0, regularFor(o.key) - paidFor(o.key)); return <option key={o.key} value={o.key}>{o.label}{d ? ` — due ${money(d)}` : ' — paid ✓'}</option>; })}
                </select></Field>
                <Field label="Payment date"><input type="date" className="input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
                <div className="grid grid-cols-3 gap-2 md:col-span-2">
                  <Field label="Regular amount"><div className="input bg-slate-50">{money(regular)}</div></Field>
                  <Field label="Already paid"><div className="input bg-slate-50 text-ok">{money(already)}</div></Field>
                  <Field label="Remaining (this head)"><div className={`input bg-slate-50 font-semibold ${remaining ? 'text-due' : 'text-ok'}`}>{money(remaining)}</div></Field>
                </div>
                <Field label="Amount received now (editable — partial allowed)"><input type="number" className="input text-lg font-bold" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
                <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                <div className="md:col-span-2 flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                  <span className="text-sm">Due after this payment: <b className={remaining - amount > 0 ? 'text-due' : 'text-ok'}>{money(Math.max(0, remaining - amount))}</b></span>
                  <button className="btn-primary" onClick={collect} disabled={!remaining}><Receipt size={16} /> Collect & Print 2-Page Receipt</button>
                </div>
              </div>
            </Card>
            <Card title="Payment history">
              <table className="table">
                <thead><tr><th>Date</th><th>Receipt</th><th>Head</th><th className="text-right">Paid</th><th className="text-right">Due after</th><th /></tr></thead>
                <tbody>
                  {fin.ledger.map((r) => <tr key={r.id}><td>{fmtDate(r.paid_on)}</td><td className="font-mono text-xs">{r.receipt_no}</td><td>{headLabel(r.period)}</td><td className="text-right font-semibold text-ok">{money(r.paid_amount)}</td><td className="text-right">{money(r.due_after)}</td><td className="text-right"><button className="btn-ghost btn-sm" onClick={() => reprint(r)}><Printer size={12} /></button></td></tr>)}
                </tbody>
              </table>
              {!fin.ledger.length && <Empty>No payments yet.</Empty>}
            </Card>
          </div>
          <Card title="Outstanding heads" className="xl:col-span-2">
            <table className="table"><tbody>
              {fin.heads.filter((h) => h.due > 0).map((h) => (
                <tr key={h.key} className="cursor-pointer hover:bg-amber-50" onClick={() => setHead(h.key)}>
                  <td>{h.label}<div className="text-xs text-slate-400">Regular {money(h.regular)} · paid {money(h.paid)}</div></td>
                  <td className="text-right font-semibold text-due">{money(h.due)}</td>
                </tr>
              ))}
            </tbody></table>
            {!fin.heads.some((h) => h.due > 0) && <Empty>All dues cleared ✓</Empty>}
          </Card>
        </div>
      ) : <Card><Empty>Search a student to collect fees, partial payments or previous dues.</Empty></Card>}
      <PrintPreview open={!!receipt} onClose={() => setReceipt(null)} title="Fee receipt + monthly attendance report (2 pages)">
        {receipt && st && <FeeReceipt school={settings.school} s={st} row={receipt.row} totalDue={receipt.totalDue} att={receipt.att} attMonth={receipt.attMonth} />}
      </PrintPreview>
    </div>
  );
}

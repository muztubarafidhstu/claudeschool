import { useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Banknote, Printer } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Badge, Card, Empty, Field, Modal } from '../components/ui';
import PhotoInput from '../components/PhotoInput';
import PrintPreview from '../components/PrintPreview';
import { Payslip } from '../docs/Documents';
import { db } from '../lib/db';
import { MONTHS, fmtDate, money, monthKey, monthLabel, pad2, todayISO, uid } from '../lib/util';

interface StaffRow { id: number; staff_code: string; name_en: string; name_bn: string | null; designation: string; mobile: string; join_date: string | null; monthly_salary: number; address: string | null; photo: string | null; status: string }
interface SalaryRow { id: number; staff_id: number; slip_no: string; period: string; regular_amount: number; paid_amount: number; due_after: number; paid_on: string; note: string | null }

const DESIGNATIONS = ['Principal', 'Assistant Head Teacher', 'Senior Teacher', 'Assistant Teacher', 'Teacher', 'Accountant', 'Office Assistant', 'Librarian', 'Lab Assistant', 'Security Guard', 'Cleaner'];

export default function Staff() {
  const { settings, requirePin, toast, bump, dataVersion } = useApp();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [paidMap, setPaidMap] = useState<Map<number, number>>(new Map());
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Partial<StaffRow> | null>(null);
  const [pay, setPay] = useState<StaffRow | null>(null);
  const [slip, setSlip] = useState<{ staff: StaffRow; row: SalaryRow; dueTotal: number } | null>(null);
  const ym = monthKey();

  useEffect(() => {
    const s = q.replace(/\D/g, '');
    (s ? db.select<StaffRow>("SELECT * FROM staff WHERE status='active' AND mobile LIKE ? ORDER BY id", [`%${s}%`]) : db.select<StaffRow>("SELECT * FROM staff WHERE status='active' AND (? = '' OR name_en LIKE ?) ORDER BY id", [q, `%${q}%`])).then(setRows);
    db.select<{ staff_id: number; paid: number }>('SELECT staff_id, SUM(paid_amount) AS paid FROM salary_ledger WHERE period = ? GROUP BY staff_id', [ym]).then((r) => setPaidMap(new Map(r.map((x) => [x.staff_id, x.paid]))));
  }, [q, dataVersion, ym]);

  async function saveStaff() {
    const f = form!;
    if (!f.name_en || !f.mobile || !f.designation) return toast('Name, designation and mobile are required.', 'err');
    if (!/^01\d{9}$/.test(f.mobile)) return toast('Mobile must be 11 digits starting with 01.', 'err');
    try {
      if (f.id) {
        await db.execute(`UPDATE staff SET name_en=?, name_bn=?, designation=?, mobile=?, join_date=?, monthly_salary=?, address=?, photo=?, updated_at=datetime('now') WHERE id=?`,
          [f.name_en, f.name_bn ?? null, f.designation, f.mobile, f.join_date ?? null, f.monthly_salary ?? 0, f.address ?? null, f.photo ?? null, f.id]);
      } else {
        const n = (await db.one<{ n: number }>('SELECT COALESCE(MAX(id),0)+1 AS n FROM staff'))!.n;
        await db.execute('INSERT INTO staff(staff_code, name_en, name_bn, designation, mobile, join_date, monthly_salary, address, photo) VALUES (?,?,?,?,?,?,?,?,?)',
          [`ST-${String(n).padStart(3, '0')}`, f.name_en, f.name_bn ?? null, f.designation, f.mobile, f.join_date ?? todayISO(), f.monthly_salary ?? 0, f.address ?? null, f.photo ?? null]);
      }
      toast(f.id ? 'Staff record updated' : 'Staff registered'); setForm(null); bump();
    } catch (e: any) { toast(/UNIQUE/.test(String(e)) ? 'This mobile number is already registered.' : String(e), 'err'); }
  }

  async function edit(s: StaffRow) { if (await requirePin('modify', `Edit staff record of ${s.name_en}?`)) setForm(s); }
  async function remove(s: StaffRow) {
    if (!(await requirePin('modify', `Delete ${s.name_en} and the salary history?`))) return;
    await db.execute('DELETE FROM staff WHERE id = ?', [s.id]); toast('Staff deleted'); bump();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Staff & Payroll</h1>
        <button className="btn-primary" onClick={() => setForm({ designation: 'Assistant Teacher', join_date: todayISO(), monthly_salary: 15000 })}><Plus size={16} /> New Staff Registration</button>
      </div>
      <Card><div className="p-4"><span className="label">Search staff by mobile number</span><div className="relative max-w-md"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" placeholder="01XXXXXXXXX or name" value={q} onChange={(e) => setQ(e.target.value)} /></div></div></Card>
      <Card title={`Staff — ${rows.length} · Salary month ${monthLabel(ym)}`}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Photo</th><th>Code</th><th>Name</th><th>Designation</th><th>Mobile</th><th>Salary</th><th>{MONTHS[Number(ym.slice(5)) - 1]} status</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const paid = paidMap.get(s.id) ?? 0; const due = Math.max(0, s.monthly_salary - paid);
                return (
                  <tr key={s.id}>
                    <td>{s.photo ? <img src={s.photo} className="h-9 w-8 rounded object-cover" /> : <div className="grid h-9 w-8 place-items-center rounded bg-slate-100 text-xs text-slate-400">{s.name_en[0]}</div>}</td>
                    <td className="font-mono text-xs">{s.staff_code}</td>
                    <td className="font-medium">{s.name_en}{s.name_bn && <div className="bn text-xs text-slate-500">{s.name_bn}</div>}</td>
                    <td>{s.designation}</td><td>{s.mobile}</td><td>{money(s.monthly_salary)}</td>
                    <td>{due === 0 ? <Badge tone="ok">Paid</Badge> : paid ? <Badge tone="due">Due {money(due)}</Badge> : <Badge tone="bad">Unpaid</Badge>}</td>
                    <td className="whitespace-nowrap text-right">
                      <button className="btn-primary btn-sm" onClick={() => setPay(s)}><Banknote size={14} /> Pay salary</button>{' '}
                      <button className="btn-ghost btn-sm" onClick={() => edit(s)}><Pencil size={14} /></button>{' '}
                      <button className="btn-ghost btn-sm text-bad" onClick={() => remove(s)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <Empty>No staff found.</Empty>}
        </div>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit Staff' : 'New Staff Registration'} width="max-w-3xl"
        footer={<><button className="btn-ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary" onClick={saveStaff}>Save</button></>}>
        {form && (
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name (English) *"><input className="input" value={form.name_en ?? ''} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></Field>
              <Field label="নাম (বাংলা)"><input className="input bn" value={form.name_bn ?? ''} onChange={(e) => setForm({ ...form, name_bn: e.target.value })} /></Field>
              <Field label="Designation *"><input className="input" list="designations" value={form.designation ?? ''} onChange={(e) => setForm({ ...form, designation: e.target.value })} /><datalist id="designations">{DESIGNATIONS.map((d) => <option key={d} value={d} />)}</datalist></Field>
              <Field label="Mobile *"><input className="input" value={form.mobile ?? ''} onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '').slice(0, 11) })} /></Field>
              <Field label="Joining date"><input type="date" className="input" value={form.join_date ?? ''} onChange={(e) => setForm({ ...form, join_date: e.target.value })} /></Field>
              <Field label="Monthly salary"><input type="number" className="input" value={form.monthly_salary ?? 0} onChange={(e) => setForm({ ...form, monthly_salary: Number(e.target.value) })} /></Field>
              <Field label="Address" className="md:col-span-2"><input className="input" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            </div>
            <Field label="Photo"><PhotoInput value={form.photo ?? null} onChange={(v) => setForm({ ...form, photo: v })} /></Field>
          </div>
        )}
      </Modal>

      {pay && <PayModal staff={pay} onClose={() => setPay(null)} onPaid={(row, dueTotal) => { setPay(null); setSlip({ staff: pay, row, dueTotal }); bump(); }} onSlip={(row, dueTotal) => setSlip({ staff: pay, row, dueTotal })} />}
      <PrintPreview open={!!slip} onClose={() => setSlip(null)} title="Salary payslip">{slip && <Payslip school={settings.school} staff={slip.staff} row={slip.row} dueTotal={slip.dueTotal} />}</PrintPreview>
    </div>
  );
}

function PayModal({ staff, onClose, onPaid, onSlip }: { staff: StaffRow; onClose: () => void; onPaid: (r: SalaryRow, dueTotal: number) => void; onSlip: (r: SalaryRow, dueTotal: number) => void }) {
  const { toast } = useApp();
  const [period, setPeriod] = useState(monthKey());
  const [history, setHistory] = useState<SalaryRow[]>([]);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  useEffect(() => { db.select<SalaryRow>('SELECT * FROM salary_ledger WHERE staff_id = ? ORDER BY period DESC, id DESC', [staff.id]).then(setHistory); }, [staff.id]);
  const paid = history.filter((h) => h.period === period).reduce((a, h) => a + h.paid_amount, 0);
  const remaining = Math.max(0, staff.monthly_salary - paid);
  useEffect(() => setAmount(remaining), [remaining]);
  const totalDue = (extra = 0) => {
    const periods = new Set(history.map((h) => h.period)); periods.add(period);
    return [...periods].reduce((a, p) => a + Math.max(0, staff.monthly_salary - history.filter((h) => h.period === p).reduce((x, h) => x + h.paid_amount, 0) - (p === period ? extra : 0)), 0);
  };
  async function submit() {
    if (amount <= 0 || amount > remaining) return toast(`Enter an amount between 1 and ${money(remaining)}.`, 'err');
    const row: Omit<SalaryRow, 'id'> = { staff_id: staff.id, slip_no: uid('PS'), period, regular_amount: staff.monthly_salary, paid_amount: amount, due_after: remaining - amount, paid_on: todayISO(), note: note || null };
    const r = await db.execute('INSERT INTO salary_ledger(staff_id, slip_no, period, regular_amount, paid_amount, due_after, paid_on, note) VALUES (?,?,?,?,?,?,?,?)',
      [row.staff_id, row.slip_no, row.period, row.regular_amount, row.paid_amount, row.due_after, row.paid_on, row.note]);
    toast(`Salary ${money(amount)} disbursed`);
    onPaid({ ...row, id: r.last_insert_id }, totalDue(amount));
  }
  const year = Number(period.slice(0, 4));
  return (
    <Modal open onClose={onClose} title={`Salary Disbursement · ${staff.name_en}`} width="max-w-2xl" footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit} disabled={!remaining}><Banknote size={16} /> Pay & Print Payslip</button></>}>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Salary month"><select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={`${year}-${pad2(i + 1)}`}>{m} {year}</option>)}</select></Field>
        <Field label="Monthly salary"><div className="input bg-slate-50">{money(staff.monthly_salary)}</div></Field>
        <Field label="Remaining this month"><div className={`input bg-slate-50 font-semibold ${remaining ? 'text-due' : 'text-ok'}`}>{money(remaining)}</div></Field>
        <Field label="Amount to pay (full or partial)"><input type="number" className="input text-lg font-bold" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <Field label="Note" className="md:col-span-2"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <h4 className="mb-2 mt-5 font-semibold">History</h4>
      <table className="table"><tbody>
        {history.map((h) => <tr key={h.id}><td>{monthLabel(h.period)}</td><td>{fmtDate(h.paid_on)}</td><td className="text-right text-ok">{money(h.paid_amount)}</td><td className="text-right text-due">{h.due_after ? `due ${money(h.due_after)}` : ''}</td><td className="text-right"><button className="btn-ghost btn-sm" onClick={() => onSlip(h, totalDue())}><Printer size={12} /></button></td></tr>)}
      </tbody></table>
      {!history.length && <Empty>No salary paid yet.</Empty>}
    </Modal>
  );
}

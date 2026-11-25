import { useEffect, useMemo, useState } from 'react';
import { FileCheck2, Pencil, Send, Printer } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Card, Field } from '../components/ui';
import ClassPicker from '../components/ClassPicker';
import PhotoInput from '../components/PhotoInput';
import PrintPreview from '../components/PrintPreview';
import { AdmissionInvoice } from '../docs/Documents';
import { db } from '../lib/db';
import type { Student } from '../lib/fees';
import { BLOOD_GROUPS, makeStudentId, money, todayISO, uid } from '../lib/util';

type Form = Omit<Student, 'id' | 'created_at' | 'status'>;

const blank = (year: number): Form => ({
  student_id: '', admission_year: year, admission_date: todayISO(), class_no: 1, section: 'A', stream: null, roll: 1,
  name_en: '', name_bn: '', gender: 'Male', dob: '', blood_group: '', birth_cert_no: '', father_name: '', father_mobile: '',
  mother_name: '', mother_mobile: '', address: '', monthly_fee: 0, admission_fee: 0, photo: null,
});

export default function Admission({ editId, onDone }: { editId: number | null; onDone: () => void }) {
  const { settings, toast, bump, requirePin } = useApp();
  const [f, setF] = useState<Form>(blank(settings.academicYear));
  const [paid, setPaid] = useState(0);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [takenRolls, setTakenRolls] = useState<number[]>([]);
  const editing = editId != null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (editId == null) return;
    db.one<Student>('SELECT * FROM students WHERE id = ?', [editId]).then((s) => s && setF(s));
  }, [editId]);

  // Default fees per class + next free roll
  useEffect(() => {
    db.select<{ roll: number }>("SELECT roll FROM students WHERE status='active' AND class_no = ? AND id != ?", [f.class_no, editId ?? -1]).then((r) => {
      const taken = r.map((x) => x.roll);
      setTakenRolls(taken);
      if (!editing) {
        let next = 1; while (taken.includes(next)) next++;
        const fees = settings.defaultFees[f.class_no];
        setF((p) => ({ ...p, roll: next, monthly_fee: fees?.monthly ?? p.monthly_fee, admission_fee: fees?.admission ?? p.admission_fee }));
        setPaid(fees?.admission ?? 0);
      }
    });
  }, [f.class_no]); // eslint-disable-line

  const studentId = useMemo(() => (editing ? f.student_id : makeStudentId(f.admission_year, f.class_no, f.roll)), [editing, f.student_id, f.admission_year, f.class_no, f.roll]);
  const rollTaken = takenRolls.includes(f.roll);
  const due = Math.max(0, f.admission_fee - paid);

  function validate() {
    if (!f.name_en.trim()) return 'Student name (English) is required.';
    if (f.roll < 1 || f.roll > 200) return 'Roll must be between 1 and 200.';
    if (rollTaken) return `Roll ${f.roll} is already taken in Class ${f.class_no}.`;
    if (f.class_no >= 9 && !f.stream) return 'Select a Stream (Science / Arts / Commerce) for Class 9–10.';
    if (f.father_mobile && !/^01\d{9}$/.test(f.father_mobile)) return "Father's mobile must be 11 digits starting with 01.";
    if (paid > f.admission_fee) return 'Paid amount cannot exceed the admission fee.';
    return null;
  }

  async function submit() {
    setBusy(true);
    try {
      const vals = { ...f, student_id: studentId, section: settings.modules.sections ? f.section || 'A' : 'A', stream: f.class_no >= 9 ? f.stream : null };
      if (editing) {
        await db.execute(`UPDATE students SET class_no=?, section=?, stream=?, roll=?, name_en=?, name_bn=?, gender=?, dob=?, blood_group=?, birth_cert_no=?,
          father_name=?, father_mobile=?, mother_name=?, mother_mobile=?, address=?, monthly_fee=?, admission_fee=?, photo=?, updated_at=datetime('now') WHERE id=?`,
          [vals.class_no, vals.section, vals.stream, vals.roll, vals.name_en, vals.name_bn, vals.gender, vals.dob, vals.blood_group, vals.birth_cert_no,
           vals.father_name, vals.father_mobile, vals.mother_name, vals.mother_mobile, vals.address, vals.monthly_fee, vals.admission_fee, vals.photo, editId]);
        toast('Student record updated');
      } else {
        const exists = await db.one('SELECT 1 FROM students WHERE student_id = ?', [studentId]);
        if (exists) throw new Error(`Student ID ${studentId} already exists.`);
        const r = await db.execute(`INSERT INTO students(student_id, admission_year, admission_date, class_no, section, stream, roll, name_en, name_bn, gender, dob, blood_group,
          birth_cert_no, father_name, father_mobile, mother_name, mother_mobile, address, monthly_fee, admission_fee, photo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [studentId, vals.admission_year, vals.admission_date, vals.class_no, vals.section, vals.stream, vals.roll, vals.name_en, vals.name_bn, vals.gender, vals.dob,
           vals.blood_group, vals.birth_cert_no, vals.father_name, vals.father_mobile, vals.mother_name, vals.mother_mobile, vals.address, vals.monthly_fee, vals.admission_fee, vals.photo]);
        if (settings.modules.fees && (paid > 0 || vals.admission_fee > 0)) {
          await db.execute('INSERT INTO fee_ledger(student_id, receipt_no, fee_type, period, regular_amount, paid_amount, due_after, paid_on, note) VALUES (?,?,?,?,?,?,?,?,?)',
            [r.last_insert_id, uid('R'), 'ADMISSION', 'ADMISSION', vals.admission_fee, paid, due, vals.admission_date, 'Paid at admission']);
        }
        toast(`Admission confirmed — Student ID ${studentId}`);
      }
      bump();
      setReview(false);
      if (editing) onDone(); else { setF(blank(settings.academicYear)); setF((p) => ({ ...p, class_no: vals.class_no, section: vals.section, stream: vals.stream })); }
    } catch (e: any) {
      toast(e.message ?? String(e), 'err');
    } finally { setBusy(false); }
  }

  async function openReview() {
    const err = validate();
    if (err) return toast(err, 'err');
    if (editing && !(await requirePin('modify', 'Modifying a saved student record requires the Modify PIN.'))) return;
    setReview(true);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">{editing ? 'Edit Student Record' : 'New Student Admission'}</h1><p className="text-sm text-slate-500">Auto Student ID format YYCCRR (year · class · roll)</p></div>
        <div className="rounded-xl bg-navy px-5 py-3 text-right text-white"><div className="text-[10px] uppercase tracking-wider text-slate-400">Student ID</div><div className="font-mono text-2xl font-bold tracking-widest text-brand">{studentId}</div></div>
      </div>

      <Card title="Academic placement">
        <div className="grid gap-4 p-4 md:grid-cols-4">
          <ClassPicker classNo={f.class_no} section={f.section} stream={f.class_no >= 9 ? (f.stream ?? 'Science') : null} allowAllSections={false} requireStream
            onChange={(v) => setF((p) => ({ ...p, class_no: v.classNo || 1, section: v.section || 'A', stream: v.classNo >= 9 ? (v.stream || 'Science') : null }))} />
          <Field label="Roll Number" hint={rollTaken ? '⚠ already taken' : 'Unique within the class (1–200)'}>
            <input type="number" min={1} max={200} className={`input ${rollTaken ? 'border-bad' : ''}`} value={f.roll} onChange={(e) => set('roll', Number(e.target.value))} />
          </Field>
          <Field label="Admission date"><input type="date" className="input" value={f.admission_date} disabled={editing} onChange={(e) => set('admission_date', e.target.value)} /></Field>
        </div>
      </Card>

      <Card title="Student information">
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Student Name (English) *" className="md:col-span-2"><input className="input" value={f.name_en} onChange={(e) => set('name_en', e.target.value)} /></Field>
            <Field label="Gender"><select className="input" value={f.gender ?? ''} onChange={(e) => set('gender', e.target.value)}><option>Male</option><option>Female</option><option>Other</option></select></Field>
            <Field label="শিক্ষার্থীর নাম (বাংলা)" className="md:col-span-2"><input className="input bn" value={f.name_bn ?? ''} onChange={(e) => set('name_bn', e.target.value)} /></Field>
            <Field label="Date of Birth"><input type="date" className="input" value={f.dob ?? ''} onChange={(e) => set('dob', e.target.value)} /></Field>
            <Field label="Blood Group"><select className="input" value={f.blood_group ?? ''} onChange={(e) => set('blood_group', e.target.value)}><option value="">—</option>{BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}</select></Field>
            <Field label="Birth Certificate Number" className="md:col-span-2"><input className="input" value={f.birth_cert_no ?? ''} onChange={(e) => set('birth_cert_no', e.target.value)} /></Field>
          </div>
          <Field label="Photo"><PhotoInput value={f.photo} onChange={(v) => set('photo', v)} /></Field>
        </div>
      </Card>

      <Card title="Guardian information">
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <Field label="Father's Name"><input className="input" value={f.father_name ?? ''} onChange={(e) => set('father_name', e.target.value)} /></Field>
          <Field label="Father's Mobile (search key)"><input className="input" inputMode="tel" placeholder="01XXXXXXXXX" value={f.father_mobile ?? ''} onChange={(e) => set('father_mobile', e.target.value.replace(/\D/g, '').slice(0, 11))} /></Field>
          <Field label="Mother's Name"><input className="input" value={f.mother_name ?? ''} onChange={(e) => set('mother_name', e.target.value)} /></Field>
          <Field label="Mother's Mobile"><input className="input" inputMode="tel" value={f.mother_mobile ?? ''} onChange={(e) => set('mother_mobile', e.target.value.replace(/\D/g, '').slice(0, 11))} /></Field>
          <Field label="Address" className="md:col-span-2"><input className="input" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        </div>
      </Card>

      {settings.modules.fees && (
        <Card title="Fees">
          <div className="grid gap-4 p-4 md:grid-cols-4">
            <Field label="Monthly Tuition Fee"><input type="number" className="input" value={f.monthly_fee} onChange={(e) => set('monthly_fee', Number(e.target.value))} /></Field>
            <Field label="Total Admission Fee"><input type="number" className="input" value={f.admission_fee} onChange={(e) => set('admission_fee', Number(e.target.value))} /></Field>
            {!editing && <Field label="Paid Amount"><input type="number" className="input" value={paid} onChange={(e) => setPaid(Number(e.target.value))} /></Field>}
            {!editing && <Field label="Admission Due (auto)"><div className={`input font-bold ${due ? 'text-due' : 'text-ok'}`}>{money(due)}</div></Field>}
          </div>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        {editing && <button className="btn-ghost" onClick={onDone}>Cancel</button>}
        <button className="btn-primary px-6 py-3" onClick={openReview}><FileCheck2 size={18} /> Review A4 Summary {editing ? '& Save' : '& Invoice'}</button>
      </div>

      <PrintPreview open={review} onClose={() => setReview(false)} title={editing ? 'Review changes' : 'Admission review — check before submitting'}
        actions={<>
          <button className="btn border border-white/20 text-white hover:bg-white/10" onClick={() => setReview(false)}><Pencil size={16} /> Modify / Edit Info</button>
          <button className="btn bg-ok text-white hover:bg-emerald-600" disabled={busy} onClick={submit}><Send size={16} /> {editing ? 'Confirm & Save Changes' : 'Confirm & Submit Admission'}</button>
        </>}>
        <AdmissionInvoice school={settings.school} s={{ ...f, student_id: studentId }} paid={editing ? 0 : paid} showFees={settings.modules.fees && !editing} />
        <p className="no-print mt-2 text-center text-sm text-white/70"><Printer size={14} className="inline" /> Print now, or after submitting reopen from the Student Directory.</p>
      </PrintPreview>
    </div>
  );
}

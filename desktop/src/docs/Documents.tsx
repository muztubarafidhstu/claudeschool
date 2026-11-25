import type { ReactNode } from 'react';
import type { SchoolProfile } from '../lib/config';
import type { LedgerRow, Student } from '../lib/fees';
import type { MonthlyAttendance } from '../lib/attendance';
import type { ResultCalc } from '../lib/grading';
import { GRADE_SCALE } from '../lib/grading';
import { fmtDate, money, monthLabel, todayISO } from '../lib/util';

export function DocHeader({ school, title, subtitle }: { school: SchoolProfile; title: string; subtitle?: string }) {
  return (
    <div className="mb-4 border-b-2 border-navy pb-3">
      <div className="flex items-center gap-4">
        {school.logo ? <img src={school.logo} className="h-16 w-16 object-contain" /> : <div className="grid h-16 w-16 place-items-center rounded-full bg-navy text-xl font-bold text-white">{(school.name || 'S')[0]}</div>}
        <div className="flex-1 text-center">
          <div className="text-xl font-bold uppercase tracking-wide">{school.name || 'Your School Name'}</div>
          {school.name_bn && <div className="bn text-base font-semibold">{school.name_bn}</div>}
          <div className="text-[11px] text-slate-600">{[school.address, school.phone && `Phone: ${school.phone}`, school.eiin && `EIIN: ${school.eiin}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="w-16" />
      </div>
      <div className="mt-3 text-center"><span className="rounded bg-navy px-4 py-1 text-sm font-bold uppercase tracking-wider text-white">{title}</span></div>
      {subtitle && <div className="mt-1 text-center text-xs text-slate-600">{subtitle}</div>}
    </div>
  );
}

export function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="mt-14 flex justify-between gap-6">
      {labels.map((l) => (
        <div key={l} className="flex flex-col items-center">
          {/seal/i.test(l) && <div className="mb-2 grid h-16 w-16 place-items-center rounded-full border border-dashed border-slate-400 text-[9px] text-slate-400">SEAL</div>}
          <div className="sig">{l}</div>
        </div>
      ))}
    </div>
  );
}

const Info = ({ rows }: { rows: [string, ReactNode][] }) => (
  <table className="doc"><tbody>{rows.map(([k, v], i) => <tr key={i}><th className="w-[38%]">{k}</th><td>{v ?? '—'}</td></tr>)}</tbody></table>
);

export function PhotoBox({ src }: { src: string | null }) {
  return <div className="h-[36mm] w-[30mm] shrink-0 overflow-hidden border border-slate-400 bg-slate-50">{src ? <img src={src} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[10px] text-slate-400">PHOTO</div>}</div>;
}

// ------------------------------------------------------------------ Admission
export function AdmissionInvoice({ school, s, paid, showFees }: { school: SchoolProfile; s: Omit<Student, 'id' | 'created_at' | 'status'>; paid: number; showFees: boolean }) {
  const due = Math.max(0, s.admission_fee - paid);
  return (
    <div className="a4">
      <DocHeader school={school} title="Admission Summary & Fee Invoice" subtitle={`Academic Year ${s.admission_year} · Date ${fmtDate(s.admission_date)}`} />
      <div className="flex gap-4">
        <div className="flex-1">
          <Info rows={[
            ['Student ID', <b className="font-mono text-base">{s.student_id}</b>],
            ['Student Name (English)', <b>{s.name_en}</b>],
            ['ছাত্র/ছাত্রীর নাম (বাংলা)', <span className="bn">{s.name_bn}</span>],
            ['Class / Section / Roll', `Class ${s.class_no}${s.section ? ` · Section ${s.section}` : ''}${s.stream ? ` · ${s.stream}` : ''} · Roll ${s.roll}`],
            ['Gender / Date of Birth', `${s.gender ?? '—'} · ${fmtDate(s.dob)}`],
            ['Blood Group', s.blood_group], ['Birth Certificate No.', s.birth_cert_no],
          ]} />
        </div>
        <PhotoBox src={s.photo} />
      </div>
      <h4 className="mb-1 mt-4 font-semibold">Guardian Information</h4>
      <Info rows={[["Father's Name", s.father_name], ["Father's Mobile", s.father_mobile], ["Mother's Name", s.mother_name], ["Mother's Mobile", s.mother_mobile], ['Address', s.address]]} />
      {showFees && (
        <>
          <h4 className="mb-1 mt-4 font-semibold">Fee Invoice</h4>
          <table className="doc">
            <thead><tr><th>Description</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              <tr><td>Total Admission Fee</td><td className="text-right">{money(s.admission_fee)}</td></tr>
              <tr><td>Paid at Admission</td><td className="text-right">{money(paid)}</td></tr>
              <tr><td><b>Admission Due</b></td><td className="text-right font-bold" style={{ color: due ? '#B45309' : '#047857' }}>{money(due)}</td></tr>
              <tr><td>Monthly Tuition Fee (from {monthLabel(s.admission_date.slice(0, 7))})</td><td className="text-right">{money(s.monthly_fee)}</td></tr>
            </tbody>
          </table>
        </>
      )}
      <p className="mt-4 text-[11px] text-slate-600">I hereby declare that the information above is correct and I agree to abide by the rules and regulations of the institution.</p>
      <Signatures labels={['Guardian Signature', 'Office Seal', 'Principal Signature & Seal']} />
    </div>
  );
}

// ------------------------------------------------------------------ Marksheet
export function Marksheet({ school, s, exam, year, calc }: { school: SchoolProfile; s: Student; exam: string; year: number; calc: ResultCalc }) {
  return (
    <div className="a4">
      <DocHeader school={school} title="Academic Transcript / Marksheet" subtitle={`${exam === 'FINAL' ? 'Annual / Final' : 'Half Yearly'} Examination ${year}`} />
      <div className="flex gap-4">
        <div className="flex-1"><Info rows={[['Student Name', <b>{s.name_en} {s.name_bn && <span className="bn font-normal">({s.name_bn})</span>}</b>], ['Student ID', s.student_id], ['Class / Section / Roll', `Class ${s.class_no}${s.section ? `-${s.section}` : ''}${s.stream ? ` · ${s.stream}` : ''} · Roll ${s.roll}`], ["Father's Name", s.father_name]]} /></div>
        <PhotoBox src={s.photo} />
      </div>
      <table className="doc mt-4">
        <thead><tr><th>#</th><th>Subject</th><th className="text-center">Full Marks</th><th className="text-center">Obtained</th><th className="text-center">Grade</th><th className="text-center">Grade Point</th></tr></thead>
        <tbody>
          {calc.lines.map((l, i) => (
            <tr key={l.subject}><td>{i + 1}</td><td>{l.subject}</td><td className="text-center">{l.full}</td><td className="text-center">{l.obtained}</td>
              <td className="text-center font-semibold" style={{ color: l.gp === 0 ? '#DC2626' : undefined }}>{l.grade}</td><td className="text-center">{l.gp.toFixed(2)}</td></tr>
          ))}
          <tr><th colSpan={2}>Total</th><th className="text-center">{calc.totalFull}</th><th className="text-center">{calc.obtained}</th><th className="text-center">{calc.grade}</th><th className="text-center">{calc.gpa.toFixed(2)}</th></tr>
        </tbody>
      </table>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        {[['Total Marks', `${calc.obtained} / ${calc.totalFull}`], ['Percentage', `${calc.percentage}%`], ['GPA', calc.gpa.toFixed(2)], ['Result', calc.passed ? 'PASSED' : 'FAILED']].map(([k, v]) => (
          <div key={k} className="rounded border border-slate-300 p-2"><div className="text-[10px] uppercase text-slate-500">{k}</div><div className="text-base font-bold" style={{ color: k === 'Result' ? (calc.passed ? '#059669' : '#DC2626') : undefined }}>{v}</div></div>
        ))}
      </div>
      <table className="doc mt-4 text-[10px]"><tbody><tr><th>Grading</th>{GRADE_SCALE.map((g) => <td key={g.grade} className="text-center">{g.grade}: {g.min}+ ({g.gp.toFixed(1)})</td>)}</tr></tbody></table>
      <Signatures labels={["Guardian's Signature", 'Class Teacher Signature', 'Principal Signature & Seal']} />
    </div>
  );
}

// ------------------------------------------------------------------ Attendance grid used in receipt page 2
export function AttendanceDayTable({ att }: { att: MonthlyAttendance }) {
  const rows = [att.days.slice(0, 16), att.days.slice(16)];
  return (
    <table className="doc text-center text-[11px]">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((d) => (
              <td key={d.day} className={d.status === 'P' ? 'cell-p' : d.status === 'A' ? 'cell-a' : d.status === 'F' ? 'cell-f' : ''} style={{ padding: 3 }}>
                <div className="text-[9px] opacity-80">{String(d.day).padStart(2, '0')}</div>
                <div>{d.status === '-' ? '' : d.status}</div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ Fee receipt (2 pages)
export function FeeReceipt({ school, s, row, totalDue, att, attMonth }: { school: SchoolProfile; s: Student; row: LedgerRow; totalDue: number; att: MonthlyAttendance; attMonth: string }) {
  const head = row.period === 'ADMISSION' ? 'Admission Fee' : /^\d{4}-\d{2}$/.test(row.period) ? `Monthly Tuition Fee — ${monthLabel(row.period)}` : row.period.replace('_', ' ').replace('-', ' Exam Fee ');
  return (
    <>
      <div className="a4">
        <DocHeader school={school} title="Official Fee Payment Receipt" subtitle={`Receipt No. ${row.receipt_no} · Date ${fmtDate(row.paid_on)}`} />
        <Info rows={[['Student Name', <b>{s.name_en} {s.name_bn && <span className="bn font-normal">({s.name_bn})</span>}</b>], ['Student ID', s.student_id], ['Class / Section / Roll', `Class ${s.class_no}${s.section ? `-${s.section}` : ''}${s.stream ? ` · ${s.stream}` : ''} · Roll ${s.roll}`], ["Father's Name / Mobile", `${s.father_name ?? '—'} · ${s.father_mobile ?? '—'}`]]} />
        <table className="doc mt-5">
          <thead><tr><th>Fee Head</th><th className="text-right">Regular Amount</th><th className="text-right">Paid Amount</th><th className="text-right">Remaining Due</th></tr></thead>
          <tbody><tr><td>{head}</td><td className="text-right">{money(row.regular_amount)}</td><td className="text-right font-bold">{money(row.paid_amount)}</td><td className="text-right" style={{ color: row.due_after ? '#B45309' : '#047857' }}>{money(row.due_after)}</td></tr></tbody>
        </table>
        <div className="mt-4 flex justify-end">
          <table className="doc w-[90mm]"><tbody>
            <tr><th>Amount Received</th><td className="text-right text-base font-bold">{money(row.paid_amount)}</td></tr>
            <tr><th>Cumulative Unpaid Balance</th><td className="text-right font-bold" style={{ color: totalDue ? '#DC2626' : '#047857' }}>{money(totalDue)}</td></tr>
          </tbody></table>
        </div>
        {row.note && <p className="mt-3 text-xs">Note: {row.note}</p>}
        <p className="mt-6 text-[11px] text-slate-500">This is a computer-generated receipt from ScholarDesk Pro. Please keep it for your records. Page 2 contains the student's attendance report for {monthLabel(attMonth)}.</p>
        <Signatures labels={['Depositor Signature', 'Office Seal', 'Accountant / Cashier']} />
      </div>
      <div className="a4">
        <DocHeader school={school} title="Monthly Student Attendance Report" subtitle={monthLabel(attMonth)} />
        <Info rows={[['Student Name', <b>{s.name_en}</b>], ['Student ID / Roll', `${s.student_id} · Roll ${s.roll}`], ['Class / Section', `Class ${s.class_no}${s.section ? `-${s.section}` : ''}${s.stream ? ` · ${s.stream}` : ''}`]]} />
        <div className="my-5 grid grid-cols-4 gap-2 text-center">
          {[['Working Days', att.working], ['Present Days', att.present], ['Absent Days', att.absent], ['Attendance %', `${att.pct}%`]].map(([k, v]) => (
            <div key={k} className="rounded border border-slate-300 p-3"><div className="text-[10px] uppercase text-slate-500">{k}</div><div className="text-xl font-bold">{v}</div></div>
          ))}
        </div>
        <AttendanceDayTable att={att} />
        <div className="mt-2 flex gap-4 text-[11px]"><span><span className="cell-p inline-block w-5">P</span> Present</span><span><span className="cell-a inline-block w-5">A</span> Absent</span><span><span className="cell-f inline-block w-5">F</span> Friday — Weekly Holiday</span><span>Blank = not recorded</span></div>
        <Signatures labels={['Guardian Signature', 'Class Teacher Signature', 'Principal Signature & Seal']} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Payslip
export function Payslip({ school, staff, row, dueTotal }: { school: SchoolProfile; staff: { name_en: string; name_bn: string | null; designation: string; mobile: string; staff_code: string; join_date: string | null; photo: string | null }; row: { slip_no: string; period: string; regular_amount: number; paid_amount: number; due_after: number; paid_on: string; note: string | null }; dueTotal: number }) {
  return (
    <div className="a4">
      <DocHeader school={school} title="Salary Payslip" subtitle={`${monthLabel(row.period)} · Slip No. ${row.slip_no}`} />
      <div className="flex gap-4">
        <div className="flex-1"><Info rows={[['Name', <b>{staff.name_en} {staff.name_bn && <span className="bn font-normal">({staff.name_bn})</span>}</b>], ['Staff Code', staff.staff_code], ['Designation', staff.designation], ['Mobile', staff.mobile], ['Joining Date', fmtDate(staff.join_date)]]} /></div>
        <PhotoBox src={staff.photo} />
      </div>
      <table className="doc mt-5">
        <thead><tr><th>Salary Month</th><th className="text-right">Monthly Salary</th><th className="text-right">Paid Now</th><th className="text-right">Remaining Due (month)</th></tr></thead>
        <tbody><tr><td>{monthLabel(row.period)}</td><td className="text-right">{money(row.regular_amount)}</td><td className="text-right font-bold">{money(row.paid_amount)}</td><td className="text-right">{money(row.due_after)}</td></tr></tbody>
      </table>
      <div className="mt-4 flex justify-end"><table className="doc w-[90mm]"><tbody><tr><th>Payment Date</th><td>{fmtDate(row.paid_on)}</td></tr><tr><th>Total Outstanding Salary</th><td className="font-bold">{money(dueTotal)}</td></tr></tbody></table></div>
      {row.note && <p className="mt-3 text-xs">Note: {row.note}</p>}
      <Signatures labels={['Receiver Signature', 'Accountant', 'Principal Signature & Seal']} />
    </div>
  );
}

// ------------------------------------------------------------------ Contact directory
export function ContactDirectory({ school, title, rows }: { school: SchoolProfile; title: string; rows: Student[] }) {
  return (
    <div className="a4">
      <DocHeader school={school} title="Student Contact Directory" subtitle={`${title} · Printed ${fmtDate(todayISO())} · ${rows.length} students`} />
      <table className="doc text-[11px]">
        <thead><tr><th>#</th><th>Roll</th><th>ID</th><th>Class</th><th>Student Name</th><th>Father's Name</th><th>Mobile Number</th></tr></thead>
        <tbody>{rows.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td>{s.roll}</td><td>{s.student_id}</td><td>{s.class_no}{s.section ? `-${s.section}` : ''}{s.stream ? ` ${s.stream[0]}` : ''}</td><td>{s.name_en}{s.name_bn && <span className="bn text-slate-500"> · {s.name_bn}</span>}</td><td>{s.father_name}</td><td>{s.father_mobile}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

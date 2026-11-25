import { useEffect, useState } from 'react';
import { groupLabel, isCoaching, terms } from '../lib/groups';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
import { Users, CalendarCheck, Wallet, AlertCircle, BadgeDollarSign, UserPlus, GraduationCap } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Card, Kpi, Empty } from '../components/ui';
import type { Page } from '../components/Layout';
import { db } from '../lib/db';
import { schoolOutstanding } from '../lib/fees';
import { fmtDate, money, monthKey, todayISO } from '../lib/util';

export default function Dashboard({ go }: { go: (p: Page) => void }) {
  const { settings, t, dataVersion, openStudent } = useApp();
  const m = settings.modules;
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const today = todayISO(), ym = monthKey();
      const students = (await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM students WHERE status='active'"))!.n;
      const byClass = await db.select<{ class_no: number; n: number; boys: number }>("SELECT class_no, COUNT(*) AS n, SUM(gender='Male') AS boys FROM students WHERE status='active' GROUP BY class_no ORDER BY class_no");
      const att = m.attendance ? await db.one<{ p: number; a: number }>("SELECT SUM(status='P') AS p, SUM(status='A') AS a FROM attendance_logs WHERE date = ?", [today]) : null;
      const collected = m.fees ? (await db.one<{ s: number }>('SELECT COALESCE(SUM(paid_amount),0) AS s FROM fee_ledger WHERE paid_on LIKE ?', [`${ym}%`]))!.s : 0;
      const outstanding = m.fees ? await schoolOutstanding() : 0;
      const recent = m.fees ? await db.select("SELECT f.*, s.name_en, s.class_no, s.roll FROM fee_ledger f JOIN students s ON s.id=f.student_id ORDER BY f.paid_on DESC, f.id DESC LIMIT 8") : [];
      const staff = m.payroll ? await db.one<{ n: number; total: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN pay_type = 'MONTHLY' THEN monthly_salary ELSE 0 END),0) AS total FROM staff WHERE status='active'") : null;
      const salaryPaid = m.payroll ? (await db.one<{ s: number }>("SELECT COALESCE(SUM(l.paid_amount),0) AS s FROM salary_ledger l JOIN staff t ON t.id = l.staff_id WHERE l.period = ? AND t.pay_type = 'MONTHLY'", [ym]))!.s : 0;
      const results = !m.exams ? null : isCoaching(settings)
        ? await db.one<{ n: number; pass: number; exams: number }>(`SELECT COUNT(m.id) AS n, SUM(CASE WHEN m.obtained >= e.pass_marks THEN 1 ELSE 0 END) AS pass,
              (SELECT COUNT(*) FROM coaching_exams WHERE exam_date LIKE ?) AS exams
             FROM coaching_marks m JOIN coaching_exams e ON e.id = m.exam_id WHERE e.exam_date LIKE ? AND m.absent = 0`, [`${settings.academicYear}%`, `${settings.academicYear}%`])
        : await db.one<{ n: number; pass: number; exams: number }>('SELECT COUNT(*) AS n, SUM(passed) AS pass, 0 AS exams FROM exam_results WHERE academic_year = ?', [settings.academicYear]);
      setD({ students, byClass, att, collected, outstanding, recent, staff, salaryPaid, results });
    })();
  }, [dataVersion, m.attendance, m.fees, m.payroll, m.exams, settings.academicYear]);

  if (!d) return null;
  const marked = (d.att?.p ?? 0) + (d.att?.a ?? 0);
  const max = Math.max(1, ...d.byClass.map((c: any) => c.n));
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0F172A] via-[#0F3B46] to-brand p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-20 right-32 h-44 w-44 rounded-full bg-teal-300/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-teal-100">{greeting()} · {fmtDate(todayISO())}</div>
            <h1 className="mt-1 text-2xl font-bold">{settings.school.name || t('dashboard')}</h1>
            {settings.school.name_bn && <div className="bn text-teal-50/90">{settings.school.name_bn}</div>}
            <div className="mt-2 inline-flex rounded-full bg-white/15 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider">{isCoaching(settings) ? 'Coaching Centre' : 'School'} · {d.students} students</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn bg-white text-navy shadow hover:bg-teal-50" onClick={() => go('admission')}><UserPlus size={16} /> {t('admission')}</button>
            {m.fees && <button className="btn border border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={() => go('fees')}><Wallet size={16} /> {t('fees')}</button>}
            {m.attendance && <button className="btn border border-white/25 bg-white/10 text-white hover:bg-white/20" onClick={() => go('attendance')}><CalendarCheck size={16} /> {t('attendance')}</button>}
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t('totalStudents')} value={d.students} icon={<Users />} sub={`${terms(settings).groups}: ${new Set(d.byClass.map((c: any) => c.class_no)).size}`} />
        {m.attendance && <Kpi label={t('todayAttendance')} value={marked ? `${Math.round((d.att.p / marked) * 100)}%` : '—'} tone="ok" icon={<CalendarCheck />} sub={marked ? `${d.att.p} present · ${d.att.a} absent` : 'Not taken yet today'} />}
        {m.fees && <Kpi label={t('collectedMonth')} value={money(d.collected)} tone="brand" icon={<Wallet />} />}
        {m.fees && <Kpi label={t('outstandingDues')} value={money(d.outstanding)} tone="due" icon={<AlertCircle />} />}
        {m.payroll && <Kpi label={t('totalStaff')} value={d.staff.n} tone="slate" icon={<BadgeDollarSign />} sub={`${t('salaryDue')}: ${money(Math.max(0, d.staff.total - d.salaryPaid))}`} />}
        {m.exams && <Kpi label={isCoaching(settings) ? `Exams ${settings.academicYear}` : `Results ${settings.academicYear}`} value={isCoaching(settings) ? d.results.exams : d.results.n} tone="slate" icon={<GraduationCap />} sub={d.results.n ? `Pass rate ${Math.round((d.results.pass / d.results.n) * 100)}%` : 'No results yet'} />}
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <Card title={isCoaching(settings) ? 'Batch-wise Students' : t('classStrength')} className="xl:col-span-3">
          <div className="space-y-2.5 p-4">
            {d.byClass.length ? d.byClass.map((c: any) => (
              <div key={c.class_no} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate text-slate-500" title={groupLabel(settings, c.class_no)}>{groupLabel(settings, c.class_no)}</span>
                <div className="h-6 flex-1 overflow-hidden rounded bg-slate-100">
                  <div className="flex h-full" style={{ width: `${(c.n / max) * 100}%` }}>
                    <div className="h-full bg-brand" style={{ width: `${(c.boys / c.n) * 100}%` }} />
                    <div className="h-full bg-teal-300" style={{ flex: 1 }} />
                  </div>
                </div>
                <span className="w-24 shrink-0 text-right font-semibold">{c.n} <span className="text-xs font-normal text-slate-400">/ 200</span></span>
              </div>
            )) : <Empty>No students yet.</Empty>}
            {d.byClass.length > 0 && <div className="flex gap-4 pt-1 text-xs text-slate-500"><span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-brand" /> Boys</span><span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-teal-300" /> Girls</span></div>}
          </div>
        </Card>
        {m.fees && (
          <Card title={t('recentReceipts')} className="xl:col-span-2">
            <table className="table"><tbody>
              {d.recent.map((r: any) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openStudent(r.student_id)}>
                  <td><div className="font-medium">{r.name_en}</div><div className="text-xs text-slate-400">{groupLabel(settings, r.class_no)} · Roll {r.roll} · {r.period}</div></td>
                  <td className="text-right font-semibold text-ok">{money(r.paid_amount)}</td>
                </tr>
              ))}
              {!d.recent.length && <tr><td><Empty>No receipts yet.</Empty></td></tr>}
            </tbody></table>
          </Card>
        )}
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, PauseCircle, AlarmClock, Wifi, Users, Wallet, BellRing } from 'lucide-react';
import { api, fmtBdt, fmtDate } from '@/lib/api';

export default function Dashboard() {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/admin/stats').then(setS).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="text-[#EF4444]">{err}</p>;
  if (!s) return <p className="text-slate-500">Loading…</p>;
  const kpis = [
    { label: 'Waiting for approval', value: s.pending, icon: BellRing, color: 'text-blue-600', href: '/pending/' },
    { label: 'Active schools', value: s.active, icon: CheckCircle2, color: 'text-[#10B981]' },
    { label: 'Suspended', value: s.suspended, icon: PauseCircle, color: 'text-[#EF4444]' },
    { label: 'Expired / past due', value: s.expired, icon: AlarmClock, color: 'text-[#F59E0B]' },
    { label: 'Expiring ≤ 15 days', value: s.expiring_soon, icon: AlarmClock, color: 'text-[#F59E0B]' },
    { label: 'Online in last 7 days', value: s.online_7d, icon: Wifi, color: 'text-[#0D9488]' },
    { label: 'Students managed', value: s.students, icon: Users, color: 'text-slate-700' },
    { label: 'Revenue this month', value: fmtBdt(s.revenue_this_month), icon: Wallet, color: 'text-[#0D9488]' },
    { label: 'Revenue all time', value: fmtBdt(s.revenue_all_time), icon: Wallet, color: 'text-slate-700' },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/schools/?new=1" className="btn-primary">+ New School License</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon, color, href }: any) => {
          const body = (<><Icon className={color} size={20} /><div className="mt-2 text-2xl font-bold">{value}</div><div className="text-xs text-slate-500">{label}</div></>);
          return href
            ? <Link key={label} href={href} className={`card p-4 hover:border-[#0D9488] ${value > 0 ? 'ring-2 ring-blue-200' : ''}`}>{body}</Link>
            : <div key={label} className="card p-4">{body}</div>;
        })}
      </div>
      <div className="card overflow-x-auto">
        <div className="border-b border-slate-200 px-4 py-3 font-semibold">Recent subscription payments</div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">School</th><th className="p-3">Amount</th><th className="p-3">Method</th><th className="p-3">Extended to</th><th className="p-3">Date</th></tr></thead>
          <tbody>
            {s.recent_payments.map((p: any) => (
              <tr key={p.id} className="border-t border-slate-100"><td className="p-3">{p.school_name}</td><td className="p-3 font-semibold">{fmtBdt(p.amount_bdt)}</td><td className="p-3">{p.method}</td><td className="p-3">{p.extended_to}</td><td className="p-3">{fmtDate(p.paid_at)}</td></tr>
            ))}
            {!s.recent_payments.length && <tr><td className="p-4 text-slate-500" colSpan={5}>No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

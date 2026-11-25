'use client';
import { useEffect, useState } from 'react';
import { api, fmtBdt, fmtDate } from '@/lib/api';

export default function Payments() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api('/admin/payments').then(setRows); }, []);
  const total = rows.reduce((a, r) => a + Number(r.amount_bdt), 0);
  function csv() {
    const lines = [['Date', 'School', 'License', 'Amount', 'Method', 'Ref', 'Extended to'], ...rows.map((r) => [r.paid_at, r.school_name, r.license_key, r.amount_bdt, r.method, r.transaction_ref ?? '', r.extended_to])];
    const blob = new Blob([lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'scholardesk-payments.csv'; a.click();
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">Payments</h1><div className="flex items-center gap-3"><span className="font-semibold">Total {fmtBdt(total)}</span><button className="btn-ghost" onClick={csv}>Download CSV</button></div></div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">School</th><th className="p-3">Amount</th><th className="p-3">Method</th><th className="p-3">Ref</th><th className="p-3">Extended to</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-slate-100"><td className="p-3 text-xs">{fmtDate(r.paid_at)}</td><td className="p-3">{r.school_name}<div className="font-mono text-xs text-slate-400">{r.license_key}</div></td><td className="p-3 font-semibold">{fmtBdt(r.amount_bdt)}</td><td className="p-3">{r.method}</td><td className="p-3">{r.transaction_ref}</td><td className="p-3">{r.extended_to}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

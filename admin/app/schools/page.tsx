'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, Power, PowerOff, Copy, X } from 'lucide-react';
import { api, effectiveStatus, fmtBdt, fmtDate, type SchoolRow } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

function SchoolsInner() {
  const params = useSearchParams();
  const [rows, setRows] = useState<SchoolRow[]>([]);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(params.get('new') === '1');
  const [created, setCreated] = useState<string | null>(null);
  const load = useCallback(() => api<SchoolRow[]>(`/admin/schools?q=${encodeURIComponent(q)}`).then(setRows), [q]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  async function toggle(r: SchoolRow) {
    const next = r.status === 'SUSPENDED' || effectiveStatus(r) !== 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED';
    const reason = next === 'SUSPENDED' ? prompt('Reason shown to the school (optional):', 'Subscription payment pending') ?? undefined : undefined;
    try { await api(`/admin/licenses/${r.license_id}/status`, { method: 'POST', body: JSON.stringify({ status: next, reason }) }); load(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Schools & Licenses</h1>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New School License</button>
      </div>
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
        <input className="input pl-9" placeholder="Search school, phone or license key…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {created && (
        <div className="card flex flex-wrap items-center gap-3 border-[#0D9488] bg-teal-50 p-4">
          <span>New license key:</span><code className="rounded bg-white px-2 py-1 font-mono text-lg font-bold">{created}</code>
          <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(created)}><Copy size={14} /> Copy</button>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="p-3">School</th><th className="p-3">License key</th><th className="p-3">Status</th><th className="p-3">Valid until</th><th className="p-3">Plan</th><th className="p-3">Students</th><th className="p-3">Last online</th><th className="p-3 text-right">Remote control</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = effectiveStatus(r);
              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="p-3"><Link href={`/schools/view/?id=${r.id}`} className="font-semibold text-[#0D9488] hover:underline">{r.name}</Link><div className="text-xs text-slate-500">{r.phone}</div></td>
                  <td className="p-3 font-mono text-xs">{r.license_key}</td>
                  <td className="p-3"><StatusBadge status={st} /></td>
                  <td className="p-3">{r.valid_until}</td>
                  <td className="p-3">{r.billing_cycle} · {fmtBdt(r.price_bdt)}</td>
                  <td className="p-3">{r.last_student_count ?? '—'} / {r.max_students}</td>
                  <td className="p-3 text-xs">{fmtDate(r.last_seen_at)}<div className="text-slate-400">{r.machine_id ?? 'not activated'}</div></td>
                  <td className="p-3 text-right">
                    {st === 'PENDING'
                      ? <Link href="/pending/" className="btn-primary">Review request</Link>
                      : st === 'ACTIVE'
                      ? <button className="btn-danger" onClick={() => toggle(r)}><PowerOff size={14} /> Turn OFF</button>
                      : <button className="btn-primary" onClick={() => toggle(r)}><Power size={14} /> Activate</button>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">No schools yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {showNew && <NewSchoolModal onClose={() => setShowNew(false)} onCreated={(k) => { setCreated(k); setShowNew(false); load(); }} />}
    </div>
  );
}

function NewSchoolModal({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const [f, setF] = useState({ name: '', name_bn: '', contact_person: '', phone: '', email: '', address: '', district: '', billing_cycle: 'YEARLY', price_bdt: '12000', valid_until: '', max_students: '2000' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = { ...f, valid_until: f.valid_until || undefined };
      const r = await api('/admin/schools', { method: 'POST', body: JSON.stringify(body) });
      onCreated(r.license.license_key);
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <form onSubmit={save} className="card mt-10 w-full max-w-2xl space-y-4 p-6">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">New school & license key</h2><button type="button" onClick={onClose}><X /></button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label">School name *</label><input className="input" value={f.name} onChange={set('name')} required /></div>
          <div><label className="label">Name (Bangla)</label><input className="input" value={f.name_bn} onChange={set('name_bn')} /></div>
          <div><label className="label">Contact person</label><input className="input" value={f.contact_person} onChange={set('contact_person')} /></div>
          <div><label className="label">Phone</label><input className="input" value={f.phone} onChange={set('phone')} /></div>
          <div><label className="label">Email</label><input className="input" type="email" value={f.email} onChange={set('email')} /></div>
          <div><label className="label">District</label><input className="input" value={f.district} onChange={set('district')} /></div>
          <div><label className="label">Address</label><input className="input" value={f.address} onChange={set('address')} /></div>
          <div><label className="label">Billing cycle</label>
            <select className="input" value={f.billing_cycle} onChange={set('billing_cycle')}>
              <option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option><option value="TRIAL">Trial (14 days)</option><option value="LIFETIME">Lifetime</option>
            </select></div>
          <div><label className="label">Price per cycle (BDT)</label><input className="input" type="number" value={f.price_bdt} onChange={set('price_bdt')} /></div>
          <div><label className="label">Expiry date (blank = one cycle)</label><input className="input" type="date" value={f.valid_until} onChange={set('valid_until')} /></div>
          <div><label className="label">Max students</label><input className="input" type="number" value={f.max_students} onChange={set('max_students')} /></div>
        </div>
        {err && <p className="text-sm text-[#EF4444]">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary">Generate license key</button></div>
      </form>
    </div>
  );
}

export default function Schools() {
  return <Suspense><SchoolsInner /></Suspense>;
}

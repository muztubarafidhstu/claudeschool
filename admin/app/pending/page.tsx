'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Phone, MapPin, Users, Monitor, Clock, X } from 'lucide-react';
import { api, fmtBdt, fmtDate, ProductTag, type SchoolRow } from '@/lib/api';

const PLANS = [
  { value: 'TRIAL', label: 'Free trial (14 days)', price: 0 },
  { value: 'MONTHLY', label: 'Monthly', price: 1500 },
  { value: 'YEARLY', label: 'Yearly', price: 15000 },
  { value: 'LIFETIME', label: 'Lifetime', price: 50000 },
];

export default function Pending() {
  const [rows, setRows] = useState<SchoolRow[] | null>(null);
  const [approve, setApprove] = useState<SchoolRow | null>(null);
  const load = useCallback(() => api<SchoolRow[]>('/admin/pending').then(setRows), []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  async function reject(r: SchoolRow) {
    if (!confirm(`Reject and delete the request from "${r.name}"? The app on that PC will stay locked.`)) return;
    await api(`/admin/schools/${r.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Pending requests</h1>
        <p className="text-sm text-slate-500">Schools that installed ScholarDesk Pro and asked for activation. Approve to unlock their software (it unlocks by itself within a minute).</p>
      </div>
      {rows === null && <p className="text-slate-500">Loading…</p>}
      {rows?.length === 0 && <div className="card p-10 text-center text-slate-500">No new requests. New installations appear here automatically.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows?.map((r) => (
          <div key={r.id} className="card overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
              <div>
                <div className="text-lg font-bold">{r.name}</div>
                {r.name_bn && <div className="text-slate-600">{r.name_bn}</div>}
                <div className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock size={12} /> Requested {fmtDate(r.requested_at)}</div>
              </div>
              <div className="flex flex-col items-end gap-1"><ProductTag product={r.product} /><span className="badge bg-blue-50 text-blue-600">Wants: {r.requested_plan ?? 'TRIAL'}</span></div>
            </div>
            <div className="grid gap-2 p-4 text-sm sm:grid-cols-2">
              <div><span className="text-slate-500">Contact:</span> <b>{r.contact_person ?? '—'}</b></div>
              <div className="flex items-center gap-1"><Phone size={14} className="text-slate-400" /> <a className="font-semibold text-[#0D9488]" href={`tel:${r.phone}`}>{r.phone}</a></div>
              {r.email && <div className="sm:col-span-2">Email: {r.email}</div>}
              <div className="flex items-center gap-1 sm:col-span-2"><MapPin size={14} className="text-slate-400" /> {[r.address, r.district].filter(Boolean).join(', ') || '—'}</div>
              <div className="flex items-center gap-1"><Users size={14} className="text-slate-400" /> ~{r.students_estimate ?? '?'} students</div>
              <div className="flex items-center gap-1 text-xs text-slate-500"><Monitor size={14} /> {r.machine_id} · v{r.last_app_version ?? '—'}</div>
            </div>
            <div className="flex gap-2 border-t border-slate-100 bg-slate-50 p-3">
              <button className="btn-primary flex-1" onClick={() => setApprove(r)}><CheckCircle2 size={16} /> Approve</button>
              <button className="btn-ghost flex-1 text-[#EF4444]" onClick={() => reject(r)}><XCircle size={16} /> Reject</button>
            </div>
          </div>
        ))}
      </div>
      {approve && <ApproveModal row={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); load(); }} />}
    </div>
  );
}

function ApproveModal({ row, onClose, onDone }: { row: SchoolRow; onClose: () => void; onDone: () => void }) {
  const initial = PLANS.find((p) => p.value === row.requested_plan) ?? PLANS[0];
  const [plan, setPlan] = useState(initial.value);
  const [price, setPrice] = useState(String(initial.price));
  const [validUntil, setValidUntil] = useState('');
  const [maxStudents, setMaxStudents] = useState('2000');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api(`/admin/licenses/${row.license_id}/approve`, { method: 'POST', body: JSON.stringify({ billing_cycle: plan, price_bdt: price, valid_until: validUntil || undefined, max_students: maxStudents }) });
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <form onSubmit={submit} className="card mt-10 w-full max-w-md space-y-4 p-6">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Approve {row.name}</h2><button type="button" onClick={onClose}><X /></button></div>
        <div><label className="label">Plan</label>
          <select className="input" value={plan} onChange={(e) => { setPlan(e.target.value); setPrice(String(PLANS.find((p) => p.value === e.target.value)?.price ?? 0)); }}>
            {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Price per cycle (BDT)</label><input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><label className="label">Max students</label><input className="input" type="number" value={maxStudents} onChange={(e) => setMaxStudents(e.target.value)} /></div>
        </div>
        <div><label className="label">Valid until (blank = one {plan.toLowerCase()} period)</label><input className="input" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
        <p className="text-xs text-slate-500">Price shown: {fmtBdt(price)}. You can record payments and turn the school OFF/ON later from Schools & Licenses.</p>
        {err && <p className="text-sm text-[#EF4444]">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}><CheckCircle2 size={16} /> Approve & turn ON</button></div>
      </form>
    </div>
  );
}

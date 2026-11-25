'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Power, PowerOff, RotateCcw, KeyRound, Trash2 } from 'lucide-react';
import { api, effectiveStatus, fmtBdt, fmtDate, ProductTag, type SchoolRow } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import EmergencyCode from '@/components/EmergencyCode';

function Inner() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const [d, setD] = useState<{ school: SchoolRow; payments: any[]; heartbeats: any[] } | null>(null);
  const [pay, setPay] = useState({ amount_bdt: '', method: 'bKash', transaction_ref: '', periods: '1', extend_to: '', note: '' });
  const [lic, setLic] = useState({ product: 'SCHOOL', valid_until: '', price_bdt: '', max_students: '', payment_notice: '' });
  const load = useCallback(() => api(`/admin/schools/${id}`).then((r) => {
    setD(r);
    setLic({ product: r.school.product ?? 'SCHOOL', valid_until: r.school.valid_until, price_bdt: String(r.school.price_bdt), max_students: String(r.school.max_students), payment_notice: r.school.payment_notice ?? '' });
    setPay((p) => ({ ...p, amount_bdt: String(r.school.price_bdt) }));
  }), [id]);
  useEffect(() => { if (id) load(); }, [id, load]);
  if (!d) return <p className="text-slate-500">Loading…</p>;
  const s = d.school;
  const st = effectiveStatus(s);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e: any) { alert(e.message); } };

  return (
    <div className="space-y-5">
      <Link href="/schools/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={16} /> All schools</Link>
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h1 className="text-2xl font-bold">{s.name} <StatusBadge status={st} /> <ProductTag product={s.product} /></h1>
          <p className="text-sm text-slate-500">{[s.contact_person, s.phone, s.email, s.district].filter(Boolean).join(' · ')}</p>
          <p className="mt-2 font-mono text-sm">{s.license_key}</p>
          {s.suspend_reason && st === 'SUSPENDED' && <p className="text-sm text-[#EF4444]">Reason: {s.suspend_reason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {st === 'ACTIVE'
            ? <button className="btn-danger" onClick={() => act(() => api(`/admin/licenses/${s.license_id}/status`, { method: 'POST', body: JSON.stringify({ status: 'SUSPENDED', reason: prompt('Reason:', 'Subscription payment pending') ?? undefined }) }))}><PowerOff size={16} /> Turn OFF software</button>
            : <button className="btn-primary" onClick={() => act(() => api(`/admin/licenses/${s.license_id}/status`, { method: 'POST', body: JSON.stringify({ status: 'ACTIVE' }) }))}><Power size={16} /> Activate software</button>}
          <button className="btn-ghost" onClick={() => confirm('Unbind the current PC so the school can activate on a new computer?') && act(() => api(`/admin/licenses/${s.license_id}/reset-machine`, { method: 'POST' }))}><RotateCcw size={16} /> Reset PC binding</button>
          <button className="btn-ghost" onClick={() => confirm('Issue a NEW key? The old key stops working immediately.') && act(() => api(`/admin/licenses/${s.license_id}/regenerate-key`, { method: 'POST' }))}><KeyRound size={16} /> New key</button>
          <button className="btn-ghost text-[#EF4444]" onClick={() => confirm(`Delete ${s.name} and all its records?`) && api(`/admin/schools/${s.id}`, { method: 'DELETE' }).then(() => router.replace('/schools/'))}><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); act(() => api(`/admin/licenses/${s.license_id}/payments`, { method: 'POST', body: JSON.stringify({ ...pay, extend_to: pay.extend_to || undefined }) })); }}>
          <h2 className="font-semibold">Record subscription payment</h2>
          <p className="text-xs text-slate-500">Recording a payment extends the expiry date and re-activates the school automatically on its next sync.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Amount (BDT)</label><input className="input" type="number" value={pay.amount_bdt} onChange={(e) => setPay({ ...pay, amount_bdt: e.target.value })} required /></div>
            <div><label className="label">Method</label><select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{['bKash', 'Nagad', 'Rocket', 'Bank', 'Online Gateway', 'Cash'].map((m) => <option key={m}>{m}</option>)}</select></div>
            <div><label className="label">Transaction ref</label><input className="input" value={pay.transaction_ref} onChange={(e) => setPay({ ...pay, transaction_ref: e.target.value })} /></div>
            <div><label className="label">Cycles paid ({s.billing_cycle})</label><input className="input" type="number" min={0} value={pay.periods} onChange={(e) => setPay({ ...pay, periods: e.target.value })} /></div>
            <div><label className="label">…or extend to exact date</label><input className="input" type="date" value={pay.extend_to} onChange={(e) => setPay({ ...pay, extend_to: e.target.value })} /></div>
            <div><label className="label">Note</label><input className="input" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
          </div>
          <button className="btn-primary">Save payment</button>
        </form>

        <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); act(() => api(`/admin/licenses/${s.license_id}`, { method: 'PATCH', body: JSON.stringify({ ...lic, payment_notice: lic.payment_notice || null }) })); }}>
          <h2 className="font-semibold">License settings</h2>
          <div><label className="label">Product</label>
            <div className="grid grid-cols-2 gap-2">
              {([['SCHOOL', 'School'], ['COACHING', 'Coaching centre']] as const).map(([v, l]) => (
                <button type="button" key={v} onClick={() => setLic({ ...lic, product: v })}
                  className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold ${lic.product === v ? 'border-[#0D9488] bg-teal-50 text-[#0F766E]' : 'border-slate-200 text-slate-600'}`}>{l}</button>
              ))}
            </div>
            {lic.product !== (s.product ?? 'SCHOOL') && <p className="mt-1 text-xs text-[#F59E0B]">After saving, the school’s software switches to {lic.product === 'COACHING' ? 'Coaching' : 'School'} on its next online check (or when it presses “Verify & sync”).</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Valid until</label><input className="input" type="date" value={lic.valid_until} onChange={(e) => setLic({ ...lic, valid_until: e.target.value })} /></div>
            <div><label className="label">Price (BDT)</label><input className="input" type="number" value={lic.price_bdt} onChange={(e) => setLic({ ...lic, price_bdt: e.target.value })} /></div>
            <div><label className="label">Max students</label><input className="input" type="number" value={lic.max_students} onChange={(e) => setLic({ ...lic, max_students: e.target.value })} /></div>
          </div>
          <div><label className="label">Custom notice for this school (shown in the app)</label><textarea className="input" rows={3} value={lic.payment_notice} onChange={(e) => setLic({ ...lic, payment_notice: e.target.value })} /></div>
          <div className="text-xs text-slate-500">PC: {s.machine_id ?? 'not activated'} · App v{s.last_app_version ?? '—'} · Last online {fmtDate(s.last_seen_at)}</div>
          <button className="btn-primary">Save license</button>
        </form>
      </div>

      {s.machine_id && <EmergencyCode machineId={s.machine_id} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card overflow-x-auto">
          <div className="border-b px-4 py-3 font-semibold">Payment history</div>
          <table className="w-full text-sm"><tbody>
            {d.payments.map((p) => <tr key={p.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{fmtBdt(p.amount_bdt)}</td><td className="p-3">{p.method} {p.transaction_ref && <span className="text-xs text-slate-500">({p.transaction_ref})</span>}</td><td className="p-3">→ {p.extended_to}</td><td className="p-3 text-xs">{fmtDate(p.paid_at)}</td></tr>)}
            {!d.payments.length && <tr><td className="p-4 text-slate-500">No payments.</td></tr>}
          </tbody></table>
        </div>
        <div className="card overflow-x-auto">
          <div className="border-b px-4 py-3 font-semibold">Recent heartbeats</div>
          <table className="w-full text-sm"><tbody>
            {d.heartbeats.map((h) => <tr key={h.id} className="border-t border-slate-100"><td className="p-3 text-xs">{fmtDate(h.created_at)}</td><td className="p-3"><StatusBadge status={h.result_status} /></td><td className="p-3 text-xs">v{h.app_version} · {h.student_count} students</td><td className={`p-3 text-xs ${Math.abs(h.clock_skew_sec) > 600 ? 'font-semibold text-[#EF4444]' : 'text-slate-500'}`}>skew {h.clock_skew_sec}s</td></tr>)}
            {!d.heartbeats.length && <tr><td className="p-4 text-slate-500">Never connected.</td></tr>}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

export default function SchoolView() { return <Suspense><Inner /></Suspense>; }

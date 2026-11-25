'use client';
import { useState } from 'react';
import { LifeBuoy, Copy } from 'lucide-react';
import { api } from '@/lib/api';

/** Owner tool: PC ID + Lock ID (read by the school from its lock screen) → one-time 5-day code. */
export default function EmergencyCode({ machineId = '' }: { machineId?: string | null }) {
  const [mid, setMid] = useState(machineId ?? '');
  const [lock, setLock] = useState('');
  const [out, setOut] = useState<{ code: string; school_name: string | null } | null>(null);
  const [err, setErr] = useState('');
  async function gen(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setOut(null);
    try { setOut(await api('/admin/emergency-code', { method: 'POST', body: JSON.stringify({ machine_id: mid, lock_id: lock }) })); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <form onSubmit={gen} className="card space-y-3 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><LifeBuoy size={18} className="text-[#F59E0B]" /> Emergency unlock code (5 days)</h2>
      <p className="text-xs text-slate-500">The school reads the <b>Lock ID</b> and <b>PC ID</b> from its lock screen. Each code works once, only on that PC, for that lock.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">PC ID</label><input className="input font-mono uppercase" placeholder="HW-XXXXXXXXXXXX" value={mid} onChange={(e) => setMid(e.target.value.toUpperCase())} required /></div>
        <div><label className="label">Lock ID</label><input className="input font-mono" inputMode="numeric" placeholder="1234-5678" value={lock} onChange={(e) => setLock(e.target.value)} required /></div>
      </div>
      <button className="btn-primary">Generate code</button>
      {err && <p className="text-sm text-[#EF4444]">{err}</p>}
      {out && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-4">
          <span className="font-mono text-3xl font-bold tracking-[0.25em]">{out.code}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(out.code)}><Copy size={14} /> Copy</button>
          <span className="text-xs text-slate-600">{out.school_name ? `For ${out.school_name}. ` : ''}Tell the school this code. It opens the software for 5 days.</span>
        </div>
      )}
    </form>
  );
}

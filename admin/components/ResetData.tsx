'use client';
import { useState } from 'react';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import { api, fmtDate } from '@/lib/api';

/** Remote reset of a school's app data (needs the owner password again). */
export default function ResetData({ licenseId, schoolName, pendingSince, onChange }: { licenseId: string; schoolName: string; pendingSince?: string | null; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (pendingSince) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3 border-[#F59E0B] bg-amber-50 p-5">
        <div className="flex items-start gap-2 text-sm text-amber-900"><AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span><b>Reset waiting</b> since {fmtDate(pendingSince)}. The app on that PC will save a safety backup and then erase all its data the next time it goes online.</span></div>
        <button className="btn-ghost" onClick={async () => { await api(`/admin/licenses/${licenseId}/reset-data/cancel`, { method: 'POST' }); onChange(); }}>Cancel reset</button>
      </div>
    );
  }
  return (
    <div className="card space-y-3 p-5">
      <h2 className="flex items-center gap-2 font-semibold"><RotateCcw size={18} className="text-[#EF4444]" /> Reset app data</h2>
      <p className="text-sm text-slate-600">Erases all students, fees, attendance, results, staff and settings in <b>{schoolName}</b>’s software so it starts fresh (the license stays). The app first saves a full safety backup on that PC. It happens on the app’s next online check (within about 15 minutes).</p>
      {!open ? (
        <button className="btn-ghost text-[#EF4444]" onClick={() => setOpen(true)}><RotateCcw size={16} /> Reset app data…</button>
      ) : (
        <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setErr('');
          try { await api(`/admin/licenses/${licenseId}/reset-data`, { method: 'POST', body: JSON.stringify({ password: pw }) }); setOpen(false); setPw(''); onChange(); }
          catch (e: any) { setErr(e.message); } finally { setBusy(false); }
        }}>
          <div><label className="label">Your password to confirm</label><input className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
          <button className="btn-danger" disabled={busy}><RotateCcw size={16} /> {busy ? 'Confirming…' : 'Yes, reset this school’s data'}</button>
          <button type="button" className="btn-ghost" onClick={() => { setOpen(false); setPw(''); setErr(''); }}>Cancel</button>
          {err && <p className="w-full text-sm text-[#EF4444]">{err}</p>}
        </form>
      )}
    </div>
  );
}

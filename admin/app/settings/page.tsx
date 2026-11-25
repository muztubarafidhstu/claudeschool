'use client';
import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { api } from '@/lib/api';

export default function Settings() {
  const [text, setText] = useState('');
  const [pin, setPin] = useState('');
  const [saved, setSaved] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api('/admin/settings').then((s) => { setText(s.payment_instructions ?? ''); setPin(s.emergency_pin ?? ''); }); }, []);
  const save = async (body: Record<string, string>, what: string) => {
    setErr(''); setSaved('');
    try { await api('/admin/settings', { method: 'PUT', body: JSON.stringify(body) }); setSaved(what); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="card space-y-3 p-5">
        <label className="label">Payment instructions (shown on every locked school screen)</label>
        <textarea className="input font-mono" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-primary" onClick={() => save({ payment_instructions: text }, 'instructions')}>Save</button>
        {saved === 'instructions' && <span className="ml-3 text-sm text-[#10B981]">Saved</span>}
      </div>
      <div className="card space-y-3 p-5">
        <label className="label flex items-center gap-1"><LifeBuoy size={14} /> Emergency PIN for all schools</label>
        <p className="text-sm text-slate-600">When a school is locked, tell them this PIN. It opens their software for <b>5 days</b>, once per lock; after that it needs payment and activation before the PIN works again. Schools receive a changed PIN the next time they are online.</p>
        <input className="input max-w-[200px] text-center font-mono text-2xl tracking-[0.3em]" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <div><button className="btn-primary" onClick={() => save({ emergency_pin: pin }, 'pin')}>Save PIN</button>
          {saved === 'pin' && <span className="ml-3 text-sm text-[#10B981]">Saved</span>}</div>
        <p className="text-xs text-slate-500">If one school shares the PIN with others, change it here. You can also give a one-time code for a single PC from the Emergency code page.</p>
      </div>
      {err && <p className="text-sm text-[#EF4444]">{err}</p>}
      <div className="card space-y-3 p-5">
        <label className="label">Backup</label>
        <p className="text-sm text-slate-600">Download every school, license and payment as one file. Keep a copy every month.</p>
        <button className="btn-ghost" onClick={async () => {
          const data = await api('/admin/export');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          a.download = `scholardesk-licenses-${new Date().toISOString().slice(0, 10)}.json`; a.click();
        }}>Download license backup</button>
      </div>
    </div>
  );
}

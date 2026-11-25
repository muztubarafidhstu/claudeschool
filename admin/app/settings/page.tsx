'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function Settings() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { api('/admin/settings').then((s) => setText(s.payment_instructions ?? '')); }, []);
  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="card space-y-3 p-5">
        <label className="label">Payment instructions (shown on every locked school screen)</label>
        <textarea className="input font-mono" rows={8} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} />
        <button className="btn-primary" onClick={async () => { await api('/admin/settings', { method: 'PUT', body: JSON.stringify({ payment_instructions: text }) }); setSaved(true); }}>Save</button>
        {saved && <span className="ml-3 text-sm text-[#10B981]">Saved</span>}
      </div>
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

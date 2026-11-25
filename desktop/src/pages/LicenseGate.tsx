import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { GraduationCap, KeyRound, Lock, RefreshCw, Wifi, Cpu, ShieldAlert } from 'lucide-react';
import { evaluate, syncOnline, LOCK_TEXT, type Evaluation } from '../lib/license';
import { getMachineId } from '../lib/platform';

const HEARTBEAT_MS = 15 * 60_000;  // online heartbeat (owner's ON/OFF switch takes effect within 15 min)
const EVAL_MS = 60_000;            // offline re-evaluation (clock / grace expiry)

/** Wraps the whole app. Nothing inside renders unless the license evaluates as unlocked. */
export default function LicenseGate({ children, onBanner }: { children: ReactNode; onBanner: (b: Evaluation | null) => void }) {
  const [ev, setEv] = useState<Evaluation | null>(null);
  const refresh = useCallback(async () => { const e = await evaluate(); setEv(e); onBanner(e); return e; }, [onBanner]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const first = await refresh();
      if (first.state?.license_key) { await syncOnline(); if (alive) await refresh(); }
    })();
    const a = setInterval(refresh, EVAL_MS);
    const b = setInterval(async () => { await syncOnline(); await refresh(); }, HEARTBEAT_MS);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, [refresh]);

  if (!ev) return <Splash />;
  if (!ev.locked) return <>{children}</>;
  if (ev.reason === 'NEEDS_ACTIVATION') return <Activation onDone={refresh} />;
  return <LockScreen ev={ev} onRetry={refresh} />;
}

function Splash() {
  return <div className="grid h-full place-items-center bg-navy text-white"><div className="flex items-center gap-3 text-xl font-semibold"><GraduationCap className="text-brand" size={32} /> ScholarDesk Pro</div></div>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-navy bg-[radial-gradient(ellipse_at_top,_#134e4a_0%,_#0F172A_60%)] p-6">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center justify-center gap-3 text-2xl font-bold text-white"><GraduationCap className="text-brand" size={36} /> ScholarDesk <span className="text-brand">Pro</span></div>
        {children}
      </div>
    </div>
  );
}

function Activation({ onDone }: { onDone: () => Promise<Evaluation> }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mid, setMid] = useState('');
  useEffect(() => { getMachineId().then(setMid); }, []);
  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await syncOnline(key);
    setBusy(false);
    if (r.ok) await onDone(); else setErr(r.message || `Activation failed (${r.status ?? 'network'})`);
  }
  return (
    <Shell>
      <form onSubmit={activate} className="card space-y-4 p-7">
        <div><h1 className="text-xl font-bold">Activate this PC</h1><p className="text-sm text-slate-500">{LOCK_TEXT.NEEDS_ACTIVATION.body} An internet connection is required once for activation.</p></div>
        <label className="block"><span className="label">School License Key</span>
          <input className="input font-mono text-lg uppercase tracking-wider" placeholder="SCH-2026-XXXX-XXXX" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} required autoFocus /></label>
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500"><Cpu size={14} /> This PC’s hardware ID: <b className="font-mono text-slate-700">{mid}</b></div>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{err}</p>}
        <button className="btn-primary w-full py-3" disabled={busy}><KeyRound size={18} /> {busy ? 'Verifying with license server…' : 'Activate License'}</button>
      </form>
    </Shell>
  );
}

function LockScreen({ ev, onRetry }: { ev: Evaluation; onRetry: () => Promise<Evaluation> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const text = LOCK_TEXT[ev.reason!];
  const st = ev.state!;
  async function verify() {
    setBusy(true); setMsg('');
    const r = await syncOnline();
    const e = await onRetry();
    setBusy(false);
    if (e.locked) setMsg(r.ok ? 'Verified online, but this PC’s clock is still wrong. Please correct the date & time.' : r.message || `Status: ${r.status ?? 'offline'}`);
  }
  const instructions = st.payment_notice && ev.reason !== 'OFFLINE_TOO_LONG' && ev.reason !== 'CLOCK_TAMPER' ? st.payment_notice : st.payment_instructions;
  return (
    <Shell>
      <div className="card overflow-hidden">
        <div className={`flex items-center gap-3 px-6 py-4 text-white ${ev.reason === 'OFFLINE_TOO_LONG' ? 'bg-due' : 'bg-bad'}`}>
          {ev.reason === 'OFFLINE_TOO_LONG' ? <Wifi /> : ev.reason === 'CLOCK_TAMPER' ? <ShieldAlert /> : <Lock />}
          <h1 className="text-lg font-bold">{text.title}</h1>
        </div>
        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-600">{text.body}</p>
          {instructions && (
            <div className="rounded-lg border border-line bg-slate-50 p-4">
              <div className="label">Payment instructions</div>
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800">{instructions}</pre>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div className="rounded-lg bg-slate-50 px-3 py-2">License: <b className="font-mono text-slate-700">{st.license_key}</b></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">PC ID: <b className="font-mono text-slate-700">{st.machine_id}</b></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">School: <b className="text-slate-700">{st.school_name ?? '—'}</b></div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">Valid until: <b className="text-slate-700">{st.valid_until ?? '—'}</b></div>
          </div>
          {msg && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{msg}</p>}
          <button className="btn-primary w-full py-3 text-base" onClick={verify} disabled={busy}><RefreshCw size={18} className={busy ? 'animate-spin' : ''} /> {busy ? 'Contacting license server…' : 'Verify Payment & Sync Online Now'}</button>
          <p className="text-center text-xs text-slate-400">Your school data is safe on this PC. It unlocks immediately after successful verification.</p>
        </div>
      </div>
    </Shell>
  );
}

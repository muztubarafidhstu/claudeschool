import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { GraduationCap, KeyRound, Lock, RefreshCw, Wifi, Cpu, ShieldAlert, Send, Hourglass, School, LifeBuoy } from 'lucide-react';
import { applyEmergencyCode, currentLockId, emergencyAvailable, evaluate, requestActivation, syncOnline, EMERGENCY_DAYS, LOCK_TEXT, type Evaluation, type RegistrationForm } from '../lib/license';
import { getConfig } from '../lib/config';
import { getMachineId } from '../lib/platform';

const HEARTBEAT_MS = 15 * 60_000;  // online heartbeat (owner's ON/OFF switch takes effect within 15 min)
const EVAL_MS = 60_000;            // offline re-evaluation (clock / grace expiry)

/** Wraps the whole app. Nothing inside renders unless the license evaluates as unlocked. */
/**
 * PREVIEW builds (VITE_PREVIEW_BUILD=1, set only by the preview CI workflow) skip licensing so the
 * installer can be tried before the license server is deployed. Production builds never set it.
 */
export const PREVIEW_BUILD = import.meta.env.VITE_PREVIEW_BUILD === '1';

export default function LicenseGate(props: { children: ReactNode; onBanner: (b: Evaluation | null) => void }) {
  if (PREVIEW_BUILD) {
    return (
      <div className="flex h-full flex-col">
        <div className="bg-due px-4 py-1 text-center text-xs font-semibold text-white">PREVIEW BUILD — license checks disabled. Not for sale.</div>
        <div className="min-h-0 flex-1">{props.children}</div>
      </div>
    );
  }
  return <LicensedGate {...props} />;
}

function LicensedGate({ children, onBanner }: { children: ReactNode; onBanner: (b: Evaluation | null) => void }) {
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
  if (ev.reason === 'PENDING') return <PendingScreen ev={ev} onRetry={refresh} />;
  return <LockScreen ev={ev} onRetry={refresh} />;
}

/** Lock ID + emergency code entry (owner generates the code in the web panel). */
function EmergencyBox({ ev, onDone }: { ev: Evaluation | null; onDone: () => Promise<Evaluation> }) {
  const [avail, setAvail] = useState(false);
  const [open, setOpen] = useState(false);
  const [lockId, setLockId] = useState('');
  const [mid, setMid] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { emergencyAvailable().then(setAvail); currentLockId(ev?.state ?? null).then(setLockId); getMachineId().then(setMid); }, [ev]);
  if (!avail) return null;
  async function apply(e: React.FormEvent) {
    e.preventDefault();
    const r = await applyEmergencyCode(code);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setTimeout(() => void onDone(), 700);
  }
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-4">
      {!open ? (
        <button className="flex w-full items-center justify-center gap-2 text-sm font-medium text-slate-600 hover:text-brand" onClick={() => setOpen(true)}><LifeBuoy size={16} /> Emergency access ({EMERGENCY_DAYS} days)</button>
      ) : (
        <form onSubmit={apply} className="space-y-3">
          <p className="text-sm text-slate-600">Call your software provider and tell them this <b>Lock ID</b> and <b>PC ID</b>. They will give you a one-time code that opens the software for {EMERGENCY_DAYS} days.</p>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-500">Lock ID</div><div className="font-mono text-lg font-bold tracking-wider">{lockId}</div></div>
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-[10px] uppercase text-slate-500">PC ID</div><div className="font-mono text-sm font-bold">{mid}</div></div>
          </div>
          <input className="input text-center font-mono text-lg uppercase tracking-[0.3em]" maxLength={9} placeholder="XXXXXXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-ok' : 'bg-red-50 text-bad'}`}>{msg.text}</p>}
          <button className="btn-ghost w-full" disabled={code.replace(/\W/g, '').length < 8}><LifeBuoy size={16} /> Unlock with emergency code</button>
        </form>
      )}
    </div>
  );
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
  const [mode, setMode] = useState<'request' | 'key'>('request');
  const [mid, setMid] = useState('');
  useEffect(() => { getMachineId().then(setMid); }, []);
  return (
    <Shell>
      <div className="card overflow-hidden">
        <div className="grid grid-cols-2 border-b border-line text-sm font-semibold">
          <button className={`flex items-center justify-center gap-2 py-3 ${mode === 'request' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setMode('request')}><School size={16} /> New school — request activation</button>
          <button className={`flex items-center justify-center gap-2 py-3 ${mode === 'key' ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setMode('key')}><KeyRound size={16} /> I have a license key</button>
        </div>
        {mode === 'request' ? <RequestForm onDone={onDone} /> : <KeyForm onDone={onDone} />}
        <div className="flex items-center gap-2 border-t border-line bg-slate-50 px-6 py-2 text-xs text-slate-500"><Cpu size={14} /> This PC’s hardware ID: <b className="font-mono text-slate-700">{mid}</b></div>
      </div>
      <div className="mt-4 rounded-xl bg-white/95"><EmergencyBox ev={null} onDone={onDone} /></div>
    </Shell>
  );
}

function KeyForm({ onDone }: { onDone: () => Promise<Evaluation> }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function activate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await syncOnline(key);
    setBusy(false);
    if (r.ok || r.status === 'PENDING') await onDone(); else setErr(r.message || `Activation failed (${r.status ?? 'network'})`);
  }
  return (
    <form onSubmit={activate} className="space-y-4 p-6">
      <p className="text-sm text-slate-500">{LOCK_TEXT.NEEDS_ACTIVATION.body} An internet connection is required once for activation.</p>
      <label className="block"><span className="label">School License Key</span>
        <input className="input font-mono text-lg uppercase tracking-wider" placeholder="SCH-2026-XXXX-XXXX" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} required autoFocus /></label>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad">{err}</p>}
      <button className="btn-primary w-full py-3" disabled={busy}><KeyRound size={18} /> {busy ? 'Verifying with license server…' : 'Activate License'}</button>
    </form>
  );
}

function RequestForm({ onDone }: { onDone: () => Promise<Evaluation> }) {
  const [f, setF] = useState<RegistrationForm>({ product: 'SCHOOL', school_name: '', school_name_bn: '', contact_person: '', phone: '', email: '', address: '', district: '', students_estimate: null, requested_plan: 'TRIAL' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends keyof RegistrationForm>(k: K, v: RegistrationForm[K]) => setF((p) => ({ ...p, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^01\d{9}$/.test(f.phone)) return setErr('Mobile number must be 11 digits starting with 01.');
    setBusy(true); setErr('');
    const r = await requestActivation(f);
    setBusy(false);
    if (r.ok || r.status === 'PENDING') await onDone(); else setErr(r.message || 'Request failed');
  }
  return (
    <form onSubmit={submit} className="grid gap-3 p-6 sm:grid-cols-2">
      <p className="text-sm text-slate-500 sm:col-span-2">Fill in your school’s details. Your request goes to the software provider; the software unlocks automatically when it is approved.</p>
      <div className="grid grid-cols-2 gap-2 sm:col-span-2">
        {([['SCHOOL', 'School'], ['COACHING', 'Coaching centre']] as const).map(([v, l]) => (
          <button type="button" key={v} onClick={() => set('product', v)} className={`rounded-lg border-2 px-3 py-2.5 text-sm font-semibold ${f.product === v ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line text-slate-600 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>
      <label className="block sm:col-span-2"><span className="label">{f.product === 'COACHING' ? 'Coaching centre' : 'School'} name (English) *</span><input className="input" value={f.school_name} onChange={(e) => set('school_name', e.target.value)} required minLength={2} autoFocus /></label>
      <label className="block sm:col-span-2"><span className="label">{f.product === 'COACHING' ? 'কোচিং সেন্টারের নাম (বাংলা)' : 'বিদ্যালয়ের নাম (বাংলা)'}</span><input className="input bn" value={f.school_name_bn} onChange={(e) => set('school_name_bn', e.target.value)} /></label>
      <label className="block"><span className="label">Contact person *</span><input className="input" placeholder="Principal / owner" value={f.contact_person} onChange={(e) => set('contact_person', e.target.value)} required minLength={2} /></label>
      <label className="block"><span className="label">Mobile *</span><input className="input" inputMode="tel" placeholder="01XXXXXXXXX" value={f.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 11))} required /></label>
      <label className="block"><span className="label">Email</span><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
      <label className="block"><span className="label">District</span><input className="input" value={f.district} onChange={(e) => set('district', e.target.value)} /></label>
      <label className="block sm:col-span-2"><span className="label">Address</span><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></label>
      <label className="block"><span className="label">Approx. students</span><input className="input" type="number" min={0} value={f.students_estimate ?? ''} onChange={(e) => set('students_estimate', e.target.value ? Number(e.target.value) : null)} /></label>
      <label className="block"><span className="label">Plan wanted</span>
        <select className="input" value={f.requested_plan} onChange={(e) => set('requested_plan', e.target.value as RegistrationForm['requested_plan'])}>
          <option value="TRIAL">Free trial</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option>
        </select></label>
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad sm:col-span-2">{err}</p>}
      <button className="btn-primary py-3 sm:col-span-2" disabled={busy}><Send size={18} /> {busy ? 'Sending request…' : 'Send activation request'}</button>
    </form>
  );
}

function PendingScreen({ ev, onRetry }: { ev: Evaluation; onRetry: () => Promise<Evaluation> }) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Date | null>(null);
  const [reg, setReg] = useState<RegistrationForm | null>(null);
  const check = useCallback(async () => { setBusy(true); await syncOnline(); await onRetry(); setChecked(new Date()); setBusy(false); }, [onRetry]);
  useEffect(() => { getConfig<RegistrationForm | null>('registration', null).then(setReg); }, []);
  useEffect(() => { const t = setInterval(check, 60_000); return () => clearInterval(t); }, [check]); // auto-unlock after approval
  const st = ev.state!;
  return (
    <Shell>
      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 bg-blue-600 px-6 py-4 text-white"><Hourglass /><h1 className="text-lg font-bold">{LOCK_TEXT.PENDING.title}</h1></div>
        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-600">{LOCK_TEXT.PENDING.body}</p>
          <div className="space-y-1 rounded-lg bg-slate-50 p-4 text-sm">
            <div><span className="text-slate-500">School:</span> <b>{st.school_name ?? reg?.school_name}</b></div>
            {reg && <div><span className="text-slate-500">Contact:</span> {reg.contact_person} · {reg.phone}</div>}
            <div className="text-xs text-slate-500">Request ID: <span className="font-mono">{st.license_key}</span> · PC: <span className="font-mono">{st.machine_id}</span></div>
          </div>
          {st.payment_instructions && <div className="rounded-lg border border-line p-4"><div className="label">Payment / contact</div><pre className="whitespace-pre-wrap font-sans text-sm">{st.payment_instructions}</pre></div>}
          <button className="btn-primary w-full py-3" onClick={check} disabled={busy}><RefreshCw size={18} className={busy ? 'animate-spin' : ''} /> {busy ? 'Checking…' : 'Check approval now'}</button>
          <p className="text-center text-xs text-slate-400">Checks automatically every minute{checked ? ` · last checked ${checked.toLocaleTimeString()}` : ''}.</p>
          <EmergencyBox ev={ev} onDone={onRetry} />
        </div>
      </div>
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
          <EmergencyBox ev={ev} onDone={onRetry} />
        </div>
      </div>
    </Shell>
  );
}

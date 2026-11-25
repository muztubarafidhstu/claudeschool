import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, GraduationCap } from 'lucide-react';
import { useApp } from './AppContext';
import { checkPin } from '../lib/pin';

const KEY = 'sd_screen_locked';
const isLockedStored = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const storeLocked = (v: boolean) => { try { v ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch { /* private mode */ } };

/**
 * Locks the screen after N minutes without mouse / keyboard / touch activity.
 * Unlock needs the Screen lock PIN (default 1234, change it in Settings → PINs & License).
 * The lock survives an app restart, so closing the app does not bypass it.
 */
export default function ScreenLock() {
  const { settings } = useApp();
  const { enabled, minutes } = settings.screenLock;
  const [locked, setLocked] = useState(() => enabled && isLockedStored());
  const last = useRef(Date.now());

  const lock = useCallback(() => { setLocked(true); storeLocked(true); }, []);

  useEffect(() => {
    if (!enabled) { setLocked(false); storeLocked(false); return; }
    const bump = () => { last.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }));
    const t = setInterval(() => { if (!locked && Date.now() - last.current >= minutes * 60_000) lock(); }, 5000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump, { capture: true })); clearInterval(t); };
  }, [enabled, minutes, locked, lock]);

  if (!locked) return null;
  return createPortal(<LockOverlay school={settings.school.name} onUnlock={() => { last.current = Date.now(); storeLocked(false); setLocked(false); }} />, document.body);
}

function LockOverlay({ school, onUnlock }: { school: string; onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  async function tryPin(v: string) {
    if (await checkPin('screen', v)) onUnlock();
    else { setErr('Wrong PIN'); setPin(''); }
  }
  return (
    <div className="no-print fixed inset-0 z-[1000] grid place-items-center bg-navy/95 backdrop-blur-md">
      <div className="w-full max-w-xs text-center text-white">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-brand"><GraduationCap size={34} /></div>
        <div className="text-lg font-semibold">{school || 'ScholarDesk Pro'}</div>
        <div className="mb-6 flex items-center justify-center gap-1 text-sm text-slate-400"><Lock size={14} /> Screen locked</div>
        <input ref={ref} type="password" inputMode="numeric" maxLength={6} value={pin} placeholder="Enter PIN"
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setPin(v); setErr(''); if (v.length >= 4) void checkPin('screen', v).then((ok) => ok && onUnlock()); }}
          onKeyDown={(e) => e.key === 'Enter' && tryPin(pin)}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-center text-3xl tracking-[0.6em] text-white outline-none placeholder:text-base placeholder:tracking-normal placeholder:text-slate-400 focus:border-brand" />
        {err && <p className="mt-2 text-sm font-medium text-red-300">{err}</p>}
        <button className="btn-primary mt-4 w-full" onClick={() => tryPin(pin)}>Unlock</button>
      </div>
    </div>
  );
}

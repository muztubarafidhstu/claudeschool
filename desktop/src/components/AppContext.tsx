import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { loadSettings, saveSettings, type AppSettings } from '../lib/config';
import { checkPin, type PinKind } from '../lib/pin';
import { translate, type TKey } from '../lib/i18n';
import { Modal } from './ui';

interface Toast { id: number; kind: 'ok' | 'err'; text: string }
interface Ctx {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  replaceSettings: (s: AppSettings) => void;
  t: (k: TKey) => string;
  requirePin: (kind: PinKind, reason: string) => Promise<boolean>;
  toast: (text: string, kind?: 'ok' | 'err') => void;
  openStudent: (id: number) => void;
  openStudentId: number | null;
  closeStudent: () => void;
  dataVersion: number;
  bump: () => void;
  /** Jump to a page, optionally with a student pre-selected (used by the profile action buttons). */
  navigate: (page: string, studentId?: number) => void;
  setNavigator: (fn: (page: string, studentId?: number) => void) => void;
  settingsUnlocked: boolean;
  setSettingsUnlocked: (v: boolean) => void;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [openStudentId, setOpenStudentId] = useState<number | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  const navRef = useRef<(page: string, studentId?: number) => void>(() => {});
  const [pin, setPin] = useState<{ kind: PinKind; reason: string; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => { loadSettings().then(setSettings); }, []);

  const update = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...(prev as AppSettings), ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const requirePin = useCallback((kind: PinKind, reason: string) => new Promise<boolean>((resolve) => setPin({ kind, reason, resolve })), []);

  if (!settings) return <div className="grid h-full place-items-center text-slate-400">Loading…</div>;
  const lang = settings.lang;

  return (
    <AppCtx.Provider value={{
      settings, update, replaceSettings: setSettings, t: (k) => translate(lang, k), requirePin, toast,
      openStudent: setOpenStudentId, openStudentId, closeStudent: () => setOpenStudentId(null),
      dataVersion, bump: () => setDataVersion((v) => v + 1), settingsUnlocked, setSettingsUnlocked,
      navigate: (p, id) => { setOpenStudentId(null); navRef.current(p, id); }, setNavigator: (fn) => { navRef.current = fn; },
    }}>
      {children}
      {pin && <PinDialog kind={pin.kind} reason={pin.reason} onDone={(ok) => { pin.resolve(ok); setPin(null); }} />}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${t.kind === 'ok' ? 'bg-navy' : 'bg-bad'}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={18} className="shrink-0 text-ok" /> : <AlertTriangle size={18} className="shrink-0" />} {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

function PinDialog({ kind, reason, onDone }: { kind: PinKind; reason: string; onDone: (ok: boolean) => void }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  async function submit(v = value) {
    if (await checkPin(kind, v)) onDone(true);
    else { setErr('Incorrect PIN'); setValue(''); }
  }
  return (
    <Modal open onClose={() => onDone(false)} width="max-w-sm" title={<span className="flex items-center gap-2"><ShieldCheck size={18} /> {kind === 'settings' ? 'Settings PIN' : 'Modify / Delete PIN'}</span>}>
      <p className="mb-4 text-sm text-slate-600">{reason}</p>
      <input ref={ref} type="password" inputMode="numeric" maxLength={4} value={value}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setValue(v); setErr(''); if (v.length === 4) void submit(v); }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="input text-center text-3xl tracking-[0.8em]" placeholder="••••" />
      {err && <p className="mt-2 text-center text-sm font-medium text-bad">{err}</p>}
      <div className="mt-4 flex justify-end gap-2"><button className="btn-ghost" onClick={() => onDone(false)}>Cancel</button><button className="btn-primary" onClick={() => submit()}>Confirm</button></div>
    </Modal>
  );
}

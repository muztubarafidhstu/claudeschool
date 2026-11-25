import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { clsx } from '../lib/util';

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, width = 'max-w-3xl', footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/60 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx('card mt-8 w-full shadow-2xl', width)}>
        <header className="flex items-center justify-between rounded-t-xl border-b border-line bg-navy px-5 py-3 text-white">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-white/10" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="max-h-[78vh] overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Kpi({ label, value, icon, tone = 'brand', sub }: { label: string; value: ReactNode; icon: ReactNode; tone?: 'brand' | 'ok' | 'bad' | 'due' | 'slate'; sub?: ReactNode }) {
  const tones = { brand: 'bg-brand-soft text-brand-dark', ok: 'bg-emerald-50 text-ok', bad: 'bg-red-50 text-bad', due: 'bg-amber-50 text-due', slate: 'bg-slate-100 text-slate-600' };
  return (
    <div className="card flex items-center gap-4 p-4">
      <div className={clsx('grid h-11 w-11 shrink-0 place-items-center rounded-lg', tones[tone])}>{icon}</div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-slate-500">{label}</div>
        <div className="text-xl font-bold text-slate-900">{value}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'bad' | 'due' | 'slate' | 'brand'; children: ReactNode }) {
  const t = { ok: 'bg-emerald-50 text-ok', bad: 'bg-red-50 text-bad', due: 'bg-amber-50 text-due', slate: 'bg-slate-100 text-slate-600', brand: 'bg-brand-soft text-brand-dark' };
  return <span className={clsx('badge', t[tone])}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-10 text-center text-sm text-slate-400">{children}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-white p-1">
      {items.map((i) => <button key={i.value} className={clsx('tab', value === i.value && 'tab-active')} onClick={() => onChange(i.value)}>{i.label}</button>)}
    </div>
  );
}

export function Switch({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 rounded-lg border border-line bg-white px-4 py-3 text-left hover:bg-slate-50">
      <span><span className="block text-sm font-semibold">{label}</span>{desc && <span className="block text-xs text-slate-500">{desc}</span>}</span>
      <span className={clsx('relative h-6 w-11 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-slate-300')}>
        <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  );
}

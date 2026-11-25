import { useEffect, useState, type ReactNode } from 'react';
import { LayoutDashboard, UserPlus, Users, CalendarCheck, GraduationCap, Wallet, BadgeDollarSign, CloudUpload, Settings, Search, Languages, AlertTriangle, WifiOff } from 'lucide-react';
import { useApp } from './AppContext';
import type { TKey } from '../lib/i18n';
import type { Modules } from '../lib/config';
import type { Evaluation } from '../lib/license';
import StudentSearch from './StudentSearch';
import { Modal } from './ui';
import { clsx } from '../lib/util';

export type Page = 'dashboard' | 'admission' | 'students' | 'attendance' | 'exams' | 'fees' | 'staff' | 'backup' | 'settings';

const NAV: { page: Page; key: TKey; icon: typeof Users; module?: keyof Modules }[] = [
  { page: 'dashboard', key: 'dashboard', icon: LayoutDashboard },
  { page: 'admission', key: 'admission', icon: UserPlus },
  { page: 'students', key: 'students', icon: Users },
  { page: 'attendance', key: 'attendance', icon: CalendarCheck, module: 'attendance' },
  { page: 'exams', key: 'exams', icon: GraduationCap, module: 'exams' },
  { page: 'fees', key: 'fees', icon: Wallet, module: 'fees' },
  { page: 'staff', key: 'staff', icon: BadgeDollarSign, module: 'payroll' },
  { page: 'backup', key: 'backup', icon: CloudUpload },
  { page: 'settings', key: 'settings', icon: Settings },
];

export const isPageEnabled = (p: Page, m: Modules) => { const n = NAV.find((x) => x.page === p); return !n?.module || m[n.module]; };

export default function Layout({ page, setPage, banner, children }: { page: Page; setPage: (p: Page) => void; banner: Evaluation | null; children: ReactNode }) {
  const { settings, t, update, openStudent } = useApp();
  const [omni, setOmni] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOmni(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const items = NAV.filter((n) => !n.module || settings.modules[n.module]);
  const warnOffline = banner && !banner.locked && (banner.daysLeftOffline ?? 7) <= 3;
  const warnExpiry = banner && !banner.locked && banner.daysToExpiry !== undefined && banner.daysToExpiry <= 7;

  return (
    <div className="flex h-full">
      <aside className="flex w-64 shrink-0 flex-col bg-navy text-white">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand"><GraduationCap size={20} /></div>
          <div className="leading-tight"><div className="font-bold">ScholarDesk <span className="text-brand">Pro</span></div><div className="max-w-[150px] truncate text-[11px] text-slate-400">{settings.school.name || 'School Management'}</div></div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
          {items.map(({ page: p, key, icon: Icon }) => (
            <button key={p} onClick={() => setPage(p)} className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition', page === p ? 'bg-brand font-semibold text-white shadow' : 'text-slate-300 hover:bg-white/5 hover:text-white', settings.lang === 'bn' && 'bn')}>
              <Icon size={18} /> {t(key)}
            </button>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-3 text-[11px] text-slate-500">v1.0.0 · Academic Year {settings.academicYear}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-white px-6 py-3">
          <button onClick={() => setOmni(true)} className="flex w-full max-w-lg items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-slate-400 hover:border-brand">
            <Search size={16} /> <span className={settings.lang === 'bn' ? 'bn' : ''}>{t('search')}</span>
            <kbd className="ml-auto rounded border border-line bg-white px-1.5 text-[10px] font-semibold text-slate-500">Ctrl K</kbd>
          </button>
          <div className="flex-1" />
          <button className="btn-ghost btn-sm" onClick={() => update({ lang: settings.lang === 'en' ? 'bn' : 'en' })}><Languages size={14} /> {settings.lang === 'en' ? 'বাংলা' : 'English'}</button>
        </header>
        {(warnOffline || warnExpiry) && (
          <div className="flex items-center gap-2 bg-amber-50 px-6 py-2 text-sm text-amber-800">
            {warnOffline ? <WifiOff size={16} /> : <AlertTriangle size={16} />}
            {warnOffline ? `Connect to the internet soon — offline grace ends in ${banner!.daysLeftOffline} day(s).` : `Subscription ends in ${banner!.daysToExpiry} day(s) (${banner!.state?.valid_until}). Please renew to avoid interruption.`}
            {banner?.state?.payment_notice && <span className="ml-2 text-amber-700">{banner.state.payment_notice}</span>}
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <Modal open={omni} onClose={() => setOmni(false)} title="Find a student — ID, Roll or Guardian Mobile" width="max-w-2xl">
        <div className="min-h-[300px]">
          <StudentSearch autoFocus onPick={(s) => { setOmni(false); openStudent(s.id); }} />
          <p className="mt-3 text-xs text-slate-400">Tip: type a Student ID like <b>260901</b>, a roll like <b>12</b>, or a mobile number like <b>017…</b>. Profiles open with personal info and fee history first; results are shown only on request.</p>
        </div>
      </Modal>
    </div>
  );
}

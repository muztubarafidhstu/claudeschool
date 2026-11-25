'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, School, Receipt, Settings, LogOut, GraduationCap, Menu } from 'lucide-react';
import { getToken, setToken } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/schools/', label: 'Schools & Licenses', icon: School },
  { href: '/payments/', label: 'Payments', icon: Receipt },
  { href: '/settings/', label: 'Settings', icon: Settings },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const isLogin = path.startsWith('/login');

  useEffect(() => {
    if (!isLogin && !getToken()) router.replace('/login/');
    else setReady(true);
  }, [isLogin, router]);

  if (isLogin) return <>{children}</>;
  if (!ready) return null;

  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center justify-between bg-[#0F172A] px-4 py-3 text-white md:hidden">
        <span className="flex items-center gap-2 font-semibold"><GraduationCap size={20} className="text-teal-400" /> ScholarDesk Admin</span>
        <button onClick={() => setOpen(!open)} aria-label="Menu"><Menu /></button>
      </header>
      <aside className={`${open ? 'block' : 'hidden'} w-full bg-[#0F172A] text-white md:block md:min-h-screen md:w-64 md:shrink-0`}>
        <div className="hidden items-center gap-2 px-5 py-5 text-lg font-semibold md:flex">
          <GraduationCap className="text-teal-400" /> ScholarDesk <span className="text-teal-400">Admin</span>
        </div>
        <nav className="space-y-1 px-3 pb-4">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? path === '/' : path.startsWith(href);
            return (
              <Link key={href} href={href} onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? 'bg-[#0D9488] text-white' : 'text-slate-300 hover:bg-white/5'}`}>
                <Icon size={18} /> {label}
              </Link>
            );
          })}
          <button onClick={() => { setToken(null); router.replace('/login/'); }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 hover:bg-white/5">
            <LogOut size={18} /> Sign out
          </button>
        </nav>
      </aside>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}

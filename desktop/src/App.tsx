import { useCallback, useEffect, useState } from 'react';
import { AppProvider, useApp } from './components/AppContext';
import Layout, { isPageEnabled, type Page } from './components/Layout';
import StudentProfile from './components/StudentProfile';
import ScreenLock from './components/ScreenLock';
import LicenseGate from './pages/LicenseGate';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Admission from './pages/Admission';
import Students from './pages/Students';
import Attendance from './pages/Attendance';
import Exams from './pages/Exams';
import CoachingExams from './pages/CoachingExams';
import { isCoaching } from './lib/groups';
import { getConfig, setConfig } from './lib/config';
import Fees from './pages/Fees';
import Staff from './pages/Staff';
import Backup from './pages/Backup';
import SettingsPage from './pages/Settings';
import type { Evaluation } from './lib/license';
import { checkForUpdates } from './lib/updater';
import { dailyCloudIfNeeded, dailyLocalIfNeeded } from './lib/autobackup';
import { DatabaseBackup } from 'lucide-react';

function Main({ banner }: { banner: Evaluation | null }) {
  const { settings, setSettingsUnlocked, setNavigator } = useApp();
  const [page, setPageRaw] = useState<Page>('dashboard');
  const [editId, setEditId] = useState<number | null>(null);
  const [focusStudent, setFocusStudent] = useState<{ id: number; n: number } | null>(null);
  const setPage = (p: Page) => { if (p !== 'settings') setSettingsUnlocked(false); setEditId(null); setFocusStudent(null); setPageRaw(p); };
  // Profile action buttons: navigate('fees' | 'exams' | 'edit-student', studentId)
  useEffect(() => setNavigator((p, id) => {
    setSettingsUnlocked(false);
    if (p === 'edit-student') { setEditId(id ?? null); setPageRaw('admission'); return; }
    setEditId(null);
    setFocusStudent(id ? { id, n: Date.now() } : null);
    setPageRaw(p as Page);
  }), [setNavigator, setSettingsUnlocked]);
  // Dynamic UI pruning: if the current page's module gets switched off, fall back to the dashboard.
  useEffect(() => { if (!isPageEnabled(page, settings.modules)) setPageRaw('dashboard'); }, [settings.modules, page]);
  useEffect(() => { void checkForUpdates(); }, []);
  // Name / logo typed on the key screen (e.g. after a reinstall that kept the data) are applied once.
  useEffect(() => {
    if (!settings.onboarded) return;
    void getConfig<{ name?: string; name_bn?: string; logo?: string | null } | null>('pending_profile', null).then(async (p) => {
      if (!p) return;
      await update({ school: { ...settings.school, name: p.name || settings.school.name, name_bn: p.name_bn || settings.school.name_bn, logo: p.logo ?? settings.school.logo } });
      await setConfig('pending_profile', null);
    });
  }, [settings.onboarded]); // eslint-disable-line
  // The license decides School vs Coaching (switch in the owner panel or by entering another key).
  const { update } = useApp();
  const licProduct = banner?.state?.product;
  useEffect(() => { if (licProduct && licProduct !== settings.product) void update({ product: licProduct }); }, [licProduct]); // eslint-disable-line

  // First start of the day: local backup BEFORE the app opens; cloud backups afterwards in the background.
  const [bootBackup, setBootBackup] = useState<'checking' | 'running' | 'done'>('checking');
  const { toast } = useApp();
  useEffect(() => {
    if (!settings.onboarded) { setBootBackup('done'); return; }
    let alive = true;
    const t = setTimeout(() => alive && setBootBackup((b) => (b === 'checking' ? 'running' : b)), 300);
    dailyLocalIfNeeded(settings).then((r) => {
      clearTimeout(t);
      if (!alive) return;
      if (r !== 'done' && r !== 'skipped') toast(`Daily backup failed: ${r}`, 'err');
      setBootBackup('done');
    });
    const cloud = () => void dailyCloudIfNeeded(settings).catch(() => null);
    const c1 = setTimeout(cloud, 20_000);
    const c2 = setInterval(cloud, 60 * 60_000);
    return () => { alive = false; clearTimeout(t); clearTimeout(c1); clearInterval(c2); };
  }, [settings.onboarded]); // eslint-disable-line

  if (!settings.onboarded) return <Onboarding />;
  if (bootBackup !== 'done') {
    return (
      <div className="grid h-full place-items-center bg-canvas">
        {bootBackup === 'running' && (
          <div className="card flex items-center gap-4 px-8 py-6">
            <DatabaseBackup className="animate-pulse text-brand" size={32} />
            <div><div className="font-semibold">Making today’s backup…</div><div className="text-sm text-slate-500">This happens once a day and takes a few seconds.</div></div>
          </div>
        )}
      </div>
    );
  }
  return (
    <Layout page={page} setPage={setPage} banner={banner}>
      {page === 'dashboard' && <Dashboard go={setPage} />}
      {page === 'admission' && <Admission key={editId ?? 'new'} editId={editId} onDone={() => setPage('students')} />}
      {page === 'students' && <Students onEdit={(id) => { setEditId(id); setPageRaw('admission'); }} />}
      {page === 'attendance' && <Attendance />}
      {page === 'exams' && (isCoaching(settings) ? <CoachingExams /> : <Exams focus={focusStudent} />)}
      {page === 'fees' && <Fees focus={focusStudent} />}
      {page === 'staff' && <Staff />}
      {page === 'backup' && <Backup />}
      {page === 'settings' && <SettingsPage />}
      <StudentProfile />
      <ScreenLock />
    </Layout>
  );
}

export default function App() {
  const [banner, setBanner] = useState<Evaluation | null>(null);
  const onBanner = useCallback((b: Evaluation | null) => setBanner(b), []);
  return (
    <AppProvider>
      <LicenseGate onBanner={onBanner}><Main banner={banner} /></LicenseGate>
    </AppProvider>
  );
}

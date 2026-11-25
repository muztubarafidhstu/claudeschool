import { useCallback, useEffect, useState } from 'react';
import { AppProvider, useApp } from './components/AppContext';
import Layout, { isPageEnabled, type Page } from './components/Layout';
import StudentProfile from './components/StudentProfile';
import LicenseGate from './pages/LicenseGate';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Admission from './pages/Admission';
import Students from './pages/Students';
import Attendance from './pages/Attendance';
import Exams from './pages/Exams';
import Fees from './pages/Fees';
import Staff from './pages/Staff';
import Backup from './pages/Backup';
import SettingsPage from './pages/Settings';
import type { Evaluation } from './lib/license';
import { checkForUpdates } from './lib/updater';

function Main({ banner }: { banner: Evaluation | null }) {
  const { settings, setSettingsUnlocked } = useApp();
  const [page, setPageRaw] = useState<Page>('dashboard');
  const [editId, setEditId] = useState<number | null>(null);
  const setPage = (p: Page) => { if (p !== 'settings') setSettingsUnlocked(false); setEditId(null); setPageRaw(p); };
  // Dynamic UI pruning: if the current page's module gets switched off, fall back to the dashboard.
  useEffect(() => { if (!isPageEnabled(page, settings.modules)) setPageRaw('dashboard'); }, [settings.modules, page]);
  useEffect(() => { void checkForUpdates(); }, []);

  if (!settings.onboarded) return <Onboarding />;
  return (
    <Layout page={page} setPage={setPage} banner={banner}>
      {page === 'dashboard' && <Dashboard go={setPage} />}
      {page === 'admission' && <Admission editId={editId} onDone={() => setPage('students')} />}
      {page === 'students' && <Students onEdit={(id) => { setEditId(id); setPageRaw('admission'); }} />}
      {page === 'attendance' && <Attendance />}
      {page === 'exams' && <Exams />}
      {page === 'fees' && <Fees />}
      {page === 'staff' && <Staff />}
      {page === 'backup' && <Backup />}
      {page === 'settings' && <SettingsPage />}
      <StudentProfile />
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

import { useState } from 'react';
import { GraduationCap, Sparkles, Upload, FilePlus2, DatabaseBackup } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Field } from '../components/ui';
import { applyImportedConfig, saveSettings } from '../lib/config';
import { importDemoData } from '../lib/demo';
import { restoreBackup } from '../lib/backup';
import { pickTextFile } from '../lib/platform';
import { loadLicense, type RegistrationForm } from '../lib/license';
import { getConfig, setConfig } from '../lib/config';
import LogoInput from '../components/LogoInput';
import { useEffect } from 'react';

export default function Onboarding() {
  const { settings, replaceSettings, toast, bump } = useApp();
  const [school, setSchool] = useState(settings.school);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    (async () => {
      // Pre-fill from the activation request (or the licensed school name).
      const reg = await getConfig<RegistrationForm | null>('registration', null);
      const pend = await getConfig<{ name?: string; name_bn?: string; logo?: string | null } | null>('pending_profile', null);
      const l = await loadLicense();
      setSchool((s) => ({
        ...s,
        name: s.name || pend?.name || reg?.school_name || l?.school_name || '',
        name_bn: s.name_bn || pend?.name_bn || reg?.school_name_bn || '',
        logo: s.logo || pend?.logo || null,
        phone: s.phone || reg?.phone || '',
        email: s.email || reg?.email || '',
        address: s.address || [reg?.address, reg?.district].filter(Boolean).join(', '),
        principal: s.principal || reg?.contact_person || '',
      }));
    })();
  }, []);

  async function finish(patch = {}) {
    const next = { ...settings, ...patch, school: { ...school, ...((patch as any).school ?? {}) }, onboarded: true };
    await saveSettings(next);
    await setConfig('pending_profile', null);
    replaceSettings(next);
    bump();
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); } catch (e: any) { toast(e.message ?? String(e), 'err'); } finally { setBusy(''); }
  }

  const options = [
    { icon: FilePlus2, title: 'Start fresh', desc: 'Empty school database — begin admitting students.', go: () => run('fresh', () => finish()) },
    { icon: Sparkles, title: 'Import demo data', desc: '250 sample students, attendance, fees, results and staff payroll for live demos.', go: () => run('demo', async () => { const r = await importDemoData({ ...settings, school }); toast(`Demo loaded: ${r.students} students, ${r.staff} staff`); await finish(); }) },
    { icon: Upload, title: 'Upload settings config (.json)', desc: 'Auto-configure modules, sections and subjects from another PC.', go: () => run('config', async () => { const t = await pickTextFile(); if (!t) return; const next = applyImportedConfig({ ...settings, school }, JSON.parse(t)); setSchool(next.school); await finish(next); toast('Configuration imported'); }) },
    { icon: DatabaseBackup, title: 'Restore a backup file', desc: 'Restore all data + configuration from a ScholarDesk backup (.json).', go: () => run('restore', async () => { const t = await pickTextFile(); if (!t) return; const next = await restoreBackup(JSON.parse(t), { ...settings, school }); replaceSettings(next); bump(); toast('Backup restored'); }) },
  ];

  return (
    <div className="min-h-full bg-canvas p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3 text-2xl font-bold"><GraduationCap className="text-brand" size={34} /> Welcome to ScholarDesk Pro</div>
        <div className="card grid gap-4 p-6 md:grid-cols-2">
          <h2 className="font-semibold md:col-span-2">School profile (appears on every A4 document)</h2>
          <Field label="School name (English)"><input className="input" value={school.name} onChange={(e) => setSchool({ ...school, name: e.target.value })} /></Field>
          <Field label="School name (Bangla)"><input className="input bn" value={school.name_bn} onChange={(e) => setSchool({ ...school, name_bn: e.target.value })} /></Field>
          <Field label="Address"><input className="input" value={school.address} onChange={(e) => setSchool({ ...school, address: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={school.phone} onChange={(e) => setSchool({ ...school, phone: e.target.value })} /></Field>
          <Field label="EIIN"><input className="input" value={school.eiin} onChange={(e) => setSchool({ ...school, eiin: e.target.value })} /></Field>
          <Field label="Principal / Director"><input className="input" value={school.principal} onChange={(e) => setSchool({ ...school, principal: e.target.value })} /></Field>
          <div className="md:col-span-2"><span className="label">Logo</span><LogoInput value={school.logo} onChange={(v) => setSchool({ ...school, logo: v })} /></div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {options.map(({ icon: Icon, title, desc, go }) => (
            <button key={title} disabled={!!busy} onClick={go} className="card flex items-start gap-4 p-5 text-left transition hover:border-brand hover:shadow-md disabled:opacity-60">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-dark"><Icon /></div>
              <div><div className="font-semibold">{title}</div><div className="text-sm text-slate-500">{desc}</div></div>
            </button>
          ))}
        </div>
        {busy && <p className="text-sm text-slate-500">Working…</p>}
      </div>
    </div>
  );
}

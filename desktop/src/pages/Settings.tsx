import { createContext, useContext, useState } from 'react';
import { Save, Undo2, Lock, ShieldCheck, FolderOpen, Images, Plus, Trash2, Download, Upload, Sparkles, ArrowUpCircle, KeyRound, School } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Card, Field, Modal, Switch, Tabs, Empty } from '../components/ui';
import { SECTION_LETTERS, money } from '../lib/util';
import { groupLabel, groups, isCoaching, terms } from '../lib/groups';
import { DEFAULT_RESULT_SMS, SUBJECT_GROUPS, applyImportedConfig, exportableConfig, saveSettings, type AppSettings, type Batch, type Modules } from '../lib/config';
import { PREVIEW_BUILD } from './LicenseGate';
import { fillTemplate, sendSms, smsConfigured, smsParts } from '../lib/sms';
import { exportAllPhotos } from '../lib/photos';
import { pickFolder } from '../lib/autobackup';
import { LICENSE_API, switchLicenseKey } from '../lib/license';
import { changePin } from '../lib/pin';
import { importDemoData } from '../lib/demo';
import { previewPromotion, runPromotion, type PromotionPreview } from '../lib/promotion';
import { pickTextFile, saveTextFile } from '../lib/platform';
import { loadLicense, syncOnline } from '../lib/license';
import { useEffect } from 'react';

type Tab = 'modules' | 'classes' | 'subjects' | 'school' | 'sms' | 'security' | 'data';

/** Settings tabs edit a draft; nothing is stored until "Save changes" is pressed. */
const DraftCtx = createContext<{ d: AppSettings; set: (patch: Partial<AppSettings>) => void }>(null as never);
const useDraft = () => { const c = useContext(DraftCtx); return { settings: c.d, update: c.set }; };

function SaveBar({ dirty, onSave, onDiscard }: { dirty: boolean; onSave: () => void; onDiscard: () => void }) {
  return (
    <div className={`sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-sm ${dirty ? 'border-due bg-amber-50' : 'border-line bg-white'}`}>
      <span className={`text-sm ${dirty ? 'font-semibold text-amber-800' : 'text-slate-500'}`}>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
      <div className="flex gap-2">
        <button className="btn-ghost" disabled={!dirty} onClick={onDiscard}><Undo2 size={16} /> Discard</button>
        <button className="btn-primary px-6" disabled={!dirty} onClick={onSave}><Save size={16} /> Save changes</button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { settings, replaceSettings, toast, settingsUnlocked, setSettingsUnlocked, requirePin } = useApp();
  const [tab, setTab] = useState<Tab>('modules');
  const coaching = isCoaching(settings);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [base, setBase] = useState<AppSettings>(settings);
  if (settings !== base) { setBase(settings); setDraft(settings); } // settings replaced elsewhere (import/restore)
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const save = async () => {
    for (let c = 1; c <= 10; c++) if (!(draft.subjects[c <= 8 ? `C${c}` : 'C9-10-Science'] ?? []).every((x) => x.name.trim() && x.full > 0)) return toast('Every subject needs a name and full marks above 0.', 'err');
    await saveSettings(draft); replaceSettings(draft); toast('Settings saved');
  };
  const lock = () => { if (dirty && !confirm('You have unsaved changes. Lock settings and discard them?')) return; setDraft(settings); setSettingsUnlocked(false); };
  if (!settingsUnlocked) {
    return (
      <div className="grid h-full place-items-center">
        <div className="card max-w-sm p-8 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-navy text-white"><Lock /></div>
          <h2 className="text-lg font-bold">Settings & System Control</h2>
          <p className="mb-5 text-sm text-slate-500">Protected by the Settings PIN.</p>
          <button className="btn-primary w-full" onClick={async () => setSettingsUnlocked(await requirePin('settings', 'Enter the 4-digit Settings PIN to continue.'))}><ShieldCheck size={16} /> Unlock Settings</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Settings & Control</h1>
        <button className="btn-danger" onClick={lock}><Lock size={16} /> Lock Settings</button>
      </div>
      <Tabs value={tab} onChange={setTab} items={[
        { value: 'modules', label: 'Modules' }, { value: 'classes', label: coaching ? 'Batches' : 'Classes & Sections' },
        ...(coaching ? [] : [{ value: 'subjects' as Tab, label: 'Subjects & Marks' }]),
        { value: 'school', label: coaching ? 'Centre & Fees' : 'School & Fees' }, { value: 'sms', label: 'SMS' }, { value: 'security', label: 'PINs & License' }, { value: 'data', label: 'Data, Config & Promotion' },
      ]} />
      <DraftCtx.Provider value={{ d: draft, set: (patch) => setDraft((p) => ({ ...p, ...patch })) }}>
        {tab === 'modules' && <ModulesTab />}
        {tab === 'classes' && <ClassesTab />}
        {tab === 'subjects' && <SubjectsTab />}
        {tab === 'school' && <SchoolTab />}
        {tab === 'sms' && <SmsTab />}
        {['modules', 'classes', 'subjects', 'school', 'sms'].includes(tab) && <SaveBar dirty={dirty} onSave={save} onDiscard={() => setDraft(settings)} />}
      </DraftCtx.Provider>
      {tab === 'security' && <SecurityTab />}
      {tab === 'data' && <DataTab dirty={dirty} />}
    </div>
  );
}

function ModulesTab() {
  const { settings, update } = useDraft();
  const items: { key: keyof Modules; label: string; desc: string }[] = [
    { key: 'exams', label: 'Exam & Result Management', desc: 'Marks entry, GPA calculation and A4 marksheets.' },
    { key: 'payroll', label: 'Teacher & Staff Salary (Payroll)', desc: 'Staff registration, salary disbursement and A4 payslips.' },
    { key: 'fees', label: 'Student Fee & Accounting', desc: 'Monthly tuition billing, partial dues and 2-page receipts.' },
    { key: 'sections', label: 'Class Sections Division', desc: 'Split classes into sections A–F (configure counts per class).' },
    { key: 'attendance', label: 'Daily Attendance Tracking', desc: 'Daily roll call, daily summaries and monthly grids.' },
  ];
  return (
    <>
    <Card title="Enable / disable modules" actions={<span className="text-xs text-slate-500">Disabled modules disappear from the sidebar, dashboard and student profiles.</span>}>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {items.map((i) => <Switch key={i.key} checked={settings.modules[i.key]} label={i.label} desc={i.desc} onChange={(v) => update({ modules: { ...settings.modules, [i.key]: v } })} />)}
      </div>
    </Card>
    <Card title="Automatic screen lock">
      <div className="grid gap-3 p-4 md:grid-cols-2">
        <Switch checked={settings.screenLock.enabled} label="Lock the screen when the app is not used" desc="Needs the Screen lock PIN to continue (default 1234 — change it under PINs & License)." onChange={(v) => update({ screenLock: { ...settings.screenLock, enabled: v } })} />
        <label className="block"><span className="label">Lock after</span>
          <select className="input" disabled={!settings.screenLock.enabled} value={settings.screenLock.minutes} onChange={(e) => update({ screenLock: { ...settings.screenLock, minutes: Number(e.target.value) } })}>
            {[1, 2, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} minute{m > 1 ? 's' : ''} without use</option>)}
          </select></label>
      </div>
    </Card>
    </>
  );
}

function ClassesTab() {
  const { settings, update } = useDraft();
  if (isCoaching(settings)) return <BatchesTab />;
  return (
    <Card title="Independent section count per class">
      {!settings.modules.sections ? <Empty>Turn ON “Class Sections Division” in Modules to configure sections.</Empty> : (
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          {groups(settings).map(({ no: c, label }) => (
            <div key={c} className="rounded-lg border border-line p-3">
              <div className="mb-2 text-sm font-semibold">{label}</div>
              <select className="input" value={settings.sectionsPerClass[c] ?? 1} onChange={(e) => update({ sectionsPerClass: { ...settings.sectionsPerClass, [c]: Number(e.target.value) } })}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} section{n > 1 ? 's' : ''} ({SECTION_LETTERS.slice(0, n).join(', ')})</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Coaching: the owner's own batch list. Batches are hidden (not deleted) so old records keep their batch name. */
function BatchesTab() {
  const { settings, update } = useDraft();
  const [name, setName] = useState('');
  const list = settings.batches;
  const setB = (no: number, patch: Partial<Batch>) => update({ batches: list.map((b) => (b.no === no ? { ...b, ...patch } : b)) });
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const no = Math.max(0, ...list.map((b) => b.no)) + 1;
    if (no > 99) return;
    update({ batches: [...list, { no, name: n, active: true }] });
    setName('');
  };
  return (
    <Card title="Batches" actions={<span className="text-xs text-slate-500">Students, attendance, fees and exams are organised by batch. Roll numbers are per batch.</span>}>
      <div className="space-y-3 p-4">
        <table className="table">
          <thead><tr><th className="w-12">#</th><th>Batch name</th><th>বাংলা</th><th>Schedule (optional)</th>{settings.modules.sections && <th>Sections</th>}<th>Monthly fee</th><th>Shown</th></tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.no} className={b.active ? '' : 'opacity-50'}>
              <td className="font-mono text-xs">{String(b.no).padStart(2, '0')}</td>
              <td><input className="input py-1" value={b.name} onChange={(e) => setB(b.no, { name: e.target.value })} /></td>
              <td><input className="input bn py-1" value={b.name_bn ?? ''} onChange={(e) => setB(b.no, { name_bn: e.target.value })} /></td>
              <td><input className="input py-1" placeholder="Sat/Mon/Wed 4 PM" value={b.schedule ?? ''} onChange={(e) => setB(b.no, { schedule: e.target.value })} /></td>
              {settings.modules.sections && <td><select className="input py-1" value={settings.sectionsPerClass[b.no] ?? 1} onChange={(e) => update({ sectionsPerClass: { ...settings.sectionsPerClass, [b.no]: Number(e.target.value) } })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></td>}
              <td><input type="number" className="input w-28 py-1" value={settings.defaultFees[b.no]?.monthly ?? 0} onChange={(e) => update({ defaultFees: { ...settings.defaultFees, [b.no]: { admission: settings.defaultFees[b.no]?.admission ?? 0, monthly: Number(e.target.value) } } })} /></td>
              <td><input type="checkbox" className="h-5 w-5 accent-[#0D9488]" checked={b.active} onChange={(e) => setB(b.no, { active: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <Field label="New batch name"><input className="input" placeholder="e.g. HSC Physics Morning" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></Field>
          <button className="btn-primary" onClick={add} disabled={!name.trim()}><Plus size={16} /> Add batch</button>
          <span className="text-xs text-slate-500">Untick “Shown” to hide a batch you no longer use (its old records stay).</span>
        </div>
      </div>
    </Card>
  );
}

function SubjectsTab() {
  const { settings, update } = useDraft();
  const [group, setGroup] = useState('C1');
  const [name, setName] = useState(''); const [nameBn, setNameBn] = useState(''); const [full, setFull] = useState(100);
  const list = settings.subjects[group] ?? [];
  const setList = (l: typeof list) => update({ subjects: { ...settings.subjects, [group]: l } });
  return (
    <Card title="Per-class subject & full-mark builder" actions={<span className="text-sm">Total Exam Marks: <b className="text-brand">{list.reduce((a, s) => a + s.full, 0)}</b></span>}>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap gap-1.5">{SUBJECT_GROUPS.map((g) => <button key={g.key} className={`tab ${group === g.key ? 'tab-active' : 'border border-line'}`} onClick={() => setGroup(g.key)}>{g.label}</button>)}</div>
        <table className="table">
          <thead><tr><th>#</th><th>Subject</th><th>বাংলা</th><th className="w-32">Full marks</th><th /></tr></thead>
          <tbody>{list.map((s, i) => (
            <tr key={i}><td>{i + 1}</td><td><input className="input py-1" value={s.name} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
              <td><input className="input bn py-1" value={s.name_bn ?? ''} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name_bn: e.target.value } : x)))} /></td>
              <td><input type="number" className="input py-1" value={s.full} onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, full: Number(e.target.value) } : x)))} /></td>
              <td className="text-right"><button className="btn-ghost btn-sm text-bad" onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td></tr>
          ))}</tbody>
        </table>
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <Field label="New subject"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="বাংলা নাম"><input className="input bn" value={nameBn} onChange={(e) => setNameBn(e.target.value)} /></Field>
          <Field label="Full marks"><input type="number" className="input w-28" value={full} onChange={(e) => setFull(Number(e.target.value))} /></Field>
          <button className="btn-primary" onClick={() => { if (!name.trim()) return; setList([...list, { name: name.trim(), name_bn: nameBn.trim(), full }]); setName(''); setNameBn(''); }}><Plus size={16} /> Add subject</button>
        </div>
      </div>
    </Card>
  );
}

function SchoolTab() {
  const { settings, update } = useDraft();
  const s = settings.school;
  const setS = (patch: Partial<typeof s>) => update({ school: { ...s, ...patch } });
  return (
    <div className="space-y-5">
      <Card title={<span className="flex items-center gap-2"><School size={18} /> School profile</span>}>
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <Field label="Name (English)"><input className="input" value={s.name} onChange={(e) => setS({ name: e.target.value })} /></Field>
          <Field label="Name (Bangla)"><input className="input bn" value={s.name_bn} onChange={(e) => setS({ name_bn: e.target.value })} /></Field>
          <Field label="EIIN"><input className="input" value={s.eiin} onChange={(e) => setS({ eiin: e.target.value })} /></Field>
          <Field label="Address" className="md:col-span-2"><input className="input" value={s.address} onChange={(e) => setS({ address: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={s.phone} onChange={(e) => setS({ phone: e.target.value })} /></Field>
          <Field label="Principal"><input className="input" value={s.principal} onChange={(e) => setS({ principal: e.target.value })} /></Field>
          <Field label="Academic year"><input type="number" className="input" value={settings.academicYear} onChange={(e) => update({ academicYear: Number(e.target.value) })} /></Field>
          <Field label="Logo (for A4 headers)">
            <input type="file" accept="image/*" className="input" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setS({ logo: String(r.result) }); r.readAsDataURL(f); }} />
          </Field>
        </div>
      </Card>
      <Card title="Photo folder">
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">Choose a folder and every student and staff photo is also saved there as a picture file (for example <code>260512_Sadia_Rahman.jpg</code>) — handy for ID cards, printing or your own records.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Folder" className="min-w-[260px] flex-1"><div className="input truncate bg-slate-50 font-mono text-xs">{settings.photoFolder ?? 'Not chosen (photos are kept only inside the app)'}</div></Field>
            <button className="btn-ghost" onClick={async () => { const f = await pickFolder(); if (f) update({ photoFolder: f }); }}><FolderOpen size={16} /> Choose folder</button>
            {settings.photoFolder && <button className="btn-ghost" onClick={() => update({ photoFolder: null })}>Stop saving</button>}
          </div>
          <PhotoExport />
        </div>
      </Card>
      <Card title={`Default fees per ${terms(settings).group.toLowerCase()} (pre-filled on admission)`}>
        <div className="overflow-x-auto p-4">
          <table className="table">
            <thead><tr><th>{terms(settings).group}</th><th>Monthly tuition</th><th>Admission fee</th></tr></thead>
            <tbody>{groups(settings).map(({ no: c, label }) => (
              <tr key={c}><td>{label}</td>
                <td><input type="number" className="input py-1" value={settings.defaultFees[c]?.monthly ?? 0} onChange={(e) => update({ defaultFees: { ...settings.defaultFees, [c]: { ...settings.defaultFees[c], monthly: Number(e.target.value) } } })} /></td>
                <td><input type="number" className="input py-1" value={settings.defaultFees[c]?.admission ?? 0} onChange={(e) => update({ defaultFees: { ...settings.defaultFees, [c]: { ...settings.defaultFees[c], admission: Number(e.target.value) } } })} /></td></tr>
            ))}</tbody>
          </table>
          {!isCoaching(settings) && <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
            <Field label="Half Yearly exam fee"><input type="number" className="input" value={settings.examFees.HALF_YEARLY} onChange={(e) => update({ examFees: { ...settings.examFees, HALF_YEARLY: Number(e.target.value) } })} /></Field>
            <Field label="Final exam fee"><input type="number" className="input" value={settings.examFees.FINAL} onChange={(e) => update({ examFees: { ...settings.examFees, FINAL: Number(e.target.value) } })} /></Field>
          </div>}
        </div>
      </Card>
    </div>
  );
}

function SecurityTab() {
  const { toast } = useApp();
  const [lic, setLic] = useState<Awaited<ReturnType<typeof loadLicense>>>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { loadLicense().then(setLic); }, []);
  const PinForm = ({ kind, label }: { kind: 'settings' | 'modify' | 'screen'; label: string }) => {
    const [cur, setCur] = useState(''); const [next, setNext] = useState('');
    return (
      <div className="rounded-lg border border-line p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold"><KeyRound size={16} /> {label}</div>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" type="password" maxLength={4} placeholder="Current PIN" value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, ''))} />
          <input className="input" type="password" maxLength={4} placeholder="New 4-digit PIN" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} />
        </div>
        <button className="btn-primary btn-sm mt-3" onClick={async () => { try { await changePin(kind, cur, next); toast('PIN changed'); setCur(''); setNext(''); } catch (e: any) { toast(e.message, 'err'); } }}>Change PIN</button>
      </div>
    );
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Security PINs"><div className="space-y-3 p-4"><PinForm kind="settings" label="Settings & System Control PIN (default 0000)" /><PinForm kind="modify" label="Modify & Delete Protection PIN (default 5555)" /><PinForm kind="screen" label="Screen lock PIN (default 1234)" /></div></Card>
      <Card title="License & subscription">
        <div className="space-y-2 p-4 text-sm">
          {PREVIEW_BUILD ? (
            <div className="rounded-lg bg-amber-50 p-4 text-amber-800">
              <b>Preview build — licensing is switched off.</b>
              <p className="mt-1">This test installer does not contact the license server. Customer builds activate with a School License Key and are controlled from <b>{LICENSE_API.replace('/api/v1', '')}</b>.</p>
            </div>
          ) : !lic ? (
            <p className="text-slate-500">No license information stored on this PC.</p>
          ) : (
            <>
              {[['School', lic.school_name], ['License key', lic.license_key], ['This PC', lic.machine_id], ['Status', lic.status], ['Valid until', lic.valid_until], ['Last online verification', lic.last_online_sync ? new Date(lic.last_online_sync * 1000).toLocaleString() : '—'], ['License server', LICENSE_API.replace('/api/v1', '')]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-slate-100 py-1.5"><span className="text-slate-500">{k}</span><b className={`text-right font-mono text-xs ${k === 'Status' ? (v === 'ACTIVE' ? 'text-ok' : 'text-bad') : ''}`}>{v ?? '—'}</b></div>
              ))}
              {msg && <p className={`rounded-lg px-3 py-2 ${msg.ok ? 'bg-emerald-50 text-ok' : 'bg-red-50 text-bad'}`}>{msg.text}</p>}
              <button className="btn-primary mt-3" disabled={busy} onClick={async () => {
                setBusy(true); setMsg(null);
                const r = await syncOnline();
                setBusy(false); setLic(await loadLicense());
                setMsg(r.ok ? { ok: true, text: 'License verified online.' } : { ok: false, text: r.message || `Status: ${r.status ?? 'offline'}` });
              }}>{busy ? 'Checking…' : 'Verify & sync online now'}</button>
              <ChangeKey />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function DataTab({ dirty }: { dirty: boolean }) {
  const { settings, replaceSettings, toast, bump, requirePin } = useApp();
  const [preview, setPreview] = useState<PromotionPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {dirty && <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800 lg:col-span-2">You have unsaved changes in another tab. Save them first so the exported configuration includes them.</p>}
      <Card title="Settings configuration (.json)">
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">Export module switches, per-class sections, subjects, fee defaults and the school profile — then import on a new PC to auto-configure everything.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => saveTextFile('scholardesk-config.json', JSON.stringify(exportableConfig(settings), null, 2), 'application/json')}><Download size={16} /> Download settings config</button>
            <button className="btn-ghost" onClick={async () => { const t = await pickTextFile(); if (!t) return; try { const next = applyImportedConfig(settings, JSON.parse(t)); await saveSettings(next); replaceSettings(next); toast('Configuration imported'); } catch (e: any) { toast(e.message, 'err'); } }}><Upload size={16} /> Upload settings config</button>
          </div>
        </div>
      </Card>
      <Card title="Demo data (sales demonstrations)">
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">{isCoaching(settings) ? 'Populates realistic coaching data: students in every batch, attendance, fee receipts, weekly/model test results and teachers paid monthly, daily and per class.' : 'Populates ~250 realistic students across Class 1–10 with attendance, fee receipts, half-yearly results and 12 staff with payroll.'} Only works on an empty database.</p>
          <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await importDemoData(settings); toast(`Demo data imported: ${r.students} students, ${r.staff} staff`); bump(); } catch (e: any) { toast(e.message, 'err'); } setBusy(false); }}><Sparkles size={16} /> Import demo data</button>
        </div>
      </Card>
      {terms(settings).promotion && <Card title={`Academic year promotion (${settings.academicYear} → ${settings.academicYear + 1})`} className="lg:col-span-2">
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">Promotes students who PASSED the {settings.academicYear} Final Exam to the next class (Class 10 → graduated). Students who failed or have no final result stay in their class. Rolls in every class are re-assigned by merit: highest total = Roll 01.</p>
          <button className="btn-ghost" onClick={async () => setPreview(await previewPromotion(settings))}><ArrowUpCircle size={16} /> Preview promotion</button>
        </div>
      </Card>}
      <Modal open={!!preview} onClose={() => setPreview(null)} title="Promotion preview" width="max-w-2xl"
        footer={<><button className="btn-ghost" onClick={() => setPreview(null)}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={async () => {
            if (!(await requirePin('modify', 'Run the year-end promotion? This changes the class and roll of every student.'))) return;
            setBusy(true);
            try { const r = await runPromotion(settings); const next = { ...settings, academicYear: settings.academicYear + 1 }; await saveSettings(next); replaceSettings(next); bump(); toast(`Promoted ${r.promoted}, repeating ${r.repeated}, graduated ${r.graduated}. Academic year is now ${next.academicYear}.`); setPreview(null); }
            catch (e: any) { toast(String(e.message ?? e), 'err'); }
            setBusy(false);
          }}>Run promotion</button></>}>
        <table className="table"><thead><tr><th>Class</th><th>Students</th><th>Passed (promote)</th><th>Failed (repeat)</th><th>No final result (repeat)</th></tr></thead>
          <tbody>{preview?.map((p) => <tr key={p.classNo}><td>{groupLabel(settings, p.classNo)}</td><td>{p.total}</td><td className="text-ok">{p.passed}{p.classNo === 10 ? ' (graduate)' : ''}</td><td className="text-bad">{p.failed}</td><td className="text-due">{p.noResult}</td></tr>)}</tbody></table>
        <p className="mt-3 text-xs text-slate-500">Take a backup first. Fee defaults: {money(settings.defaultFees[1]?.monthly)}… are not changed automatically.</p>
      </Modal>
    </div>
  );
}

/** Use a different license key on this PC (for example change School → Coaching). */
function ChangeKey() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) return <button className="btn-ghost mt-3 ml-2" onClick={() => setOpen(true)}>Change license key</button>;
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-line p-4">
      <div className="text-sm font-semibold">Change license key</div>
      <p className="text-xs text-slate-500">Enter the new key from your software provider. A <b>COA-</b> key switches this PC to the Coaching software, an <b>SCH-</b> key to School. All data on this PC stays. If the new key cannot be used, the current one is kept.</p>
      <input className="input font-mono uppercase tracking-wider" placeholder="SCH-2026-XXXX-XXXX" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} />
      {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-ok' : 'bg-red-50 text-bad'}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost" onClick={() => { setOpen(false); setMsg(null); }}>Cancel</button>
        <button className="btn-primary" disabled={busy || key.length < 18} onClick={async () => {
          setBusy(true); setMsg(null);
          const r = await switchLicenseKey(key);
          setBusy(false);
          if (r.ok || r.status === 'PENDING') { setMsg({ ok: true, text: 'License changed. Restarting…' }); setTimeout(() => window.location.reload(), 900); }
          else setMsg({ ok: false, text: r.message ?? 'Could not change the key.' });
        }}>{busy ? 'Checking…' : 'Use this key'}</button>
      </div>
    </div>
  );
}

function SmsTab() {
  const { settings, update } = useDraft();
  const { toast } = useApp();
  const sms = settings.sms;
  const set = (patch: Partial<typeof sms>) => update({ sms: { ...sms, ...patch } });
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const sample = fillTemplate(sms.resultTemplate, { name: 'Sadia Rahman', roll: 12, group: groups(settings)[0]?.label ?? 'Class 5', marks: 42, full: 50, percent: 84, exam: 'Weekly Test 3', date: '25 Nov', position: 2, total: 28, remark: 'Excellent!', school: settings.school.name || 'Your School' });
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="SMS gateway">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-3 gap-2">
            {([['NONE', 'Off'], ['HTTP', 'SMS company (API)'], ['ESP32', 'My ESP32 + GSM']] as const).map(([v, l]) => (
              <button key={v} type="button" onClick={() => set({ provider: v })} className={`rounded-lg border-2 px-3 py-2 text-sm font-semibold ${sms.provider === v ? 'border-brand bg-brand-soft text-brand-dark' : 'border-line text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
          {sms.provider === 'HTTP' && (
            <>
              <p className="text-xs text-slate-500">Paste the “send SMS” link from your SMS company (BulkSMSBD, SSL Wireless, Alpha SMS, MiM SMS…). Put <code>{'{to}'}</code> where the number goes (01XXXXXXXXX, or <code>{'{to88}'}</code> for 8801…) and <code>{'{msg}'}</code> where the message goes.</p>
              <Field label="Method"><select className="input" value={sms.method} onChange={(e) => set({ method: e.target.value as 'GET' | 'POST' })}><option value="GET">GET (link)</option><option value="POST">POST (form/JSON body)</option></select></Field>
              <Field label="URL"><textarea className="input font-mono text-xs" rows={3} placeholder="https://bulksmsbd.net/api/smsapi?api_key=YOUR_KEY&type=text&number={to88}&senderid=YOUR_ID&message={msg}" value={sms.url} onChange={(e) => set({ url: e.target.value.trim() })} /></Field>
              {sms.method === 'POST' && (
                <>
                  <Field label="Content type"><input className="input font-mono text-xs" value={sms.contentType} onChange={(e) => set({ contentType: e.target.value })} /></Field>
                  <Field label="Body template"><textarea className="input font-mono text-xs" rows={3} placeholder='{"number":"{to88}","message":"{msg}"}' value={sms.body} onChange={(e) => set({ body: e.target.value })} /></Field>
                </>
              )}
              <Field label="Success text in the reply (optional)" hint="e.g. 202 or success — leave empty to accept any HTTP 200 reply"><input className="input" value={sms.successText} onChange={(e) => set({ successText: e.target.value })} /></Field>
            </>
          )}
          {sms.provider === 'ESP32' && (
            <>
              <p className="text-xs text-slate-500">Your ESP32 with a SIM800/SIM7600 module on the same Wi-Fi. The app calls <code>http://IP/send?to=01…&amp;msg=…&amp;key=…</code> and expects a reply containing <b>OK</b>. The user guide includes the ESP32 code.</p>
              <Field label="ESP32 address"><input className="input font-mono" placeholder="http://192.168.1.50" value={sms.espUrl} onChange={(e) => set({ espUrl: e.target.value.trim() })} /></Field>
              <Field label="Gateway key"><input className="input font-mono" value={sms.espKey} onChange={(e) => set({ espKey: e.target.value.trim() })} /></Field>
            </>
          )}
          <Switch checked={false} onChange={() => toast('OTP login will come in a later update.')} label="OTP verification (coming later)" desc="Reserved for the OTP feature you plan to add. It does nothing yet." />
        </div>
      </Card>
      <div className="space-y-5">
        <Card title="Result SMS message">
          <div className="space-y-3 p-4">
            <textarea className="input text-sm" rows={4} value={sms.resultTemplate} onChange={(e) => set({ resultTemplate: e.target.value })} />
            <p className="text-xs text-slate-500">Placeholders: {'{name} {roll} {group} {marks} {full} {percent} {exam} {date} {position} {total} {remark} {school}'}</p>
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><div className="label">Preview ({smsParts(sample)} SMS part{smsParts(sample) > 1 ? 's' : ''}, {sample.length} characters)</div>{sample}</div>
            <button className="btn-ghost btn-sm" onClick={() => set({ resultTemplate: DEFAULT_RESULT_SMS })}>Reset to default</button>
          </div>
        </Card>
        <Card title="Send a test SMS">
          <div className="flex flex-wrap items-end gap-2 p-4">
            <Field label="Mobile number"><input className="input" placeholder="01XXXXXXXXX" value={testTo} onChange={(e) => setTestTo(e.target.value.replace(/\D/g, '').slice(0, 13))} /></Field>
            <button className="btn-primary" disabled={busy || !smsConfigured(sms)} onClick={async () => {
              setBusy(true);
              const r = await sendSms(sms, testTo, `Test SMS from ${settings.school.name || 'ScholarDesk Pro'}. SMS is working.`, 'TEST');
              setBusy(false); toast(r.ok ? 'Test SMS sent' : r.detail, r.ok ? 'ok' : 'err');
            }}>{busy ? 'Sending…' : 'Send test'}</button>
            <span className="text-xs text-slate-500">Save changes first if you just edited the gateway.</span>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Uses the SAVED settings (the folder must be saved before exporting). */
function PhotoExport() {
  const { settings, toast } = useApp();
  const [busy, setBusy] = useState(false);
  if (!settings.photoFolder) return null;
  return (
    <button className="btn-primary" disabled={busy} onClick={async () => {
      setBusy(true);
      try { const r = await exportAllPhotos(settings); toast(`${r.saved} photos saved to the folder${r.failed ? `, ${r.failed} failed` : ''}`, r.failed ? 'err' : 'ok'); }
      catch (e: any) { toast(e.message ?? String(e), 'err'); }
      setBusy(false);
    }}><Images size={16} /> {busy ? 'Saving photos…' : 'Save all existing photos to the folder now'}</button>
  );
}

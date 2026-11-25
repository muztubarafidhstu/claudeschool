import { createContext, useContext, useState } from 'react';
import { Save, Undo2, Lock, ShieldCheck, Plus, Trash2, Download, Upload, Sparkles, ArrowUpCircle, KeyRound, School } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Card, Field, Modal, Switch, Tabs, Empty } from '../components/ui';
import { CLASSES, SECTION_LETTERS, money } from '../lib/util';
import { SUBJECT_GROUPS, applyImportedConfig, exportableConfig, saveSettings, type AppSettings, type Modules } from '../lib/config';
import { PREVIEW_BUILD } from './LicenseGate';
import { LICENSE_API } from '../lib/license';
import { changePin } from '../lib/pin';
import { importDemoData } from '../lib/demo';
import { previewPromotion, runPromotion, type PromotionPreview } from '../lib/promotion';
import { pickTextFile, saveTextFile } from '../lib/platform';
import { loadLicense, syncOnline } from '../lib/license';
import { useEffect } from 'react';

type Tab = 'modules' | 'classes' | 'subjects' | 'school' | 'security' | 'data';

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
        { value: 'modules', label: 'Modules' }, { value: 'classes', label: 'Classes & Sections' }, { value: 'subjects', label: 'Subjects & Marks' },
        { value: 'school', label: 'School & Fees' }, { value: 'security', label: 'PINs & License' }, { value: 'data', label: 'Data, Config & Promotion' },
      ]} />
      <DraftCtx.Provider value={{ d: draft, set: (patch) => setDraft((p) => ({ ...p, ...patch })) }}>
        {tab === 'modules' && <ModulesTab />}
        {tab === 'classes' && <ClassesTab />}
        {tab === 'subjects' && <SubjectsTab />}
        {tab === 'school' && <SchoolTab />}
        {['modules', 'classes', 'subjects', 'school'].includes(tab) && <SaveBar dirty={dirty} onSave={save} onDiscard={() => setDraft(settings)} />}
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
    <Card title="Enable / disable modules" actions={<span className="text-xs text-slate-500">Disabled modules disappear from the sidebar, dashboard and student profiles.</span>}>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        {items.map((i) => <Switch key={i.key} checked={settings.modules[i.key]} label={i.label} desc={i.desc} onChange={(v) => update({ modules: { ...settings.modules, [i.key]: v } })} />)}
      </div>
    </Card>
  );
}

function ClassesTab() {
  const { settings, update } = useDraft();
  return (
    <Card title="Independent section count per class">
      {!settings.modules.sections ? <Empty>Turn ON “Class Sections Division” in Modules to configure sections.</Empty> : (
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          {CLASSES.map((c) => (
            <div key={c} className="rounded-lg border border-line p-3">
              <div className="mb-2 text-sm font-semibold">Class {c}</div>
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
      <Card title="Default fees per class (pre-filled on admission)">
        <div className="overflow-x-auto p-4">
          <table className="table">
            <thead><tr><th>Class</th><th>Monthly tuition</th><th>Admission fee</th></tr></thead>
            <tbody>{CLASSES.map((c) => (
              <tr key={c}><td>Class {c}</td>
                <td><input type="number" className="input py-1" value={settings.defaultFees[c]?.monthly ?? 0} onChange={(e) => update({ defaultFees: { ...settings.defaultFees, [c]: { ...settings.defaultFees[c], monthly: Number(e.target.value) } } })} /></td>
                <td><input type="number" className="input py-1" value={settings.defaultFees[c]?.admission ?? 0} onChange={(e) => update({ defaultFees: { ...settings.defaultFees, [c]: { ...settings.defaultFees[c], admission: Number(e.target.value) } } })} /></td></tr>
            ))}</tbody>
          </table>
          <div className="mt-4 grid max-w-md grid-cols-2 gap-3">
            <Field label="Half Yearly exam fee"><input type="number" className="input" value={settings.examFees.HALF_YEARLY} onChange={(e) => update({ examFees: { ...settings.examFees, HALF_YEARLY: Number(e.target.value) } })} /></Field>
            <Field label="Final exam fee"><input type="number" className="input" value={settings.examFees.FINAL} onChange={(e) => update({ examFees: { ...settings.examFees, FINAL: Number(e.target.value) } })} /></Field>
          </div>
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
  const PinForm = ({ kind, label }: { kind: 'settings' | 'modify'; label: string }) => {
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
      <Card title="Security PINs"><div className="space-y-3 p-4"><PinForm kind="settings" label="Settings & System Control PIN (default 0000)" /><PinForm kind="modify" label="Modify & Delete Protection PIN (default 5555)" /></div></Card>
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
          <p className="text-sm text-slate-600">Populates ~250 realistic students across Class 1–10 with attendance, fee receipts, half-yearly results and 12 staff with payroll. Only works on an empty database.</p>
          <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await importDemoData(settings); toast(`Demo data imported: ${r.students} students, ${r.staff} staff`); bump(); } catch (e: any) { toast(e.message, 'err'); } setBusy(false); }}><Sparkles size={16} /> Import demo data</button>
        </div>
      </Card>
      <Card title={`Academic year promotion (${settings.academicYear} → ${settings.academicYear + 1})`} className="lg:col-span-2">
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-600">Promotes students who PASSED the {settings.academicYear} Final Exam to the next class (Class 10 → graduated). Students who failed or have no final result stay in their class. Rolls in every class are re-assigned by merit: highest total = Roll 01.</p>
          <button className="btn-ghost" onClick={async () => setPreview(await previewPromotion(settings))}><ArrowUpCircle size={16} /> Preview promotion</button>
        </div>
      </Card>
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
          <tbody>{preview?.map((p) => <tr key={p.classNo}><td>Class {p.classNo}</td><td>{p.total}</td><td className="text-ok">{p.passed}{p.classNo === 10 ? ' (graduate)' : ''}</td><td className="text-bad">{p.failed}</td><td className="text-due">{p.noResult}</td></tr>)}</tbody></table>
        <p className="mt-3 text-xs text-slate-500">Take a backup first. Fee defaults: {money(settings.defaultFees[1]?.monthly)}… are not changed automatically.</p>
      </Modal>
    </div>
  );
}

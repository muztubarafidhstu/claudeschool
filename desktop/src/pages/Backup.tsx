import { useEffect, useState } from 'react';
import { CloudUpload, Link2, Unlink, Download, Upload, RefreshCw, HardDrive } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Card, Empty, Switch } from '../components/ui';
import { buildBackup, restoreBackup } from '../lib/backup';
import { connectDrive, disconnectDrive, downloadBackup, driveConfigured, getDriveAuth, listBackups, uploadBackup } from '../lib/gdrive';
import { syncOnline } from '../lib/license';
import { pickTextFile, saveTextFile } from '../lib/platform';
import { getConfig, setConfig } from '../lib/config';

export default function Backup() {
  const { settings, toast, replaceSettings, bump, requirePin } = useApp();
  const [connected, setConnected] = useState(false);
  const [files, setFiles] = useState<{ id: string; name: string; size: string; createdTime: string }[]>([]);
  const [busy, setBusy] = useState('');
  const [last, setLast] = useState<string | null>(null);
  const [withPhotos, setWithPhotos] = useState(true);

  useEffect(() => { getDriveAuth().then((a) => setConnected(!!a)); getConfig<string | null>('last_backup', null).then(setLast); }, []);
  const name = () => `ScholarDesk_${(settings.school.name || 'School').replace(/\W+/g, '_')}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e: any) { toast(e.message ?? String(e), 'err'); } finally { setBusy(''); } };

  const backupToDrive = () => run('drive', async () => {
    const b = await buildBackup(settings, false); // text-only: strips image blobs
    const json = JSON.stringify(b);
    const out = await uploadBackup(name(), json);
    const sync = await syncOnline(); // backup is an online moment → refresh the 7-day licence timer
    const at = new Date().toISOString();
    await setConfig('last_backup', at); setLast(at);
    toast(`Uploaded ${out.name} (${Math.round(json.length / 1024)} KB)${sync.ok ? ' · license synced' : ''}`);
    setFiles(await listBackups());
  });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Backup & Restore</h1>
      <Card title="Google Drive text-only backup" actions={connected ? <span className="badge bg-emerald-50 text-ok">Connected</span> : null}>
        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-600">Uploads a lightweight structured JSON (students, fees, attendance, results, staff, payroll & settings — photos stripped) into a <b>ScholarDesk_Backups</b> folder in the school’s Google Drive. Uses the limited <code>drive.file</code> permission: the app can only see files it created. Each backup also re-verifies your license online, resetting the 7-day offline timer.</p>
          {!driveConfigured() ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Google Drive backup is available in the desktop app build with a Google OAuth client ID. Use the local file backup below meanwhile.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {!connected
                ? <button className="btn-primary" disabled={!!busy} onClick={() => run('connect', async () => { await connectDrive(); setConnected(true); setFiles(await listBackups()); toast('Google Drive connected'); })}><Link2 size={16} /> Connect Google Drive</button>
                : <>
                  <button className="btn-primary px-6 py-3" disabled={!!busy} onClick={backupToDrive}><CloudUpload size={18} /> {busy === 'drive' ? 'Uploading…' : 'Backup to Google Drive'}</button>
                  <button className="btn-ghost" disabled={!!busy} onClick={() => run('list', async () => setFiles(await listBackups()))}><RefreshCw size={16} /> Show Drive backups</button>
                  <button className="btn-ghost" onClick={async () => { await disconnectDrive(); setConnected(false); setFiles([]); }}><Unlink size={16} /> Disconnect</button>
                </>}
            </div>
          )}
          {last && <p className="text-xs text-slate-500">Last backup: {new Date(last).toLocaleString()}</p>}
          {files.length > 0 && (
            <table className="table">
              <thead><tr><th>Backup file</th><th>Created</th><th>Size</th><th /></tr></thead>
              <tbody>{files.map((f) => (
                <tr key={f.id}><td className="font-mono text-xs">{f.name}</td><td>{new Date(f.createdTime).toLocaleString()}</td><td>{Math.round(Number(f.size) / 1024)} KB</td>
                  <td className="text-right"><button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => run('restore', async () => {
                    if (!(await requirePin('modify', 'Restoring REPLACES all current school data with this backup. Continue?'))) return;
                    const next = await restoreBackup(await downloadBackup(f.id), settings); replaceSettings(next); bump(); toast('Backup restored (configuration auto-restored)');
                  })}><Download size={12} /> Restore</button></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><HardDrive size={18} /> Local backup file (works offline)</span>}>
        <div className="space-y-4 p-5">
          <Switch checked={withPhotos} onChange={setWithPhotos} label="Include student & staff photos" desc="Larger file. Turn off for a text-only backup." />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!busy} onClick={() => run('local', async () => { const b = await buildBackup(settings, withPhotos); if (await saveTextFile(name(), JSON.stringify(b), 'application/json')) { const at = new Date().toISOString(); await setConfig('last_backup', at); setLast(at); toast('Backup file saved'); } })}><Download size={16} /> Save backup file</button>
            <button className="btn-ghost" disabled={!!busy} onClick={() => run('localrestore', async () => {
              const text = await pickTextFile(); if (!text) return;
              if (!(await requirePin('modify', 'Restoring REPLACES all current school data with the backup file. Continue?'))) return;
              const next = await restoreBackup(JSON.parse(text), settings); replaceSettings(next); bump(); toast('Backup restored');
            })}><Upload size={16} /> Restore from file</button>
          </div>
        </div>
      </Card>
      {!files.length && !connected && <Empty>Tip: schedule a weekly Google Drive backup habit — it also keeps the license verified.</Empty>}
    </div>
  );
}

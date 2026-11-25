import { useCallback, useEffect, useState } from 'react';
import { CloudUpload, Link2, Unlink, Download, Upload, RefreshCw, HardDrive, FolderOpen, Send, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useApp } from '../components/AppContext';
import { Card, Empty, Field, Switch } from '../components/ui';
import { restoreBackup } from '../lib/backup';
import { connectDrive, disconnectDrive, downloadBackup, driveConfigured, getDriveAuth, listBackups } from '../lib/gdrive';
import {
  backupToDrive, backupToFolder, backupToTelegram, getPrefs, getStatus, listFolder, pickFolder, readFromFolder, setPrefs,
  telegramFindChat, KEEP_DAILY, type BackupPrefs, type BackupStatus, type FolderFile,
} from '../lib/autobackup';
import { pickTextFile } from '../lib/platform';
import { todayISO } from '../lib/util';

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : 'never');

export default function Backup() {
  const { settings, toast, replaceSettings, bump, requirePin } = useApp();
  const [prefs, setP] = useState<BackupPrefs | null>(null);
  const [status, setStatus] = useState<BackupStatus>({});
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveFiles, setDriveFiles] = useState<{ id: string; name: string; size: string; createdTime: string }[]>([]);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    const p = await getPrefs();
    setP(p);
    setStatus(await getStatus());
    setDriveConnected(!!(await getDriveAuth()));
    if (p.localFolder) setFolderFiles(await listFolder(p.localFolder).catch(() => []));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (next: BackupPrefs) => { setP(next); await setPrefs(next); };
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try { await fn(); } catch (e: any) { toast(e?.message ?? String(e), 'err'); } finally { setBusy(''); await refresh(); }
  };
  const restore = (getJson: () => Promise<unknown>) => run('restore', async () => {
    if (!(await requirePin('modify', 'Restoring REPLACES all current data with this backup. Continue?'))) return;
    const next = await restoreBackup(await getJson(), settings);
    replaceSettings(next); bump(); toast('Backup restored (settings restored too)');
  });

  if (!prefs) return null;
  const Status = ({ kind }: { kind: 'local' | 'drive' | 'telegram' }) => {
    const err = status.errors?.[kind];
    const doneToday = status[kind] === todayISO();
    return (
      <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${err ? 'bg-red-50 text-bad' : doneToday ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'}`}>
        {err ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
        <span>{err ? `Last attempt failed: ${err}` : doneToday ? 'Today’s automatic backup is done.' : 'No automatic backup yet today.'} Last backup: {when(status.lastAt?.[kind])}</span>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Backup & Restore</h1>
        <p className="text-sm text-slate-500">Backups are named with today’s date. Automatic backups run once a day; the button makes an extra one any time.</p>
      </div>

      {/* ---------------- Local folder ---------------- */}
      <Card title={<span className="flex items-center gap-2"><HardDrive size={18} /> Local drive / folder (daily, before the app opens)</span>}>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Backup folder" className="min-w-[280px] flex-1">
              <div className="input truncate bg-slate-50 font-mono text-xs">{prefs.localFolder ?? 'Not chosen yet'}</div>
            </Field>
            <button className="btn-ghost" disabled={!!busy} onClick={() => run('pick', async () => { const f = await pickFolder(); if (f) await save({ ...prefs, localFolder: f }); })}><FolderOpen size={16} /> Choose folder</button>
          </div>
          <p className="text-xs text-slate-500">Tip: choose a folder on another drive (D:, a USB drive) or a Google Drive / OneDrive desktop folder, so a broken C: drive cannot take the backups with it.</p>
          <Switch checked={prefs.localAuto} onChange={(v) => save({ ...prefs, localAuto: v })} label="Automatic daily backup on the first app start" desc={`Keeps the newest ${KEEP_DAILY} daily backups. Manual backups are never deleted automatically.`} />
          <Status kind="local" />
          <button className="btn-primary" disabled={!!busy || !prefs.localFolder} onClick={() => run('local', async () => { const p = await backupToFolder(settings, true); toast(`Saved: ${p}`); })}><Download size={16} /> {busy === 'local' ? 'Saving…' : 'Back up now'}</button>
          {folderFiles.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
              <table className="table">
                <thead><tr><th>Backup in this folder</th><th>Size</th><th /></tr></thead>
                <tbody>{folderFiles.map((f) => (
                  <tr key={f.name}><td className="font-mono text-xs">{f.name}</td><td>{Math.max(1, Math.round(f.size / 1024))} KB</td>
                    <td className="text-right"><button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => restore(async () => JSON.parse(await readFromFolder(prefs.localFolder!, f.name)))}><Upload size={12} /> Restore</button></td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* ---------------- Google Drive ---------------- */}
      <Card title={<span className="flex items-center gap-2"><CloudUpload size={18} /> Google Drive (daily, automatic when online)</span>} actions={driveConnected ? <span className="badge bg-emerald-50 text-ok">Connected</span> : null}>
        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-600">A small text-only copy (photos removed) goes into a <b>ScholarDesk_Backups</b> folder in the school’s Google Drive. The app can only see files it created.</p>
          {!driveConfigured() ? (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Google Drive is not set up in this build. Use the local folder or Telegram backup.</p>
          ) : !driveConnected ? (
            <button className="btn-primary" disabled={!!busy} onClick={() => run('connect', async () => { await connectDrive(); toast('Google Drive connected'); })}><Link2 size={16} /> Connect Google Drive</button>
          ) : (
            <>
              <Switch checked={prefs.driveAuto} onChange={(v) => save({ ...prefs, driveAuto: v })} label="Automatic daily Google Drive backup" desc="Runs in the background once a day whenever the PC is online." />
              <Status kind="drive" />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={!!busy} onClick={() => run('drive', async () => { const o = await backupToDrive(settings, false); toast(`Uploaded ${o.name}`); })}><CloudUpload size={16} /> {busy === 'drive' ? 'Uploading…' : 'Back up to Drive now'}</button>
                <button className="btn-ghost" disabled={!!busy} onClick={() => run('list', async () => setDriveFiles(await listBackups()))}><RefreshCw size={16} /> Show Drive backups</button>
                <button className="btn-ghost" onClick={() => run('disc', async () => { await disconnectDrive(); setDriveFiles([]); })}><Unlink size={16} /> Disconnect</button>
              </div>
              {driveFiles.length > 0 && (
                <table className="table"><tbody>{driveFiles.map((f) => (
                  <tr key={f.id}><td className="font-mono text-xs">{f.name}</td><td>{Math.round(Number(f.size) / 1024)} KB</td>
                    <td className="text-right"><button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => restore(() => downloadBackup(f.id))}><Upload size={12} /> Restore</button></td></tr>
                ))}</tbody></table>
              )}
            </>
          )}
        </div>
      </Card>

      {/* ---------------- Telegram ---------------- */}
      <Card title={<span className="flex items-center gap-2"><Send size={18} /> Telegram (daily, automatic when online)</span>} actions={prefs.telegram.enabled && prefs.telegram.chatId ? <span className="badge bg-emerald-50 text-ok">On</span> : null}>
        <div className="space-y-4 p-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>In Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, give it any name. Copy the <b>token</b> it gives you.</li>
            <li>Open your new bot in Telegram and send it any message (for example “hi”).</li>
            <li>Paste the token below and press <b>Find my chat</b>, then <b>Send test backup</b>.</li>
          </ol>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Bot token"><input className="input font-mono text-xs" type="password" placeholder="123456789:ABC…" value={prefs.telegram.botToken} onChange={(e) => save({ ...prefs, telegram: { ...prefs.telegram, botToken: e.target.value.trim() } })} /></Field>
            <Field label="Chat ID"><div className="flex gap-2">
              <input className="input font-mono" value={prefs.telegram.chatId} onChange={(e) => save({ ...prefs, telegram: { ...prefs.telegram, chatId: e.target.value.trim() } })} />
              <button className="btn-ghost" disabled={!!busy || !prefs.telegram.botToken} onClick={() => run('chat', async () => {
                const c = await telegramFindChat(prefs.telegram.botToken);
                if (!c) throw new Error('No message found. Send any message to your bot in Telegram first, then try again.');
                await save({ ...prefs, telegram: { ...prefs.telegram, chatId: c.id, enabled: true } }); toast(`Found chat: ${c.name}`);
              })}>Find my chat</button>
            </div></Field>
          </div>
          <Switch checked={prefs.telegram.enabled} onChange={(v) => save({ ...prefs, telegram: { ...prefs.telegram, enabled: v } })} label="Automatic daily Telegram backup" desc="The backup file arrives in your Telegram chat every day — nothing to download or keep on this PC." />
          <Status kind="telegram" />
          <button className="btn-primary" disabled={!!busy || !prefs.telegram.botToken || !prefs.telegram.chatId} onClick={() => run('tg', async () => { await backupToTelegram(settings, false); toast('Backup sent to Telegram'); })}><Send size={16} /> {busy === 'tg' ? 'Sending…' : 'Send test backup now'}</button>
        </div>
      </Card>

      {/* ---------------- Restore from any file ---------------- */}
      <Card title="Restore from a backup file">
        <div className="space-y-3 p-5">
          <p className="text-sm text-slate-600">Use a backup file from anywhere (for example one you downloaded from Telegram or Google Drive) to move data to a new PC.</p>
          <button className="btn-ghost" disabled={!!busy} onClick={() => restore(async () => { const t = await pickTextFile(); if (!t) throw new Error('No file chosen'); return JSON.parse(t); })}><Upload size={16} /> Choose backup file & restore</button>
        </div>
      </Card>
      {!prefs.localFolder && !driveConnected && !prefs.telegram.enabled && <Empty>No backup is set up yet. Choose a local folder above — it takes 10 seconds.</Empty>}
    </div>
  );
}

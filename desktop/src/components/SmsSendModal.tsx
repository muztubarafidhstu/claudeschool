import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useApp } from './AppContext';
import { Modal } from './ui';
import { normalizeBdMobile, sendBatch, smsConfigured, smsParts } from '../lib/sms';

export interface SmsItem { key: number; label: string; to: string | null; msg: string; sentAt?: string | null }

/** Preview + select + send, one by one, with progress. Used for coaching and school results. */
export default function SmsSendModal({ title, items, onClose, onSent }: { title: string; items: SmsItem[]; onClose: () => void; onSent?: (key: number) => void }) {
  const { settings, toast } = useApp();
  const [pick, setPick] = useState<Set<number>>(() => new Set(items.filter((i) => normalizeBdMobile(i.to) && !i.sentAt).map((i) => i.key)));
  const [progress, setProgress] = useState<{ done: number; sent: number; failed: number } | null>(null);
  const chosen = items.filter((i) => pick.has(i.key));
  const parts = chosen.reduce((a, i) => a + smsParts(i.msg), 0);
  const running = progress !== null && progress.done < chosen.length;
  async function send() {
    setProgress({ done: 0, sent: 0, failed: 0 });
    const res = await sendBatch(settings, chosen.map((i) => ({ to: i.to!, msg: i.msg, onDone: (ok) => ok && onSent?.(i.key) })), (done, sent, failed) => setProgress({ done, sent, failed }));
    toast(`SMS: ${res.sent} sent, ${res.failed} failed`, res.failed ? 'err' : 'ok');
  }
  const valid = items.filter((i) => normalizeBdMobile(i.to));
  return (
    <Modal open onClose={() => !running && onClose()} title={title} width="max-w-3xl"
      footer={<><button className="btn-ghost" disabled={running} onClick={onClose}>Close</button>
        <button className="btn-primary" disabled={!chosen.length || !smsConfigured(settings.sms) || running} onClick={send}><MessageSquare size={16} /> Send {chosen.length} SMS ({parts} part{parts === 1 ? '' : 's'})</button></>}>
      {!smsConfigured(settings.sms) && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">SMS is not set up yet. Go to Settings → SMS and choose your SMS company or your ESP32 gateway.</p>}
      {progress && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">Sending… {progress.done}/{chosen.length} · <span className="text-ok">{progress.sent} sent</span> · <span className="text-bad">{progress.failed} failed</span></p>}
      <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-line">
        <table className="table">
          <thead><tr><th className="w-10"><input type="checkbox" checked={!!valid.length && chosen.length === valid.length} onChange={(e) => setPick(new Set(e.target.checked ? valid.map((i) => i.key) : []))} /></th><th>Student</th><th>Father’s mobile</th><th>Message</th></tr></thead>
          <tbody>{items.map((i) => {
            const ok = !!normalizeBdMobile(i.to);
            return (
              <tr key={i.key} className={ok ? '' : 'opacity-50'}>
                <td><input type="checkbox" disabled={!ok} checked={pick.has(i.key)} onChange={(e) => setPick((p) => { const n = new Set(p); e.target.checked ? n.add(i.key) : n.delete(i.key); return n; })} /></td>
                <td className="whitespace-nowrap">{i.label}{i.sentAt && <div className="text-[10px] text-ok">sent {i.sentAt.slice(0, 16)}</div>}</td>
                <td className="font-mono text-xs">{i.to || <span className="text-bad">missing</span>}</td>
                <td className="text-xs text-slate-600">{i.msg}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Modal>
  );
}

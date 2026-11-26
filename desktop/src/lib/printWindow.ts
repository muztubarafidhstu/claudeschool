/**
 * Opens A4 documents in their own window (Print · Save PDF · Close) instead of printing straight away.
 * The rendered document HTML is handed over through localStorage (same origin), then removed.
 */
import { isTauri } from './platform';

export interface PrintPayload { title: string; html: string; fileName: string }

export async function openPrintWindow(container: HTMLElement, title: string, fileName = title) {
  const id = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  const payload: PrintPayload = { title, html: container.innerHTML, fileName: fileName.replace(/[^\wঀ-৿ -]+/g, '').trim().replace(/\s+/g, '_') || 'document' };
  try { localStorage.setItem(`sd_print_${id}`, JSON.stringify(payload)); } catch { /* storage full */ }
  const url = `print.html?id=${id}`;
  if (isTauri) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const w = new WebviewWindow(`print-${id}`, { url, title: `${title} — Print / Save PDF`, width: 1000, height: 900, center: true, focus: true });
    w.once('tauri://error', (e) => console.error('print window', e));
  } else {
    window.open(`/${url}`, '_blank', 'width=1000,height=900');
  }
}

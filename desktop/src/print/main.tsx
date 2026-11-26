import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Printer, FileDown, X } from 'lucide-react';
import '../index.css';
import { isTauri } from '../lib/platform';
import type { PrintPayload } from '../lib/printWindow';

function load(): PrintPayload | null {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return null;
  const key = `sd_print_${id}`;
  try {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (!raw) return null;
    sessionStorage.setItem(key, raw);    // survives a reload of this window
    localStorage.removeItem(key);        // don't leave documents behind
    return JSON.parse(raw);
  } catch { return null; }
}

async function closeWindow() {
  if (isTauri) { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().close(); }
  else window.close();
}

/** Each .a4 page → image → one PDF page (keeps Bangla text, colours and photos exactly as shown). */
async function savePdf(doc: HTMLElement, fileName: string, setMsg: (s: string) => void) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  await document.fonts.ready;
  const pages = Array.from(doc.querySelectorAll<HTMLElement>('.a4'));
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (let i = 0; i < pages.length; i++) {
    setMsg(`Creating PDF… page ${i + 1} of ${pages.length}`);
    const land = pages[i].classList.contains('a4-landscape');
    const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const [w, h] = land ? [297, 210] : [210, 297];
    if (!pdf) pdf = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
    else pdf.addPage('a4', land ? 'landscape' : 'portrait');
    const ratio = canvas.height / canvas.width;
    const imgH = Math.min(h, w * ratio);
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, imgH, undefined, 'FAST');
  }
  if (!pdf) throw new Error('Nothing to save');
  const name = `${fileName}.pdf`;
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!path) { setMsg(''); return false; }
    await writeFile(path, new Uint8Array(pdf.output('arraybuffer')));
    setMsg(`Saved: ${path}`);
  } else {
    pdf.save(name);
    setMsg(`Saved: ${name}`);
  }
  return true;
}

function PrintApp() {
  const [p] = useState(load);
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (p) document.title = `${p.title} — ScholarDesk Pro`; }, [p]);
  if (!p) return <div className="grid h-full place-items-center text-slate-500">This document is no longer available. Close this window and open it again.</div>;
  return (
    <div className="min-h-full bg-slate-500/90 print:bg-white">
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-navy px-5 py-3 text-white shadow-lg">
        <div className="min-w-0"><div className="truncate font-semibold">{p.title}</div>{msg && <div className="truncate text-xs text-teal-200">{msg}</div>}</div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print</button>
          <button className="btn border border-white/25 bg-white/10 text-white hover:bg-white/20" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await savePdf(ref.current!, p.fileName, setMsg); } catch (e) { setMsg(`Could not save: ${String(e)}`); }
            setBusy(false);
          }}><FileDown size={16} /> {busy ? 'Saving…' : 'Save PDF'}</button>
          <button className="btn border border-white/25 text-white hover:bg-white/10" onClick={closeWindow}><X size={16} /> Close</button>
        </div>
      </div>
      <div ref={ref} id="print-doc" className="py-8 print:py-0" dangerouslySetInnerHTML={{ __html: p.html }} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('print-root')!).render(<React.StrictMode><PrintApp /></React.StrictMode>);

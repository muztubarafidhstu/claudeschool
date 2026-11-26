import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { openPrintWindow } from '../lib/printWindow';

/**
 * In-app preview of A4 documents. Nothing prints automatically:
 * "Print / Save PDF" opens the document in its own window (Print · Save PDF · Close).
 * openWindow = open that window right away (used by "Save & Print" buttons).
 */
export default function PrintPreview({ open, onClose, children, actions, title = 'Print preview', openWindow, hidePrint, fileName }: {
  open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode; title?: string; openWindow?: boolean; hidePrint?: boolean; fileName?: string;
}) {
  const el = document.getElementById('print-portal')!;
  const doc = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    el.classList.add('open');
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    const t = openWindow ? window.setTimeout(() => { void document.fonts.ready.then(() => doc.current && openPrintWindow(doc.current, title, fileName ?? title)); }, 400) : undefined;
    return () => { el.classList.remove('open'); window.removeEventListener('keydown', h); clearTimeout(t); };
  }, [open, el, onClose, openWindow]); // eslint-disable-line
  if (!open) return null;
  return createPortal(
    <>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-navy px-5 py-3 text-white shadow-lg">
        <span className="font-semibold">{title}</span>
        <div className="flex flex-wrap gap-2">
          {actions}
          {!hidePrint && <button className="btn-primary" onClick={() => doc.current && openPrintWindow(doc.current, title, fileName ?? title)}><ExternalLink size={16} /> Print / Save PDF</button>}
          <button className="btn border border-white/20 text-white hover:bg-white/10" onClick={onClose}><X size={16} /> Close</button>
        </div>
      </div>
      <div ref={doc} className="py-8 print:py-0">{children}</div>
    </>,
    el,
  );
}

/** For flows that save first and then want the print window for a document already in the preview. */
export function printPortalContent(): HTMLElement | null {
  return document.querySelector('#print-portal .py-8');
}

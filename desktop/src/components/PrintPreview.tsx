import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';

/**
 * Renders A4 documents into #print-portal (outside #root). On screen it is a preview overlay;
 * when printing, #root is hidden and only the A4 pages are sent to the printer / "Save as PDF".
 */
export default function PrintPreview({ open, onClose, children, actions, title = 'Print preview' }: { open: boolean; onClose: () => void; children: ReactNode; actions?: ReactNode; title?: string }) {
  const el = document.getElementById('print-portal')!;
  useEffect(() => {
    if (!open) return;
    el.classList.add('open');
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => { el.classList.remove('open'); window.removeEventListener('keydown', h); };
  }, [open, el, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 bg-navy px-5 py-3 text-white shadow-lg">
        <span className="font-semibold">{title}</span>
        <div className="flex flex-wrap gap-2">
          {actions}
          <button className="btn-primary" onClick={() => window.print()}><Printer size={16} /> Print A4 / Save PDF</button>
          <button className="btn border border-white/20 text-white hover:bg-white/10" onClick={onClose}><X size={16} /> Close</button>
        </div>
      </div>
      <div className="py-8 print:py-0">{children}</div>
    </>,
    el,
  );
}

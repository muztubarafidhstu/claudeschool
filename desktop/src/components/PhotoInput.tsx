import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2, Circle } from 'lucide-react';
import { Modal } from './ui';

/** Resize to a passport-style 300×360 JPEG (~20–30 KB) so 2,000 students stay fast in SQLite. */
function toSmallJpeg(src: CanvasImageSource, sw: number, sh: number) {
  const W = 300, H = 360, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const scale = Math.max(W / sw, H / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return c.toDataURL('image/jpeg', 0.82);
}

export default function PhotoInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <div className="grid h-[120px] w-[100px] shrink-0 place-items-center overflow-hidden rounded-lg border-2 border-dashed border-line bg-slate-50">
        {value ? <img src={value} className="h-full w-full object-cover" /> : <ImagePlus className="text-slate-300" />}
      </div>
      <div className="flex flex-col gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Browse image file</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setCam(true)}><Camera size={14} /> Live webcam capture</button>
        {value && <button type="button" className="btn-ghost btn-sm text-bad" onClick={() => onChange(null)}><Trash2 size={14} /> Remove</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0]; if (!f) return;
        const img = new Image();
        img.onload = () => { onChange(toSmallJpeg(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
        img.src = URL.createObjectURL(f);
        e.target.value = '';
      }} />
      {cam && <WebcamModal onClose={() => setCam(false)} onCapture={(v) => { onChange(v); setCam(false); }} />}
    </div>
  );
}

function WebcamModal({ onClose, onCapture }: { onClose: () => void; onCapture: (v: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false })
      .then((s) => { stream = s; if (video.current) { video.current.srcObject = s; void video.current.play(); } })
      .catch((e) => setErr(`Camera unavailable: ${e.message}`));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  return (
    <Modal open onClose={onClose} title="Live webcam capture" width="max-w-xl"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!!err} onClick={() => { const v = video.current!; onCapture(toSmallJpeg(v, v.videoWidth, v.videoHeight)); }}><Circle size={14} /> Capture photo</button></>}>
      {err ? <p className="text-sm text-bad">{err}</p> : <video ref={video} className="w-full rounded-lg bg-black" playsInline muted />}
    </Modal>
  );
}

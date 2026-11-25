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

function cameraError(e: any): string {
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. On Windows open Settings → Privacy & security → Camera, turn ON "Camera access" and "Let desktop apps access your camera", then press Try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Connect a webcam (or check the cable), then press Try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is being used by another program (Zoom, Teams, Camera app…). Close it, then press Try again.';
    default:
      return `Camera could not start (${e?.message ?? e}). Press Try again, or use "Browse image file".`;
  }
}

function WebcamModal({ onClose, onCapture }: { onClose: () => void; onCapture: (v: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(''); setReady(false);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setErr('This computer does not support camera capture. Use "Browse image file".'); return; }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
        };
        let stream: MediaStream;
        try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
        catch (e: any) {
          if (e?.name !== 'OverconstrainedError') throw e;
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // fall back to any camera/resolution
        }
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = video.current!;
        v.srcObject = stream;
        await new Promise<void>((res) => { if (v.readyState >= 1) res(); else v.onloadedmetadata = () => res(); });
        await v.play();
        // Some webcams deliver black frames for a moment — wait for real dimensions.
        const t0 = Date.now();
        while ((!v.videoWidth || !v.videoHeight) && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 100));
        if (cancelled) return;
        if (!v.videoWidth) throw Object.assign(new Error('The camera did not send a picture.'), { name: 'NotReadableError' });
        setReady(true);
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (!cancelled) setDevices(list);
      } catch (e) {
        if (!cancelled) setErr(cameraError(e));
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId, attempt]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const capture = () => { const v = video.current!; setShot(toSmallJpeg(v, v.videoWidth, v.videoHeight)); };

  return (
    <Modal open onClose={onClose} title="Live webcam capture" width="max-w-2xl"
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        {shot
          ? <><button className="btn-ghost" onClick={() => setShot(null)}>Retake</button><button className="btn-primary" onClick={() => onCapture(shot)}>Use this photo</button></>
          : <button className="btn-primary" disabled={!ready} onClick={capture}><Circle size={14} /> {ready ? 'Capture photo' : 'Starting camera…'}</button>}
      </>}>
      {devices.length > 1 && !shot && (
        <label className="mb-3 block"><span className="label">Camera</span>
          <select className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Default camera</option>
            {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </select></label>
      )}
      {err ? (
        <div className="space-y-3 rounded-lg bg-red-50 p-4 text-sm text-bad">
          <p>{err}</p>
          <button className="btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </div>
      ) : shot ? (
        <div className="flex justify-center"><img src={shot} className="h-[360px] w-[300px] rounded-lg border border-line object-cover" /></div>
      ) : (
        <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg bg-black">
          <video ref={video} className="h-full w-full -scale-x-100 object-cover" playsInline muted autoPlay />
          {/* passport-photo guide (5:6) */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-[86%] -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-dashed border-white/80" style={{ aspectRatio: '5 / 6' }} />
          {!ready && <div className="absolute inset-0 grid place-items-center text-sm text-white/80">Starting camera…</div>}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">Keep the face inside the dashed frame. The saved photo is cropped to passport size.</p>
    </Modal>
  );
}

import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';

/** Logo picker: resizes to max 320 px PNG (keeps transparency) so A4 headers stay sharp and the database small. */
export function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('This file is not a picture.'));
    img.src = URL.createObjectURL(file);
  });
}

export default function LogoInput({ value, onChange, dark }: { value: string | null | undefined; onChange: (v: string | null) => void; dark?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => ref.current?.click()} className={`grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-dashed ${dark ? 'border-white/30 bg-white/5' : 'border-line bg-slate-50'} hover:border-brand`}>
        {value ? <img src={value} className="h-full w-full object-contain" /> : <ImagePlus className={dark ? 'text-white/50' : 'text-slate-300'} />}
      </button>
      <div className="text-xs text-slate-500">
        <button type="button" className="font-semibold text-brand hover:underline" onClick={() => ref.current?.click()}>{value ? 'Change logo' : 'Upload logo'}</button>
        {value && <button type="button" className="ml-3 inline-flex items-center gap-0.5 text-bad hover:underline" onClick={() => onChange(null)}><X size={12} /> Remove</button>}
        <div>PNG or JPG — printed on every receipt and certificate</div>
      </div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) onChange(await readLogo(f)); e.target.value = ''; }} />
    </div>
  );
}

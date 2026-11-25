'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GraduationCap, Lock } from 'lucide-react';
import { api, setToken } from '@/lib/api';

export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { token } = await api<{ token: string }>('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      setToken(token);
      router.replace('/');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F172A] p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold"><GraduationCap className="text-[#0D9488]" /> ScholarDesk Pro — Subscription Control</div>
        <div><label className="label">Password</label><input className="input" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {err && <p className="text-sm text-[#EF4444]">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}><Lock size={16} /> {busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

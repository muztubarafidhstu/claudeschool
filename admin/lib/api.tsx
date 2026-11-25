'use client';
// Same-origin by default (panel and API are served together at https://scool.rafid5.com).
export const API = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sd_owner_token');
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem('sd_owner_token', t);
  else localStorage.removeItem('sd_owner_token');
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${getToken() ?? ''}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401 && !path.startsWith('/admin/login')) {
    setToken(null);
    window.location.href = '/login/';
    throw new Error('Session expired');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const fmtBdt = (n: number | string | null | undefined) => `৳${Number(n ?? 0).toLocaleString('en-IN')}`;
export const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export type SchoolRow = {
  id: string; name: string; name_bn: string | null; contact_person: string | null; phone: string | null; email: string | null;
  address: string | null; district: string | null; notes: string | null;
  license_id: string; license_key: string; product?: 'SCHOOL' | 'COACHING'; status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'PENDING'; source?: string; requested_at?: string | null; requested_plan?: string | null; students_estimate?: number | null; billing_cycle: string; price_bdt: number;
  valid_until: string; max_students: number; machine_id: string | null; last_seen_at: string | null; last_app_version: string | null;
  last_student_count: number | null; suspend_reason: string | null; payment_notice: string | null; is_past_due: boolean;
};

export function effectiveStatus(s: Pick<SchoolRow, 'status' | 'is_past_due'>) {
  return s.status === 'ACTIVE' && s.is_past_due ? 'EXPIRED' : s.status;
}

export const PRODUCT_LABEL: Record<string, string> = { SCHOOL: 'School', COACHING: 'Coaching' };
export function ProductTag({ product }: { product?: string | null }) {
  const p = product ?? 'SCHOOL';
  return <span className={`badge ${p === 'COACHING' ? 'bg-violet-50 text-violet-700' : 'bg-teal-50 text-teal-700'}`}>{PRODUCT_LABEL[p] ?? p}</span>;
}

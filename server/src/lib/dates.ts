export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Adds months/years to a YYYY-MM-DD date, clamping to month end. */
export function addPeriod(dateIso: string, cycle: 'MONTHLY' | 'YEARLY' | 'LIFETIME' | 'TRIAL', count = 1): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (cycle === 'LIFETIME') return '2099-12-31';
  if (cycle === 'TRIAL') { d.setUTCDate(d.getUTCDate() + 14 * count); return d.toISOString().slice(0, 10); }
  const months = cycle === 'YEARLY' ? 12 * count : count;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

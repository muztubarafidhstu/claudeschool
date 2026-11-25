import { getConfig, setConfig } from './config';

export type PinKind = 'settings' | 'modify';
const DEFAULTS: Record<PinKind, string> = { settings: '0000', modify: '5555' };

async function hash(pin: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`scholardesk-pin:${pin}`));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkPin(kind: PinKind, pin: string) {
  const stored = await getConfig<Record<string, string>>('pins', {});
  return (stored[kind] ?? (await hash(DEFAULTS[kind]))) === (await hash(pin));
}

export async function changePin(kind: PinKind, current: string, next: string) {
  if (!/^\d{4}$/.test(next)) throw new Error('PIN must be exactly 4 digits.');
  if (!(await checkPin(kind, current))) throw new Error('Current PIN is incorrect.');
  const stored = await getConfig<Record<string, string>>('pins', {});
  await setConfig('pins', { ...stored, [kind]: await hash(next) });
}

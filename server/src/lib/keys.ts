import crypto from 'node:crypto';

// Unambiguous alphabet (no 0/O/1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function block(n: number) {
  const bytes = crypto.randomBytes(n);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** e.g. SCH-2026-7KQ4-M9XD */
export function generateLicenseKey(year = new Date().getUTCFullYear()) {
  return `SCH-${year}-${block(4)}-${block(4)}`;
}

// Usage: node scripts/hash-password.mjs "YourPassword"  -> value for the ADMIN_PASSWORD_HASH secret
import { webcrypto } from 'node:crypto';

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node scripts/hash-password.mjs "YourPassword"');
  process.exit(1);
}
if (pw.length < 10) console.error('WARNING: short passwords are easy to guess (login is rate-limited).');

const iterations = 20000;
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
const bits = new Uint8Array(await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
const b64 = (u) => Buffer.from(u).toString('base64');
console.log(`pbkdf2$${iterations}$${b64(salt)}$${b64(bits)}`);

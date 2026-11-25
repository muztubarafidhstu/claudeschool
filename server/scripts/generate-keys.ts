import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('keys');
fs.mkdirSync(dir, { recursive: true });
const priv = path.join(dir, 'license_private.pem');
if (fs.existsSync(priv) && !process.argv.includes('--force')) {
  console.error('keys/license_private.pem already exists. Use --force to overwrite (this invalidates every installed app!).');
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
fs.writeFileSync(priv, privateKey, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'license_public.pem'), publicKey);
const desktopKey = path.resolve('../desktop/src-tauri/keys/license_public.pem');
fs.mkdirSync(path.dirname(desktopKey), { recursive: true });
fs.writeFileSync(desktopKey, publicKey);
console.log('Generated RSA-2048 keypair in server/keys and copied the public key into desktop/src-tauri/keys/.');
console.log('KEEP license_private.pem SECRET. Back it up offline.');

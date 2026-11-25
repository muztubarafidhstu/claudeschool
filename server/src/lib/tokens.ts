import { SignJWT, importPKCS8, jwtVerify } from 'jose';
import { config } from './config.js';

const privateKey = await importPKCS8(config.privateKeyPem, 'RS256');

export interface GraceClaims {
  sub: string;          // license key
  mid: string;          // bound machine id
  sch: string;          // school id
  name: string;         // school name
  vu: string;           // valid_until (YYYY-MM-DD)
  st: 'ACTIVE';
}

/** RS256 token the desktop app verifies offline with the embedded public key. */
export async function signGraceToken(c: GraceClaims, nowSec: number, validUntil: string): Promise<{ jwt: string; exp: number }> {
  // Never let the offline window run past the paid subscription end (end of that UTC day).
  const subEnd = Math.floor(Date.parse(`${validUntil}T23:59:59Z`) / 1000);
  const exp = Math.min(nowSec + config.graceDays * 86400, subEnd);
  const jwt = await new SignJWT({ ...c })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'sd-license-1' })
    .setIssuer('scholardesk-license-server')
    .setAudience('scholardesk-desktop')
    .setIssuedAt(nowSec)
    .setNotBefore(nowSec - 300)
    .setExpirationTime(exp)
    .sign(privateKey);
  return { jwt, exp };
}

export async function signAdminSession(email: string) {
  return new SignJWT({ role: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(config.adminJwtSecret);
}

export async function verifyAdminSession(token: string) {
  const { payload } = await jwtVerify(token, config.adminJwtSecret, { algorithms: ['HS256'] });
  if (payload.role !== 'owner') throw new Error('bad role');
  return payload;
}

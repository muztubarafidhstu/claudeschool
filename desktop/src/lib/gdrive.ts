/**
 * Google Drive backup — OAuth2 for installed apps (loopback redirect + PKCE), `drive.file` scope only:
 * the app can only see files/folders it created itself.
 */
import { getConfig, setConfig } from './config';
import { httpFetch, invoke, isTauri, openExternal } from './platform';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? ''; // "Desktop app" clients: not a real secret per Google docs
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'ScholarDesk_Backups';

interface DriveAuth { refresh_token: string; access_token: string; expires_at: number; email?: string; folder_id?: string }

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const driveConfigured = () => isTauri && !!CLIENT_ID;
export const getDriveAuth = () => getConfig<DriveAuth | null>('gdrive', null);
export const disconnectDrive = () => setConfig('gdrive', null);

export async function connectDrive(): Promise<DriveAuth> {
  if (!driveConfigured()) throw new Error('Google Drive is not configured in this build (VITE_GOOGLE_CLIENT_ID).');
  const { listen } = await import('@tauri-apps/api/event');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const port = await invoke<number>('start_oauth_listener');
  const redirect = `http://127.0.0.1:${port}`;

  const codeP = new Promise<string>(async (resolve, reject) => {
    const timer = setTimeout(() => { un(); reject(new Error('Google sign-in timed out.')); }, 300_000);
    const un = await listen<{ code?: string; state?: string; error?: string }>('oauth-callback', (e) => {
      clearTimeout(timer); un();
      if (e.payload.error || !e.payload.code) return reject(new Error(e.payload.error ?? 'Sign-in cancelled'));
      if (e.payload.state !== state) return reject(new Error('OAuth state mismatch'));
      resolve(e.payload.code);
    });
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  Object.entries({ client_id: CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  await openExternal(url.toString());
  const code = await codeP;

  const res = await httpFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }).toString(),
  });
  const tok = await res.json();
  if (!res.ok) throw new Error(tok.error_description ?? 'Token exchange failed');
  const auth: DriveAuth = { refresh_token: tok.refresh_token, access_token: tok.access_token, expires_at: Date.now() + tok.expires_in * 1000 - 60_000 };
  await setConfig('gdrive', auth);
  return auth;
}

async function accessToken(): Promise<{ token: string; auth: DriveAuth }> {
  const auth = await getDriveAuth();
  if (!auth) throw new Error('Connect Google Drive first.');
  if (Date.now() < auth.expires_at) return { token: auth.access_token, auth };
  const res = await httpFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: auth.refresh_token, grant_type: 'refresh_token' }).toString(),
  });
  const tok = await res.json();
  if (!res.ok) throw new Error('Google session expired — please reconnect Google Drive.');
  const next = { ...auth, access_token: tok.access_token, expires_at: Date.now() + tok.expires_in * 1000 - 60_000 };
  await setConfig('gdrive', next);
  return { token: next.access_token, auth: next };
}

async function folderId(token: string, auth: DriveAuth): Promise<string> {
  if (auth.folder_id) return auth.folder_id;
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await httpFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { authorization: `Bearer ${token}` } })).json();
  let id: string | undefined = found.files?.[0]?.id;
  if (!id) {
    const created = await (await httpFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    })).json();
    id = created.id as string;
  }
  await setConfig('gdrive', { ...auth, folder_id: id });
  return id;
}

export async function uploadBackup(fileName: string, json: string) {
  const { token, auth } = await accessToken();
  const parent = await folderId(token, auth);
  const boundary = 'sd' + Math.random().toString(36).slice(2);
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fileName, parents: [parent], mimeType: 'application/json' })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const res = await httpFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` }, body,
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error?.message ?? 'Upload failed');
  return out as { id: string; name: string; size: string; createdTime: string };
}

export async function listBackups() {
  const { token, auth } = await accessToken();
  const parent = await folderId(token, auth);
  const q = encodeURIComponent(`'${parent}' in parents and trashed=false`);
  const r = await (await httpFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=30&fields=files(id,name,size,createdTime)`, { headers: { authorization: `Bearer ${token}` } })).json();
  return (r.files ?? []) as { id: string; name: string; size: string; createdTime: string }[];
}

export async function downloadBackup(id: string) {
  const { token } = await accessToken();
  const r = await httpFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error('Download failed');
  return r.json();
}

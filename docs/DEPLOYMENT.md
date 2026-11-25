# Part 2 — Build, connect to your domain & sell ScholarDesk Pro

Replace `yourdomain.com` everywhere with your real domain.

## 0. What you need

| Item | Why | Cost |
|---|---|---|
| Domain (e.g. `scholardesk.com.bd`) | `api.` and `admin.` sub-domains | ~৳1,500/yr |
| Supabase project (or any PostgreSQL 14+) | License database | Free tier is fine at first |
| A Node host for the API: Render / Railway / Fly.io / a ৳600/mo VPS | Runs `server/` | $0–7/mo |
| Static host for the admin panel: Vercel / Netlify / Cloudflare Pages | Runs `admin/out` | Free |
| A Windows PC (or GitHub Actions) + optionally a Mac | Build `.exe` / `.dmg` | Free with Actions |
| (Recommended) Windows code-signing certificate | Removes the SmartScreen “Unknown publisher” warning | $100–300/yr |
| Google Cloud project | Drive backup OAuth client | Free |

## 1. Generate your secrets (do once, keep them safe forever)

```bash
cd server && npm install
npm run keys                                   # RSA keypair for the 7-day grace token
npm run hash-password -- "Your-Strong-Owner-Password"
openssl rand -hex 48                           # ADMIN_JWT_SECRET
cd ../desktop && npm install && npx tauri signer generate -w ~/.tauri/scholardesk.key   # updater signing key
```

* `server/keys/license_private.pem` signs every school's offline token. **If it leaks, anyone can forge licenses; if you lose it, every installed app locks after 7 days.** Store it in a password manager and an offline backup.
* `npm run keys` also copies the **public** key to `desktop/src-tauri/keys/license_public.pem`. That copy is compiled into the app and must match the server.
* Paste the updater **public** key into `desktop/src-tauri/tauri.conf.json → plugins.updater.pubkey`.

## 2. Database (Supabase)

1. Create a project at supabase.com and pick the Singapore or Mumbai region (closest to Bangladesh).
2. Go to **Project Settings → Database → Connection string → URI**, then copy it into `DATABASE_URL` and set `DATABASE_SSL=true`.
3. Apply the schema, either with `npm run migrate` from `server/` or by pasting `server/db/schema.sql` into the Supabase SQL editor.

## 3. Deploy the API → `https://api.yourdomain.com`

**Option A — Render / Railway (easiest):** create a Web Service from the repo with root directory `server`.
Build command `npm ci && npm run build`, start command `npm start`. Add the env vars from `server/.env.example`.
Put the private key in `LICENSE_PRIVATE_KEY_PEM` and the public key in `LICENSE_PUBLIC_KEY_PEM` (newlines as `\n`).
Then add the custom domain `api.yourdomain.com` and create the CNAME it asks for.

**Option B — VPS with Docker + Nginx:**
```bash
docker build -t scholardesk-api ./server
docker run -d --name sd-api --restart=always --env-file server/.env \
  -v /srv/scholardesk/keys:/app/keys:ro -v /srv/scholardesk/releases:/app/releases \
  -p 127.0.0.1:8080:8080 scholardesk-api
```
Nginx `server { server_name api.yourdomain.com; location / { proxy_pass http://127.0.0.1:8080; proxy_set_header X-Forwarded-For $remote_addr; } }`, then run `certbot --nginx -d api.yourdomain.com`.

Check it: `curl https://api.yourdomain.com/api/v1/health` should return `{"ok":true,...}`.

## 4. Deploy the admin panel → `https://admin.yourdomain.com`

```bash
cd admin && npm install
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api/v1 npm run build   # outputs ./out (static)
```
Upload `out/` to Vercel, Netlify or Cloudflare Pages, or import the repo with root `admin` and set the same env var.
Add the domain `admin.yourdomain.com` and make sure `CORS_ORIGINS` on the API includes `https://admin.yourdomain.com`.
It works on your phone: you can turn a school's software ON/OFF from anywhere.

## 5. Google Drive backup (optional but a strong selling point)

1. In console.cloud.google.com, create a project and enable the **Google Drive API**.
2. Set up the **OAuth consent screen** as External, with the scope `.../auth/drive.file`. Publish the app; `drive.file` is a non-sensitive scope, so no Google security review is needed.
3. Go to **Credentials → Create OAuth client ID → Desktop app**. Copy the client ID and secret into `desktop/.env` as `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_SECRET` (or into the CI secrets).

## 6. Build the desktop installers

Point the app at your domain:
* `desktop/.env`: `VITE_LICENSE_API=https://api.yourdomain.com/api/v1`
* `desktop/src-tauri/tauri.conf.json`: update the CSP `connect-src` and the updater endpoint (both already use `api.yourdomain.com`), plus the `identifier`.
* `desktop/src-tauri/capabilities/default.json`: HTTP allow-list.

**Locally (Windows):** install the Rust toolchain and the WebView2 runtime (Windows 10+ already has it), then:
```bash
cd desktop
set TAURI_SIGNING_PRIVATE_KEY=<contents of ~/.tauri/scholardesk.key>
npx tauri build            # → src-tauri/target/release/bundle/nsis/ScholarDesk Pro_1.0.0_x64-setup.exe (+ .msi, .sig)
```
**macOS:** run `npx tauri build --target universal-apple-darwin` to get a `.dmg`. For distribution outside the App Store, sign and notarize with an Apple Developer ID ($99/yr). Otherwise users must right-click and choose Open.

**Automated (recommended):** push a tag such as `git tag v1.0.1 && git push --tags`.
`.github/workflows/release-desktop.yml` builds Windows and macOS installers into a draft GitHub Release, including `latest.json`.

## 7. Ship auto-updates

1. Bump `version` in `desktop/package.json`, `desktop/src-tauri/tauri.conf.json` and `desktop/src-tauri/Cargo.toml` (and `APP_VERSION` in `desktop/src/lib/license.ts`).
2. Build. Upload the installers somewhere public (GitHub Release, S3, or the `releases/` folder served by your API host).
3. Put `latest.json` in the API's `RELEASES_DIR`:
```json
{ "version": "1.0.1", "notes": "Bug fixes", "pub_date": "2026-12-01T00:00:00Z",
  "platforms": {
    "windows-x86_64": { "url": "https://…/ScholarDesk.Pro_1.0.1_x64-setup.exe", "signature": "<contents of the .sig file>" },
    "darwin-universal": { "url": "https://…/ScholarDesk.Pro.app.tar.gz", "signature": "<.sig>" } } }
```
On the next launch, every school PC calls `GET /api/v1/updates/{target}/{arch}/{current}`, asks the user, installs and restarts.

## 8. Day-to-day: selling & controlling a school

1. **New customer:** in the admin panel open **Schools → + New School License** and fill in the name, phone, plan (Monthly/Yearly/Trial) and price. You get a key like `SCH-2026-7KQ4-M9XD`.
2. **Install:** send the installer. On first launch the school enters the key. The PC is bound to its hardware ID, and a second PC using the same key is refused (`MACHINE_MISMATCH`).
3. **Onboard:** choose Start fresh, Import demo data (for sales demos), or Upload a settings config made at another branch.
4. **Payment received** (bKash/Nagad/bank): open the school, use **Record subscription payment**, and enter the amount and cycles. The expiry extends and the license reactivates. The school's app picks this up within 15 minutes, or right away with **Verify Payment & Sync Online Now**.
5. **Non-payment:** press **Turn OFF software**. Within ≤15 minutes on an online PC, or at the next launch, the app shows the full-screen **Subscription Payment Required** screen with your payment instructions (edit them in **Settings**). A PC that never goes online locks when its 7-day signed token expires.
6. **School changes PC:** use **Reset PC binding** and then activate on the new PC. Data moves with **Backup → Restore** (Google Drive or local file).
7. **Monitoring:** the dashboard shows active, suspended and expiring licenses, revenue, and per-school heartbeats with app version, student count and clock skew. A large skew suggests clock tampering.

### Suggested pricing (Bangladesh private-school market)
| Plan | Students | Price |
|---|---|---|
| Starter | ≤ 300 | ৳800/month or ৳8,000/year |
| Standard | ≤ 1,000 | ৳1,500/month or ৳15,000/year |
| Pro | ≤ 2,000 + all modules | ৳2,500/month or ৳25,000/year |
| One-time setup + training | — | ৳3,000–5,000 |

Set `max_students` per license. The app reports its student count on every heartbeat and shows an upgrade notice above the limit.

## 9. Security checklist before your first sale
- [ ] Your own RSA keys generated; test keys from development discarded; private key backed up offline.
- [ ] `ADMIN_PASSWORD_HASH` set from a strong password; `ADMIN_JWT_SECRET` is random.
- [ ] API reachable only over HTTPS; `CORS_ORIGINS` lists only your admin domain.
- [ ] Updater signing key generated and stored safely; pubkey in `tauri.conf.json`.
- [ ] Change the default PINs (`0000` / `5555`) together with each school during onboarding.
- [ ] Windows installer code-signed (recommended) so SmartScreen trusts it.

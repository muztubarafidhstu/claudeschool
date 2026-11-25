# Go live at https://scool.rafid5.com

One service runs **both** the subscription control panel (`https://scool.rafid5.com`) and the license API the
desktop app talks to (`https://scool.rafid5.com/api/v1`). Login is password-only.

You need three things. Each takes about 5 minutes.

## 1. Free database (Supabase)
1. Sign up at https://supabase.com and create a **New project**. Choose region **Singapore** and save the database password.
2. Open **Project Settings → Database → Connection string → URI**. Copy it and put your database password into it.
   This is your `DATABASE_URL`.

## 2. Hosting (Render)
1. Sign up at https://render.com with your GitHub account.
2. Choose **New → Blueprint**, then the repository **claudeschool** (branch `main`, after merging the pull request).
   Render reads `render.yaml` and creates the service `scholardesk-scool`.
3. When it asks for values, fill:
   * `DATABASE_URL` from step 1
   * `ADMIN_PASSWORD_HASH`, `LICENSE_PRIVATE_KEY_PEM` and `LICENSE_PUBLIC_KEY_PEM`: copy each line from the private file
     **render-secret-env.txt** (sent to you separately, never put it in GitHub).
4. Press **Apply**. When the deploy shows **Live**, the panel works at the `onrender.com` address Render shows you.
   The database tables are created automatically.

The `starter` plan ($7/month) is always on. The `free` plan also works, but it sleeps after 15 minutes, so the first
connection takes about a minute.

## 3. Domain (rafid5.com DNS)
1. In Render, open **Settings → Custom Domains**. `scool.rafid5.com` is already listed. Render shows a target such as
   `scholardesk-scool.onrender.com`.
2. Where you bought rafid5.com (Namecheap / GoDaddy / Cloudflare…), add a DNS record:
   **Type** `CNAME`, **Name** `scool`, **Value** the Render target.
3. Wait 5–30 minutes. Render issues the HTTPS certificate automatically.
4. Open https://scool.rafid5.com and sign in with your password.

## 4. Build the real (licensed) Windows installer
GitHub → **Actions → Windows installer → Run workflow** → mode **licensed** → **Run**.
After about 12 minutes, download **ScholarDesk-Pro-Licensed-Windows** from the run's Artifacts.

## Daily use
* **New school:** in the panel choose **Schools → + New School License**, then give the school the key.
  The school installs the app and enters the key once, while online.
* **Turn OFF / ON:** use the red **Turn OFF** or green **Activate** button. An online school PC follows within 15 minutes.
* **Payment received:** open the school, then **Record subscription payment**. This extends the date and turns it ON again.

## Security notes
* `license_private.pem` signs every school's license. Keep a copy offline. Never upload it to GitHub.
* A 4-digit password can be guessed. The server allows only 5 wrong tries per 15 minutes per device, and locks all logins for
  1 hour after 30 wrong tries. A longer password is still much safer. To change it, run
  `npm run hash-password -- "NewPassword"` in `server/` and replace `ADMIN_PASSWORD_HASH` on Render.

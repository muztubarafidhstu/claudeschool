# How the ScholarDesk website runs (school.rafid0.com)

## In one picture

```
 Windows app (schools / coaching)            You (browser)
            │  HTTPS                              │ HTTPS
            ▼                                     ▼
 ┌──────────────────── Cloudflare (free plan) ─────────────────────┐
 │  DNS for rafid0.com  ──►  school.rafid0.com  (custom domain)     │
 │                                │                                 │
 │              Worker "scholardesk-cloud"                          │
 │      ├─ /api/v1/*  → license server code (cloud/src, Hono)       │
 │      └─ everything else → admin panel files (admin/out, static)  │
 │                                │                                 │
 │              D1 database "scholardesk" (SQLite)                  │
 │      schools · licenses · payments · heartbeats · settings       │
 └──────────────────────────────────────────────────────────────────┘
```

No server, no VPS and no monthly bill. Cloudflare runs the code and keeps the database.

## The pieces

| Piece | What it is | Where in the repo |
|---|---|---|
| Domain | `rafid0.com`, registered at Spaceship, **nameservers point to Cloudflare** (so Cloudflare manages all DNS) | — |
| Portfolio | `rafid0.com` itself still points to InfinityFree (a DNS record in Cloudflare, *DNS only*) | not in this repo |
| License server (API) | Cloudflare **Worker** `scholardesk-cloud`, written with Hono + TypeScript | `cloud/src/index.ts` |
| Owner panel (website) | Next.js app exported as **static files**, served by the same Worker | `admin/` → built into `admin/out` |
| Database | Cloudflare **D1** `scholardesk` (SQLite in the cloud) | tables: `cloud/migrations/*.sql` |
| Settings | `cloud/wrangler.toml`: name, custom domain `school.rafid0.com`, D1 binding, static files folder | `cloud/wrangler.toml` |
| Secrets (not in git) | `ADMIN_PASSWORD_HASH`, `LICENSE_PRIVATE_KEY`, `LICENSE_PUBLIC_KEY` stored in Cloudflare (Worker → Settings → Variables and Secrets) | keep offline copies safe |
| HTTPS certificate | Automatic (Cloudflare creates it for the custom domain) | — |

## How a request is handled
1. Someone opens `https://school.rafid0.com/…` or the app calls `https://school.rafid0.com/api/v1/verify-license`.
2. Cloudflare DNS sends it to the Worker.
3. If the path is a file of the admin panel (HTML/JS/CSS), Cloudflare serves it directly. This is free and doesn't count as a Worker request.
4. If the path is `/api/v1/...`, the Worker code runs. It reads and writes the D1 database and answers in JSON. Licenses are signed with the private key (RS256), and the app checks them with the public key built into it.

## How to update it
From the repo, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set in the terminal:

```bash
cd admin && npm ci && npm run build          # rebuild the panel → admin/out
cd ../cloud && npm ci
npx wrangler d1 migrations apply scholardesk --remote   # only when a new migrations/*.sql was added
npx wrangler deploy                                      # uploads code + panel, live in ~10 s
```

To roll back, open Cloudflare dashboard → Workers & Pages → scholardesk-cloud → Deployments → pick an older version → Rollback.

## Free-plan limits (more than enough for hundreds of schools)
- Workers: 100,000 requests per day. A school's app checks in about every 15 minutes, which is roughly 100 requests per PC per day.
- Static files (the panel): free and unlimited.
- D1: 5 GB storage, 5 million row reads and 100,000 row writes per day.
- Yearly cost: only the **rafid0.com renewal**.

## Monthly owner checklist
- Panel → Settings → **Download license backup**.
- Keep `license_private.pem` and the admin password safe offline. If the private key is lost, every installed app locks within 7 days.

---

# Adding another website on another subdomain (e.g. `shop.rafid0.com`)

Each subdomain can be its own Worker, completely separate from ScholarDesk. Use a **new folder or a new repo**, and **never reuse** the name `scholardesk-cloud` or the database `scholardesk`.

### A) Static website (HTML/CSS/JS, React/Vite/Next static export)
`wrangler.toml` in the new project:
```toml
name = "shop-site"                       # new, unique Worker name
compatibility_date = "2024-11-01"
workers_dev = false
routes = [ { pattern = "shop.rafid0.com", custom_domain = true } ]

[assets]
directory = "./dist"                     # your built site folder (Vite: dist, Next export: out)
not_found_handling = "single-page-application"   # or "404-page" for a normal multi-page site
```
Then run:
```bash
npx wrangler deploy
```
Cloudflare creates the DNS record and HTTPS for `shop.rafid0.com` automatically.

### B) Website with a backend and database
Same as A, plus a `main = "src/index.ts"` Worker for `/api/*` and its **own** D1 database:
```bash
npx wrangler d1 create shop-db          # copy the printed database_id into wrangler.toml
```
```toml
main = "src/index.ts"
[[d1_databases]]
binding = "DB"
database_name = "shop-db"
database_id = "<id printed above>"
```

### Rules so nothing breaks
- Pick a subdomain that is **not already in Cloudflare DNS**. Taken now: `school.rafid0.com` and the portfolio records for `rafid0.com` / `www`.
- One Worker per subdomain. Don't add the new domain to `cloud/wrangler.toml`.
- The same API token works for all Workers on the account. Never put the token in a repo, especially a public one.
- Secrets for the new site: `npx wrangler secret put NAME`, run in the new project folder.
- Before buying anything else: Cloudflare's free plan covers this. Other choices are Cloudflare Pages (connect a GitHub repo and it deploys on every push), or Vercel/Netlify with a CNAME record.

# FloraSetu — Production Deployment Guide

Architecture: **Netlify** hosts the web app (`apps/web`, static Vite build) on `florasetu.com` · **Render** hosts the API (`apps/api`, NestJS on Node 20) plus managed **PostgreSQL 15 + PostGIS** and **Redis** on `api.florasetu.com` · **GoDaddy** holds the DNS for `florasetu.com`.

The repo is pre-configured: `render.yaml` (Render blueprint) and `netlify.toml` (Netlify build + SPA fallback + `/api` proxy) are committed at the root. Follow the steps in order.

---

## Part 1 — Render: API + PostgreSQL + Redis (~10 min)

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New + → Blueprint**.
2. Connect GitHub and select the **FloraSetu repository**. Render detects `render.yaml` and shows three resources: `florasetu-api` (web service), `florasetu-db` (PostgreSQL 15), `florasetu-redis`. Click **Apply**.
3. When prompted for `sync:false` values, enter:
   - `ADMIN_EMAIL` — your owner email (e.g. nagesh.kgpl@gmail.com)
   - `ADMIN_PASSWORD` — a **new strong password** (not the dev one)
4. Wait for all three resources to deploy. The first API deploy may fail its health check until Part 2 is done — that's expected.

### Enable PostGIS + pgcrypto (one-time, required)

1. Render dashboard → **florasetu-db** → **Connect** → copy the **External Database URL** (starts `postgresql://`).
2. Open the database's **Shell** tab in Render (or any psql client) and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   ```

### Run migrations + seeds (one-time)

Easiest from this Emergent workspace (it has Node + network access). Paste the External Database URL into these commands and run them here — or ask E1 (the chat agent) to run them for you:

```bash
cd /app/apps/api
export DATABASE_URL="<PASTE EXTERNAL DATABASE URL>"
export REDIS_URL="<PASTE REDIS INTERNAL URL>"   # only needed if a seed touches redis
NODE_ENV=production node scripts/migrate.js up
NODE_ENV=production ADMIN_EMAIL="<owner email>" ADMIN_PASSWORD="<owner password>" npx ts-node -r dotenv/config seed/seed.ts dotenv_config_path=.env.production
NODE_ENV=production npx ts-node -r dotenv/config seed/catalog-seed.ts dotenv_config_path=.env.production
```

> NEVER run `seed:phase2` (demo personas) in production, and never set `CATALOG_ALLOW_DEMO_MASTERS` — the API refuses to boot with it in production by design.

### Custom domain for the API

Render dashboard → **florasetu-api → Settings → Custom Domains** → add `api.florasetu.com`. Render shows a CNAME target like `florasetu-api.onrender.com` — you'll point GoDaddy at it in Part 4. SSL is automatic.

---

## Part 2 — Netlify: web app (~5 min)

1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project → GitHub** → pick the FloraSetu repo.
2. Netlify reads `netlify.toml` automatically (build command, publish dir, redirects). Nothing to configure.
3. **Environment variables** (Site settings → Environment variables): none required — `apps/web/.env.production` already sets `VITE_API_URL=https://api.florasetu.com/api`. If you ever host the API elsewhere, set `VITE_API_URL` here instead (it overrides the file).
4. Deploy. You get a temporary URL like `random-name.netlify.app`.

### Custom domain

Netlify → **Domain management → Add a domain** → `florasetu.com`. Netlify shows its load-balancer IP for the apex record (currently `75.2.60.5`) — verify the value it displays and use it in Part 4. Also add `www.florasetu.com`.

---

## Part 3 — GoDaddy DNS (florasetu.com)

GoDaddy → My Products → florasetu.com → **DNS → Manage**. Delete any conflicting A/CNAME records, then add:

| Type | Name | Value | Purpose |
|---|---|---|---|
| `A` | `@` | `75.2.60.5` *(confirm the IP Netlify shows you)* | apex → Netlify |
| `CNAME` | `www` | `<your-site>.netlify.app` | www → Netlify |
| `CNAME` | `api` | `florasetu-api.onrender.com` | API → Render |

Propagation: usually 5–30 minutes (up to 48h worst case). Netlify and Render each auto-provision SSL once DNS resolves.

---

## Part 4 — Verification checklist

1. `https://api.florasetu.com/api/health` → 200 OK.
2. `https://florasetu.com` → FloraSetu homepage (not a placeholder).
3. Log in with the owner account you seeded → workspace loads.
4. Browser devtools → Network: all `/api/*` calls go to `api.florasetu.com` and return 2xx (no CORS errors).
5. Refresh a deep link (e.g. `/login`) → page still loads (SPA fallback working).

---

## Production caveats (known, documented in the PRD)

- **Free tier limits**: Render free web services sleep after ~15 min idle (≈50 s cold start) and free PostgreSQL **expires after 30 days** — upgrade `florasetu-db` to Starter (~$7/mo) before it lapses, and upgrade the web service to Starter (~$7/mo) when you want always-on.
- **Media uploads are ephemeral** (OD-03): KYB docs / lot photos are written to the API's local disk, which Render wipes on every redeploy. Wire S3-compatible object storage before real users upload.
- **Password-reset emails need a provider** (currently dev-token flow). Add SendGrid/Resend before public launch.
- **Auth tokens are the dev HMAC scheme** (OD-02) — acceptable for a closed pilot, plan OIDC before scale.
- Redis on the free plan has no persistence — it's used for rate-limiting/locks, so a restart only resets those (harmless).

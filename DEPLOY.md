# Deploying AI Sales Coach (production)

The production stack is **four containers on one Docker network** — `db`, `backend`,
`frontend`, and `caddy`. Only **Caddy** is exposed to the internet (80/443); it
terminates TLS (auto Let's Encrypt) and reverse-proxies:

- `https://<domain>/api/*` → `backend:8080` (API + BetterAuth)
- `https://<domain>/*` → `frontend:5173` (SolidJS dashboard)

App and API share one origin, so auth cookies are first-party, `Secure`, `SameSite=Lax`.

## Two topologies

- **A — Dedicated box:** our own Caddy owns 80/443. Use `docker-compose.prod.yml`.
  Follow the numbered steps below.
- **B — This ShipDeck box (shared edge):** `fanstart-edge-1` (Caddy) already owns
  80/443 and serves `fanstart.shipdeck.dev`. We route *through* it instead of
  conflicting. Use `docker-compose.shared-edge.yml` — see the section right below.

---

## Deploying on this box (shared platform edge)

This box is fronted by a shared, app-neutral **platform edge** at `/root/platform`
(`platform-edge-1`, Caddy, owns 80/443, auto Let's Encrypt). We route through it over the shared
external `web` network with stable aliases (`sc-backend` / `sc-frontend`) so we never collide with
any other app on `web`. **Read `/root/platform/README.md` first** — it is the source of truth for
hosting on this box. Public IP: **169.58.20.145**.

```bash
cd /root/ai-sales-coach

# 1. DNS (you): point sales-coach.shipdeck.dev  A -> 169.58.20.145 (DNS-only).

# 2. .env: set NODE_ENV=production, PUBLIC_APP_URL=https://sales-coach.shipdeck.dev,
#    PUBLIC_API_URL=https://sales-coach.shipdeck.dev, and a real OPENROUTER_API_KEY.

# 3. Shared network (once for the whole box) + our stack. No host ports — the edge reaches us by
#    alias. `web` is external and declared in our overlay, so it survives edge recreation (no more
#    manual `network connect`).
docker network create web    # no-op if it already exists
docker compose -f docker-compose.yml -f docker-compose.shared-edge.yml up -d --build

# 4. Seed the default rubric once (new signups copy it).
docker compose -f docker-compose.yml -f docker-compose.shared-edge.yml exec backend bun run seed

# 5. Route it: our drop-in already lives at /root/platform/conf.d/sales-coach.caddy. If you edit
#    it, reload the edge (zero downtime for every other app on the box):
docker exec platform-edge-1 caddy reload --config /etc/caddy/Caddyfile

# 6. Smoke-test over TLS:
curl -sS -o /dev/null -w '%{http_code}\n' --resolve sales-coach.shipdeck.dev:443:127.0.0.1 https://sales-coach.shipdeck.dev/
```

Adding or removing us touches no other app: our route is a self-contained drop-in and we join a
shared network the edge already watches — no appending to another app's Caddyfile, no manual
`network connect`. (The old `deploy/fanstart-edge-snippet.Caddyfile` is superseded by
`/root/platform/conf.d/sales-coach.caddy`.)

**Rollback (to the old per-app edge):** see the "Rollback" section of `/root/platform/README.md`;
it restores the `*.bak.pre-platform-edge` backups on both projects.

---

## 0. Prerequisites (on the box) — dedicated-box path (A)

- Docker Engine + the Compose plugin (`docker compose version`).
- A **domain** with a DNS **A record → the box's public IP**.
- Firewall/security-group **allows inbound 80 and 443** (80 is required for the
  Let's Encrypt HTTP challenge and the http→https redirect).
- Real secrets ready: an **OpenRouter API key**. (Per-tenant Fathom/Slack keys are
  entered later, in-app — they are not deploy-time secrets.)

## 1. Get the code onto the box

```bash
git clone <this-repo> ai-sales-coach && cd ai-sales-coach
# or rsync/scp the directory up.
```

## 2. Create `.env` (never commit it)

```bash
cp .env.example .env
```

Fill it in. Generate the three long secrets with `openssl rand -hex 32`:

```ini
# Postgres
POSTGRES_USER=ai_sales_coach
POSTGRES_PASSWORD=<openssl rand -hex 32>
POSTGRES_DB=ai_sales_coach

# App — PRODUCTION
NODE_ENV=production
PUBLIC_DOMAIN=your-domain.com
ACME_EMAIL=you@your-domain.com
PUBLIC_APP_URL=https://your-domain.com
PUBLIC_API_URL=https://your-domain.com

# Secrets
BETTER_AUTH_SECRET=<openssl rand -hex 32>
APP_ENCRYPTION_KEY=<openssl rand -hex 32>   # 32-byte hex; rotating it strands existing encrypted tokens
OPENROUTER_API_KEY=<your OpenRouter key>
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
```

`PUBLIC_APP_URL` / `PUBLIC_API_URL` **must be the `https://` domain** — BetterAuth
derives the cookie `Secure` flag and the CSRF origin from them, and the webhook URL
shown in Settings is built from `PUBLIC_API_URL`.

## 3. Bring up the production stack

Use the base file **plus the prod overlay** (do **not** include the dev override):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The backend runs pending SQL + auth migrations on boot. Watch Caddy obtain the cert:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f caddy
# look for: "certificate obtained successfully" for your domain
```

> Tip: define an alias so you don't retype the flags —
> `alias dcp='docker compose -f docker-compose.yml -f docker-compose.prod.yml'`

## 4. Seed the default tenant + rubric (once, first deploy only)

New signups copy their starting rubric from the **default tenant**, so it must exist:

```bash
dcp exec backend bun run seed        # idempotent — safe to re-run
```

## 5. Smoke-test the happy path over TLS

```bash
D=https://your-domain.com

# health
curl -s $D/api/health                                  # {"ok":true,"db":"up"}

# sign up (auto-provisions a tenant, sets the session cookie)
curl -s -c cookies.txt -X POST $D/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"name":"Owner","email":"owner@acme.com","password":"a-strong-password"}'

# who am I + my tenant
curl -s -b cookies.txt $D/api/me

# connect Fathom (encrypted at rest) and read back the webhook URL to paste into Fathom
curl -s -b cookies.txt -X POST $D/api/settings/integrations/fathom \
  -H 'Content-Type: application/json' -d '{"apiKey":"<real-fathom-key>"}'
curl -s -b cookies.txt $D/api/settings          # -> webhook_url

# after a real Fathom call posts to that webhook_url, the scorecard shows up:
curl -s -b cookies.txt "$D/api/calls"
curl -s -b cookies.txt "$D/api/calls/<id>"
```

An external port scan should now show **only 80 and 443** open — the API, frontend,
and Postgres are not reachable from the internet.

---

## Operations

- **Logs:** `dcp logs -f backend` (or `caddy`, `db`).
- **Update/redeploy:** `git pull && dcp up -d --build` (migrations run on boot).
- **Backup the database** (the `db_data` named volume):
  ```bash
  dcp exec db pg_dump -U ai_sales_coach ai_sales_coach > backup-$(date +%F).sql
  ```
- **DB shell:** `dcp exec db psql -U ai_sales_coach`.
- **Stop:** `dcp down` (data survives). `dcp down -v` **wipes the database** — don't.
- **Rotate a leaked secret:** replace it in `.env`, then `dcp up -d`. Rotating
  `APP_ENCRYPTION_KEY` invalidates all stored Fathom/Slack tokens (tenants reconnect).

## Notes

- **Rate limits:** the Fathom webhook is throttled to 120 req/min per client IP;
  BetterAuth throttles auth endpoints. `TRUST_PROXY=1` (set by the prod overlay) makes
  the backend read the real client IP from Caddy's `X-Forwarded-For`.
- **Frontend:** ships the Cloud Design dashboard UI. Wiring its screens to these live
  APIs (`backend/API.md`) is the pending integration step; the **API happy-path above
  is fully live** today regardless.
- **Scaling:** rate-limit state is in-memory (correct for one backend instance). Running
  multiple backend replicas would need a shared store (Redis) for the limiter.

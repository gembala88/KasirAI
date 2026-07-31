# Hermes

AI-powered wholesale & retail ERP platform. ERPNext is the single source of
truth for all business data; this repo is the application layer on top of it
(WhatsApp ordering, POS/scanning, owner analytics, dashboard). See the full
spec for architecture, data model, and roadmap — this README only covers
running what's in the repo right now (§10 Phases 0–1: foundation + core data
layer).

## What's here

**Phase 0 (foundation):**

- `apps/api` — Fastify + TypeScript modular monolith, split into the domain
  modules from the spec (`auth`, `sales-pos`, `inventory`,
  `customer-membership`, `whatsapp`, `ai-gateway`, `payment`, `notification`,
  `report-dashboard`, `media`). Each module is scaffolded as an empty
  boundary (`domain` / `application` / `infrastructure` / `interfaces`) with
  a placeholder route so the wiring is provable; real logic lands module by
  module in later phases.
- `infra/docker/docker-compose.yml` — ERPNext (Frappe) stack, tuned for a
  2 vCPU / 2 GB RAM VPS.
- `.github/workflows/ci.yml` — lint, format check, typecheck, test on every
  PR/push to `main`/`develop`.
- `apps/pwa-scanner`, `apps/dashboard`, `packages/shared-types`,
  `packages/ui-components` — folders exist per the spec's structure but are
  not implemented yet (see each folder's README for which phase owns it).

**Phase 1 (core data layer):**

- `apps/api/src/shared/erpnext-client` — the real shared ERPNext API client
  (§5), used by every module instead of calling ERPNext directly. Frappe
  REST API over token auth, wrapped in retry-with-backoff (3 attempts,
  exponential backoff, only for transient/5xx/429 failures — a 4xx like a
  validation error is never retried) and a circuit breaker (opens after 5
  consecutive transient failures, half-open retry after 10s) per the NFR
  "Resilience" requirement in §1.4.
- `apps/api/scripts/seed-erpnext.ts` — idempotent script that creates the
  Phase 1 ERPNext data model: `customer_tier` / `credit_limit` /
  `payment_term_days` Custom Fields on `Customer`, the Retail/Grosir/Member
  Price Lists, and the Pcs/Lusin/Karton UOMs with their conversion factors.

## Prerequisites

- Node.js >= 20
- Docker Desktop (or Docker Engine + Compose v2) with at least ~2 GB of
  memory available to containers
- Git

## Running the API locally

```bash
npm install
cp .env.example .env
npm run dev --workspace=apps/api
```

This starts the Fastify API on `http://localhost:3000` with `tsx watch`
(auto-restarts on file changes). Verify it's up:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/ai/_status
```

Every module exposes a `/api/v1/<module>/_status` placeholder — see
`apps/api/src/main.ts` for the full list.

Other useful scripts (run from the repo root, apply to all workspaces):

```bash
npm run lint         # eslint
npm run format       # prettier --write
npm run typecheck    # tsc --noEmit
npm run test         # vitest
```

## Running ERPNext locally

```bash
cd infra/docker
cp .env.example .env
# edit .env: set SITE_NAME, ADMIN_PASSWORD, DB_ROOT_PASSWORD
docker compose up -d
```

First boot creates the site (`create-site` service) and can take several
minutes — it's waiting on MariaDB/Redis to become healthy, then running
`bench new-site --install-app erpnext`. Watch progress with:

```bash
docker compose logs -f create-site
```

Once `create-site` exits with status 0, ERPNext is reachable at
`http://localhost:8080` (or whatever `HTTP_PUBLISH_PORT` you set). Log in
with user `Administrator` and the `ADMIN_PASSWORD` from your `.env`.

**First login:** the Setup Wizard asks for your business domain — pick
**Distribution** (closest fit for wholesale + retail). This hides
Manufacturing/Projects/HR-oriented menus from the Desk sidebar; HR itself is
unavailable regardless because only the `erpnext` app is installed, not the
separate `hrms` app (see `infra/docker/docker-compose.yml` header comment).

### Setting up the Phase 1 data model (custom fields, Price Lists, UOMs)

The seed script authenticates to ERPNext as a real user via API key/secret
token auth, not the shared `Administrator`/password login. Generate a key
pair once per environment:

```bash
cd infra/docker
docker compose exec backend bench --site "$SITE_NAME" execute frappe.core.doctype.user.user.generate_keys --args "['Administrator']"
```

This prints `{"api_key": "...", "api_secret": "..."}` — the secret is only
ever shown this once. Put both in the repo-root `.env` (`ERPNEXT_API_KEY`,
`ERPNEXT_API_SECRET`), then run:

```bash
npm run seed:erpnext --workspace=apps/api
```

Safe to re-run — it checks for each Custom Field/Price List/UOM/UOM
Conversion Factor before creating it, so nothing gets duplicated.

### What's tuned for the 2 vCPU / 2 GB RAM VPS (spec §13)

All applied in `infra/docker/docker-compose.yml` and
`infra/erpnext/mariadb/hermes-tuning.cnf`:

| Change                                                                    | Where                                     |
| ------------------------------------------------------------------------- | ----------------------------------------- |
| Gunicorn workers limited to 1                                             | `backend` service, `GUNICORN_WORKERS=1`   |
| `queue-long` + `queue-short` merged into one worker                       | `queue` service                           |
| Per-container memory limits (`mem_limit`) on every long-running container | every service                             |
| MariaDB InnoDB buffer pool capped at 128 MB, `performance_schema` off     | `infra/erpnext/mariadb/hermes-tuning.cnf` |
| Only `erpnext` app installed (not `hrms`)                                 | `create-site` service                     |

Steady-state container memory ceiling is ~1.6 GB, leaving headroom for the
host OS and the Node API. On the actual VPS, also run the swap setup script
once (see below) — it's a host-level change, not something Docker can do
from inside a container.

## Deploying to the VPS

1. Provision the VPS (2 vCPU / 2 GB RAM / 40 GB SSD, per spec §13), install
   Docker + Docker Compose v2.
2. Add the 2 GB swap safety buffer (one-time, requires root):
   ```bash
   sudo bash infra/erpnext/scripts/setup-vps-swap.sh
   ```
3. Clone this repo onto the VPS.
4. `cd infra/docker && cp .env.example .env` and fill in real
   `SITE_NAME`/`ADMIN_PASSWORD`/`DB_ROOT_PASSWORD` (not the same values as
   local dev).
5. `docker compose up -d` and confirm with `docker compose logs -f create-site`
   as above.
6. Monitor container memory with `docker stats` while exercising the app
   before considering it production-ready (spec §13's stated upgrade
   trigger: move to ≥4 GB RAM once the catalog exceeds ~5,000 SKUs, multiple
   concurrent cashiers are active, or response times degrade).
7. Building/deploying `apps/api` as a container (`infra/docker/Dockerfile.api`)
   and wiring the production Nginx reverse proxy
   (`infra/nginx/hermes.conf.template`) are Phase 9 (§10) work, once there's
   a dashboard/PWA to route to as well — not part of this Phase 0 setup.

## CI

`.github/workflows/ci.yml` runs on every PR/push to `main`/`develop`:
install → lint → format check → typecheck → test. All four run locally with
the `npm run` scripts above, so a green local run should mean a green CI run.

## Repository layout

See the spec §4 for the full annotated folder structure. Short version:
`apps/*` are deployable applications, `packages/*` are code shared between
them, `infra/*` is Docker/Nginx/ERPNext ops config, `docs/*` is
API docs + architecture decision records.

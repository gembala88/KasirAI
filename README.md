# Hermes

AI-powered wholesale & retail POS/ERP platform for Indonesian stores —
WhatsApp ordering with an AI assistant, an offline-capable cashier app,
warehouse scanning, and an owner dashboard, all built on top of
[ERPNext](https://erpnext.com/) as the single source of truth for real
business data (stock, invoices, customers, money).

## What Hermes is

A small wholesale/retail store (think: a _toko grosir_ selling by piece,
dozen, and carton, at different prices for walk-in/regular/member
customers) needs real inventory and accounting, a fast checkout, a way for
customers to order over WhatsApp, and an owner who can ask "how did we do
today?" without opening a spreadsheet. Hermes is that layer, built on top
of ERPNext rather than reinventing invoicing/accounting/stock from
scratch:

- **WhatsApp ordering with an AI assistant** — customers order, check
  stock/prices, and ask about their account over WhatsApp. The AI never
  invents numbers: every price, stock count, or order detail it states
  comes from a live ERPNext lookup, and any money-moving action is
  validated against real data before it's applied.
- **Cashier app (Kasir)** — fast checkout with tier pricing, split
  payments, and an offline-first design: sales and stock scans are
  recorded locally the instant they're confirmed, before the network is
  even touched, and sync automatically (exactly-once, no duplicates) once
  connectivity returns. Includes an offline product-catalog cache so a
  cashier can still search for and sell an item they haven't already
  looked up this session, even with zero connectivity.
- **Warehouse scanning** — barcode/QR-based stock in/out, transfers, and
  stock opname (physical count reconciliation), from an installable PWA.
- **Owner dashboard** — daily revenue/profit, best/worst sellers,
  low-stock and near-expiry alerts, piutang (accounts receivable)
  tracking with automatic reminders, payment confirmation, and a
  grounded "ask Hermes" chat over the store's own real data.
- **Manual-confirm payments** — QRIS, bank transfer, and COD, all
  reconciled by a human tapping "confirm," never auto-trusted from a
  WhatsApp message alone.

## Architecture at a glance

```
                    Internet
                       |
                    Nginx (reverse proxy, HTTPS)
                       |
       +---------------+----------------+------------------+
       |               |                |                  |
  apps/dashboard   apps/pwa-scanner   apps/api        ERPNext (Frappe)
  (owner/manager)  (Kasir + Gudang,   (Fastify)       — source of truth for
  React + Vite     offline-first,     |               all business data:
                    installable PWA)  +-- WhatsApp Cloud API (customer chat)
                                      +-- AI Gateway (Gemini / NVIDIA NIM /
                                      |    Mimo / OpenAI / Claude — multi-key
                                      |    failover, never trusted blind)
                                      +-- BullMQ (piutang reminders,
                                      |    retention cleanup) via its own
                                      |    Redis instance
                                      +-- SQLite (Hermes' own audit log,
                                           offline-sync queue receipts,
                                           WhatsApp conversation history —
                                           never a copy of ERPNext's data)
```

ERPNext (stock, invoices, customers, accounting) is the only place real
business data lives — `apps/api` never maintains a shadow copy of it.
Hermes' own SQLite database only holds _its_ data: audit trails, offline
sync-queue bookkeeping, and WhatsApp conversation history.

### Repository layout

```
apps/
  api/            Fastify + TypeScript backend — one module per business
                   domain (auth, sales-pos, inventory, customer-membership,
                   whatsapp, ai-gateway, payment, notification,
                   report-dashboard, sync, media)
  dashboard/       Owner/manager web app (React + Vite)
  pwa-scanner/     Cashier (Kasir) + warehouse scanning PWA (React + Vite,
                   offline-first via IndexedDB)
packages/          Reserved for code shared between apps/* — scaffolded,
                   not yet populated (see each folder's README)
infra/
  docker/          docker-compose.yml (ERPNext stack + all three apps),
                   Dockerfiles
  erpnext/         MariaDB tuning, VPS swap setup script
  nginx/           Reverse-proxy config template, logrotate config
  scripts/         Backup/restore scripts
  systemd/         Backup timer/service unit files (see README step 9)
docs/
  IMPLEMENTATION_LOG.md   Full phase-by-phase build history, technical
                          detail, and live-verification evidence
  architecture-decisions/ ADRs
RUNBOOK.md          Day-2 operations: restarts, logs, backups, rollback,
                     failure-mode playbook
DEPLOY_CHECKLIST.md  Pre-launch verification checklist (written against one
                     real deployment — treat as a template, re-verify every
                     item on a new one)
NOTES.md             Plain-language project history — what was decided and
                     why, no code required to follow it
BACKLOG.md           Deferred work, including the path toward a
                     productized multi-client offering
```

## Tech stack

- **Backend:** Node.js (TypeScript), Fastify, Zod validation, BullMQ +
  Redis for background jobs, `node:sqlite` for Hermes' own data.
- **Frontend:** React + Vite, installable as a PWA (`apps/pwa-scanner`).
- **Business data:** ERPNext (Frappe framework) — Docker Compose, MariaDB.
- **Infra:** Docker Compose (single VPS, no orchestrator), Nginx reverse
  proxy, Let's Encrypt (certbot), systemd timers for backups.
- **Testing:** Vitest, mocked-HTTP-boundary tests (no live ERPNext needed
  in CI). GitHub Actions runs lint/format/typecheck/test on every push.

## Project status

**Single-tenant per deployment.** Each client/store gets its own VPS, its
own ERPNext site, and its own copy of this codebase — there is currently
no multi-tenant routing or shared infrastructure between clients. This is
a deliberate choice while there's one real client: see
[BACKLOG.md](BACKLOG.md) for what a productized "new client setup" flow
looks like, and a note on Frappe's native multi-site support as a
possible lower-effort path to real multi-tenancy once there's demand for
it.

**What's implemented vs. not yet configured for a given deployment:**
WhatsApp ordering and the AI assistant require real Meta/WhatsApp
Business API and AI-provider credentials per client (see below) — the
code is built and tested, but each new store needs its own accounts.
Payment methods (QRIS image, bank account details) are also per-client
configuration, not code.

## Setting up Hermes for a new client

This walks through taking a brand-new store from nothing to a working
deployment. For deeper detail on any step, or to verify a completed
deployment, see [RUNBOOK.md](RUNBOOK.md) (day-2 operations) and
[DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) (verification checklist — copy
it and check off each item for the new deployment). A more automated
version of this walkthrough is a backlog item — see
[BACKLOG.md](BACKLOG.md).

### What you'll need before starting

- **A VPS**: minimum 2 vCPU / 2 GB RAM / 40 GB SSD (this is a hard floor,
  not a suggestion — see `infra/docker/docker-compose.yml`'s header
  comment for the memory budget). Any provider that gives you root SSH
  access works; this project has been deployed on both a dedicated VPS
  and (for smoke-testing) a shared one.
- **A domain name**, with the ability to point an A record at the VPS's
  IP (a free option like DuckDNS works fine, as does a normal registrar).
- **A WhatsApp Business Cloud API app** (optional at first, required for
  the WhatsApp ordering feature): a [Meta Developer](https://developers.facebook.com/)
  account, a Business App with the WhatsApp product added, a phone number
  registered to it, and a permanent access token. Meta's own WhatsApp
  Cloud API onboarding docs cover this — budget an hour, it involves
  Meta's business verification flow.
- **At least one AI provider API key** (for the WhatsApp/owner-chat AI
  assistant): [Google AI Studio](https://aistudio.google.com/) (Gemini,
  free tier) is the easiest to start with; NVIDIA NIM, Mimo, OpenAI, and
  Claude are also supported and can be added later — see
  `AI_PROVIDER_PRIORITY` in `.env.example`. None of this is required just
  to run the POS/inventory side of Hermes.
- **A QRIS static image and/or bank account details**, if the store wants
  those payment methods shown to customers (COD needs nothing extra).

### Steps

1. **Provision the VPS**, install Docker + Docker Compose v2, and add
   swap headroom:
   ```bash
   sudo bash infra/erpnext/scripts/setup-vps-swap.sh
   ```
2. **Point the domain's DNS** at the VPS's IP address.
3. **Clone this repo** onto the VPS (or `scp` a built copy — see
   RUNBOOK.md's "Rolling back a bad deploy" section for how deploys are
   actually pushed in practice, since there's no image registry yet).
4. **Configure environment files** — copy both `.env.example` files and
   fill in real values (never reuse another client's secrets):
   ```bash
   cp .env.example .env
   cp infra/docker/.env.example infra/docker/.env
   ```
   At minimum: a freshly generated `JWT_SECRET` (`openssl rand -base64
48`), a real `ADMIN_PASSWORD`/`DB_ROOT_PASSWORD` for ERPNext, and
   `CORS_ALLOWED_ORIGINS` set to the real domain (not `*`). Leave
   `ERPNEXT_API_KEY`/`ERPNEXT_API_SECRET`/`ERPNEXT_WEBHOOK_SECRET` for
   step 6. WhatsApp/AI-provider/payment values can stay empty until
   those features are wanted — the app runs fine without them (see
   "Project status" above).
5. **Bring up the ERPNext stack**:
   ```bash
   cd infra/docker && docker compose up -d
   docker compose logs -f create-site   # wait for exit status 0
   ```
   Log in to ERPNext at `http://<vps-ip>:8080` as `Administrator` with
   the `ADMIN_PASSWORD` you set. The Setup Wizard asks for a business
   domain — pick **Distribution** (closest fit for wholesale + retail).
6. **Generate an ERPNext API key/secret** for Hermes' own backend to
   authenticate with (not the shared Administrator login):
   ```bash
   docker compose exec backend bench --site "$SITE_NAME" execute \
     frappe.core.doctype.user.user.generate_keys --args "['Administrator']"
   ```
   Put the result in the repo-root `.env` (`ERPNEXT_API_KEY`,
   `ERPNEXT_API_SECRET`), set a real `ERPNEXT_WEBHOOK_SECRET` too, then
   run the seed script (safe to re-run; every step checks before
   creating anything):
   ```bash
   npm run seed:erpnext --workspace=apps/api
   ```
   This creates the Company/Warehouse/Price Lists/UOMs/Modes of
   Payment/Walk-in Customer and registers ERPNext's webhook
   subscriptions. **Rename the placeholder company** ("Toko Hermes") to
   the real store name in ERPNext (Setup > Company), and fill in the
   company address — it appears on printed receipts.
   **After renaming, you must also update `ERPNEXT_DEFAULT_COMPANY` in
   `.env` to the new name and restart the `api` container**
   (`docker compose up -d api`) — every Sales Invoice/Stock Entry the
   API creates is tagged with this exact company name, so a stale value
   here makes every new sale fail with "Cannot find Company" the moment
   the rename happens in ERPNext, even though nothing in the app code
   itself changed. (Confirmed live: this is exactly what happened on
   this project's own deployment.) `ERPNEXT_DEFAULT_WAREHOUSE` is safe
   to leave as-is — it's keyed by the company's abbreviation suffix
   (e.g. `- TH`), which a rename doesn't change.
7. **Set up HTTPS**: install Nginx and certbot on the VPS, use
   `infra/nginx/hermes.conf.template` as a starting point (fill in the
   real domain), then:
   ```bash
   sudo certbot --nginx -d <your-domain>
   ```
   Confirm auto-renewal with `certbot renew --dry-run`.
8. **Build and deploy the three app containers**:
   ```bash
   docker compose -f docker-compose.yml up -d --build api dashboard pwa-scanner
   ```
9. **Set up automated backups** — install the systemd unit files from
   `infra/systemd/` (read the comment at the top of
   `infra/systemd/hermes-backup.service` first: confirm `SITE_NAME`
   matches `infra/docker/.env`'s value on this box, and that
   `ExecStart`'s path matches where the repo is actually cloned):
   ```bash
   sudo cp infra/systemd/hermes-backup.* /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now hermes-backup.timer
   systemctl list-timers hermes-backup.timer   # confirm it's scheduled
   ```
   This runs `infra/scripts/backup.sh` daily (keeps daily/weekly/monthly
   tiers under `/opt/hermes-backups`; uses `bench backup --with-files`,
   not a hand-rolled mysqldump). See RUNBOOK.md's "Backups" section for
   how to check/trigger a run manually, and **test a real restore**
   before trusting it — `infra/scripts/restore.sh` has a `--verify-only`
   mode that restores onto a throwaway site rather than touching the
   real one; see RUNBOOK.md's "Backups" section for the exact invocation.
10. **If using WhatsApp ordering**: set the four `WHATSAPP_*` values in
    `.env`, then configure the same webhook URL
    (`https://<domain>/whatsapp/webhook`) and
    `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in the Meta App Dashboard. Both sides
    must match exactly or the verification handshake fails.
11. **Verify the deployment** using [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md)
    as a template — walk through every item against the new deployment,
    don't assume it matches the box that checklist was originally written
    against.
12. **Install the apps on store devices** — see RUNBOOK.md's "Store
    PC/tablet setup" section (Android/iOS/Windows, all via "Add to Home
    Screen" / "Install app", no app store involved).

## Local development

```bash
npm install
npm run typecheck   # all workspaces
npm run lint
npm test            # all workspaces
npm run dev --workspace=apps/api        # backend, :3000
npm run dev --workspace=apps/dashboard  # :5174
npm run dev --workspace=apps/pwa-scanner # :5173
```

You'll still need a local ERPNext instance (`infra/docker/docker-compose.yml`)
and a local `.env` — same setup steps 4–6 above, just pointed at
`localhost` instead of a VPS.

## Where to go next

| Question                                            | Read                                                     |
| --------------------------------------------------- | -------------------------------------------------------- |
| How do I set up a new client from scratch?          | This file, above                                         |
| How do I operate/troubleshoot a running deployment? | [RUNBOOK.md](RUNBOOK.md)                                 |
| Is this deployment actually ready to go live?       | [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md)               |
| What was decided and why, in plain language?        | [NOTES.md](NOTES.md)                                     |
| What's the full technical build history?            | [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md) |
| What's deferred/planned for later?                  | [BACKLOG.md](BACKLOG.md)                                 |

## License

Private/proprietary. Not currently licensed for public use or
redistribution.

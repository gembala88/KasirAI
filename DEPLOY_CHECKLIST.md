# Pre-Launch Checklist

Status as actually confirmed on the Phase 9 smoke-test deployment
(`43.128.68.124`) on 2026-08-03 — not a generic template, a real report
of what's done vs. outstanding on that specific box. Re-verify every
item again on whatever VPS is used for real go-live (see "Dedicated VPS"
below — this smoke-test box is not that VPS).

## Secrets & credentials

- [x] **`JWT_SECRET` is a real secret on the VPS, not the placeholder** —
  generated fresh via `openssl rand -base64 48`, confirmed different from
  local dev's value, confirmed the app boots (Phase 8's
  `assertProductionSafety` guard would refuse to start otherwise — and
  did correctly warn about the *other* item below, proving that guard is
  live and working).
- [x] **`ERPNEXT_API_KEY`/`ERPNEXT_API_SECRET`** — real, generated on this
  VPS's own fresh ERPNext site (`bench execute
  frappe.core.doctype.user.user.generate_keys`), not copied from local
  dev (local dev's key wouldn't work against a different site anyway).
- [x] **`ERPNEXT_WEBHOOK_SECRET`** — real, freshly generated.
- [x] **`DB_ROOT_PASSWORD` / `ADMIN_PASSWORD`** (ERPNext) — real, freshly
  generated, not the `.env.example` placeholders.
- [x] **AI provider keys** — `GEMINI_API_KEYS` and `NVIDIA_NIM_API_KEYS`
  copied from local dev (these are tied to external accounts, not to a
  specific ERPNext site, so reuse is correct here, unlike the ERPNext
  keys above). `MIMO_API_KEYS`/`OPENAI_API_KEYS`/`CLAUDE_API_KEYS` are
  empty on the VPS — **also empty locally**, so this isn't a deployment
  gap, it's the project's existing "gratis dulu" scope (§3.1) carried
  over correctly.
- [ ] **WhatsApp credentials** (`WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`,
  `WHATSAPP_APP_SECRET`) — **empty on the VPS, and empty locally too.**
  This project has never had real Meta/WhatsApp Business API credentials
  configured at any point — confirmed by checking, not assumed. Nothing
  to "sync between VPS and Meta" yet because nothing exists on either
  side. **Action needed from you:** create/configure a Meta App +
  WhatsApp Business API product, generate these four values, set them in
  `/opt/hermes-platform/.env` on the VPS, then set the *same*
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in Meta's App Dashboard webhook config
  — those two must match exactly, or the verification handshake
  (`GET /whatsapp/webhook`) will fail.
- [ ] **`QRIS_STATIC_IMAGE_URL`** — empty on both VPS and local. Needs a
  real hosted image URL of your actual QRIS code before the WhatsApp QRIS
  payment flow can show a real image (it would currently send nothing/a
  broken link).
- [x] **`SENTRY_DSN`** — confirmed empty on the VPS = Sentry reporting is
  simply off (this is the designed no-op behavior, not a bug — see
  README's Phase 8 section). Not a blocker, but you won't get error
  alerts until you set a real DSN.

## Network & domain

- [ ] **No domain is pointed at this VPS.** Nginx is installed, configured
  (`/etc/nginx/sites-available/hermes`), and confirmed working — but only
  tested via `curl http://localhost/...` *from inside the VPS itself*,
  because of the next item.
- [ ] **The VPS's cloud security group blocks everything except port 22
  (SSH)** — confirmed live: port 80 and port 8080 both time out from
  outside the box, while working instantly from inside it (`ufw` is
  inactive and the OS-level `iptables` rules allow everything — this is
  an *external*, cloud-console-level firewall, not something fixable via
  SSH). **Action needed from you:** open ports 80 and 443 (and only those
  — not 3001/5175/5176/6380/8080, which should stay internal, reached
  only through Nginx) in the VPS provider's security group / firewall
  console.
- [ ] **HTTPS (Let's Encrypt) not yet issued** — blocked on both items
  above (needs a real domain pointing here, *and* port 80 reachable for
  the ACME HTTP-01 challenge). certbot is installed and ready
  (`certbot --version` confirmed working); once DNS + firewall are in
  place, run `certbot --nginx -d <your-domain>` per the instructions at
  the top of `infra/nginx/hermes.conf.template`.

## Shared VPS vs. dedicated VPS

- [x] **Confirmed this VPS is shared with other live, unrelated projects**
  (`robin_darkpools`, `paybox-bot`) — found and reported before touching
  anything, per your explicit instruction. Hermes was deployed with a
  deliberately trimmed memory/CPU budget
  (`docker-compose.shared-vps-test.yml`) to coexist without touching
  those other projects, and is genuinely relying on swap to fit (~986 MB
  swap in use after deployment, up from ~399 MB before — confirmed via
  `free -h`, not estimated).
- [ ] **A dedicated VPS is required before real go-live** — as agreed:
  this smoke test proves the application stack itself works correctly,
  not that this specific shared box is fit for production traffic. When
  a dedicated VPS is ready, `docker-compose.yml`'s own (untrimmed)
  memory/CPU numbers are the correct ones to deploy with — see its
  in-file comment block — not the `-shared-vps-test.yml` override, which
  is specific to this one box.

## Store details on the printed receipt

- [ ] **Company address is currently blank** on the printed receipt's
  letterhead — confirmed live: the store name ("Toko Hermes") renders
  correctly, but the address line is empty because it was never entered
  in ERPNext. **Action needed from you:** in ERPNext, go to Setup >
  Company > (your company) and fill in the address, or edit the
  letterhead directly at Setup > Printing > Letter Head. No code change
  needed — the receipt (Print Format "Hermes Struk Kasir", seeded by
  `scripts/seed-erpnext.ts`) pulls whatever is there automatically.
- [x] Receipt content itself redesigned during the polish pass (compact,
  Indonesian-language, editable anytime in ERPNext's Print Format
  designer without touching code) — replaces ERPNext's own default
  full-page English invoice layout, which was real ERPNext content but
  the wrong shape for a quick retail receipt.

## Verified working (real evidence, not assumed)

- [x] Full stack deployed: ERPNext + MariaDB + Redis (×3) + Hermes API +
  dashboard + pwa-scanner, all containerized, all healthy.
- [x] Real login against the deployed stack returned a real JWT.
- [x] Nginx correctly routes `/`, `/scan/`, `/api/`, `/erp/`,
  `/webhooks/erpnext` (confirmed the last one returns 401 for an
  unsigned request — signature verification is live, not skipped).
- [x] Real backup taken (`bench backup --with-files`), real scheduled
  systemd timer confirmed firing (manually triggered the same service
  unit the timer invokes, confirmed `status=0/SUCCESS` in the journal).
- [x] Real restore proven usable: restored the backup onto a throwaway
  site, queried it, tore it down — not just "the file exists."
- [x] A real deployment-only bug was found and fixed live:
  `Dockerfile.api` used `node:20-alpine`, which doesn't have the
  `node:sqlite` built-in (needed since Phase 4) — the container
  crash-looped on every start until fixed to `node:22-alpine`. This had
  never been caught before because the image was never actually rebuilt
  and run since Phase 0.

## Not yet possible to verify (blocked on items above, not on Hermes' code)

- [ ] Public HTTPS URL reachability (needs domain + firewall, above).
- [ ] A real WhatsApp message hitting the deployed webhook (needs Meta
  credentials, above — the webhook *code* is deployed and its signature
  verification is confirmed working against a synthetic unsigned
  request, but no real Meta traffic has ever reached it, on this VPS or
  at any earlier point in this project).

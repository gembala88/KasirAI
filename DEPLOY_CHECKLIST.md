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
      did correctly warn about the _other_ item below, proving that guard is
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
      `/opt/hermes-platform/.env` on the VPS, then set the _same_
      `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in Meta's App Dashboard webhook config
      — those two must match exactly, or the verification handshake
      (`GET /whatsapp/webhook`) will fail.
- [ ] **`QRIS_STATIC_IMAGE_URL`** — empty on both VPS and local. Needs a
      real hosted image URL of your actual QRIS code before either the
      WhatsApp QRIS payment flow **or** the in-app Kasir "Menunggu
      Konfirmasi Pembayaran" screen (Group 2) can show a real QRIS image —
      both read this same one setting, so it's one fix for both. Until
      it's set, picking QRIS at checkout correctly shows "QRIS belum
      dikonfigurasi" and blocks confirming that payment, rather than
      showing a broken image.
- [ ] **`BANK_TRANSFER_BANK_NAME`/`_ACCOUNT_NUMBER`/`_ACCOUNT_NAME`** —
      already set on the VPS (`BCA` / `1234567890` / `Toko KasirAI`), but
      `1234567890` reads like a placeholder, not a real account number.
      **Action needed from you:** confirm this is the store's actual BCA
      account before a real cashier hands it to a real customer at
      checkout — same setting now drives both the WhatsApp transfer flow
      and the in-app Kasir "Menunggu Konfirmasi Pembayaran" screen (Group
      2).
- [x] **`SENTRY_DSN`** — confirmed empty on the VPS = Sentry reporting is
      simply off (this is the designed no-op behavior, not a bug — see
      README's Phase 8 section). Not a blocker, but you won't get error
      alerts until you set a real DSN.

## Network & domain

- [x] **Domain live**: `newpelangi.duckdns.org` (DuckDNS) points at this
      VPS — confirmed via DNS resolution and a real external HTTP request,
      not just from inside the box.
- [x] **Cloud firewall open**: ports 80/443 opened in the VPS provider's
      console (Tencent Cloud Lighthouse's Firewall panel — this VPS's actual
      provider, confirmed via the "Stargate" agent found in its crontab).
      Confirmed reachable from a genuinely external vantage point (not just
      `curl localhost` on the box itself).
- [x] **HTTPS (Let's Encrypt) issued and verified**: real certificate via
      `certbot --nginx -d newpelangi.duckdns.org`, confirmed with
      `openssl s_client` (not `curl -k`) showing a real Let's Encrypt-issued
      cert for the right domain, HTTP→HTTPS redirect confirmed (301), and
      auto-renewal confirmed via a real `certbot renew --dry-run` (systemd
      timer active, simulated renewal succeeded).
- [x] **Real browser logins verified through the actual domain** for both
      apps (dashboard and `/scan/`) — not just `curl`. This uncovered and
      fixed three real bugs invisible to every earlier curl-only check: an
      asset-path routing collision, a service-worker scope collision, and a
      doubled `/api/api/` login URL. See docs/IMPLEMENTATION_LOG.md's "Domain, HTTPS, and
      camera scanning" section for the full story.

## Shared VPS vs. dedicated VPS

- [x] **Confirmed this VPS is shared with another live, unrelated project**
      (`robin_darkpools`) — found and reported before touching anything, per
      your explicit instruction. A second unrelated project (`paybox-bot`)
      was also present but was later removed from this box at your explicit
      request (confirmed clean removal — PM2 process, `pm2 save`d so it
      doesn't resurrect on reboot, and its project directory deleted).
      `robin_darkpools` remains completely untouched throughout every change
      made to this VPS across every session. KasirAI was deployed with a
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

- [x] **Receipt now pulls store name/address/WhatsApp number/logo directly
      from ERPNext's own Company doctype**, not a Letter Head or any string
      in this codebase — confirmed live across all 3 templates below.
      **Action needed from you**, three fields, all in ERPNext at Setup >
      Company > Toko KasirAI:
  - **`Phone` (shows on the receipt as "No. WhatsApp Toko")** — fill this
    in with the store's real WhatsApp number. Currently blank, so the
    receipt correctly omits the line rather than showing "No. WhatsApp
    Toko: " with nothing after it — but it won't show at all until this
    is set.
  - **`Store Address (for receipt)`** — a new custom field just below the
    company logo field. Fill in the store's address for it to appear
    under the store name.
  - **`Company Logo`** — native ERPNext field; upload one for it to
    appear on the Detailed template (Minimal and Standard don't show a
    logo by design).
- [x] **3 receipt templates** (Minimal / Standard / Detailed — increasing
      branding/spacing) now exist as real ERPNext Print Formats ("KasirAI
      Struk Kasir", "KasirAI Struk Kasir - Minimal", "KasirAI Struk Kasir -
      Detail"), all created/kept in sync by `scripts/seed-erpnext.ts`.
      Selectable from the app's own Pengaturan screen (Owner/Manager only)
      or directly by editing Company's `Receipt Template` field in
      ERPNext — both write to the same field, so they can never drift out
      of sync with each other.
- [x] Receipt content itself redesigned during the polish pass (compact,
      Indonesian-language, editable anytime in ERPNext's Print Format
      designer without touching code) — replaces ERPNext's own default
      full-page English invoice layout, which was real ERPNext content but
      the wrong shape for a quick retail receipt.

## Verified working (real evidence, not assumed)

- [x] Full stack deployed: ERPNext + MariaDB + Redis (×3) + KasirAI API +
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

## Verified working — domain, HTTPS, camera scanning (real browser, not curl)

- [x] Public HTTPS URL reachability — `https://newpelangi.duckdns.org`
      loads for real from an external vantage point.
- [x] Real cashier login on `/scan/` and real owner login on `/`, both
      through the actual production HTTPS path, confirmed via network
      requests showing `200 OK` on fresh (not cached) login attempts.
- [x] Camera-based barcode scanning added to the warehouse screens only
      (Kasir intentionally keeps its USB/Bluetooth scanner text input, per
      spec §14). The scan button correctly triggers a real
      `getUserMedia`/`BarcodeDetector` attempt and handles a missing-camera
      error gracefully — verified as far as possible without a physical
      device (the automated test browser has no camera hardware). **Action
      recommended from you:** one quick real-phone check that the actual
      "allow camera access?" browser prompt appears and a real barcode
      scans correctly — this is the one thing that genuinely can't be
      verified without physical hardware.

## Not yet possible to verify (blocked on items below, not on KasirAI' code)

- [ ] A real WhatsApp message hitting the deployed webhook (needs Meta
      credentials, above — the webhook _code_ is deployed and its signature
      verification is confirmed working against a synthetic unsigned
      request, but no real Meta traffic has ever reached it, on this VPS or
      at any earlier point in this project).

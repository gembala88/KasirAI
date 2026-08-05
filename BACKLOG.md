# Backlog

Deferred work — not scheduled, not urgent, written down so it isn't lost.
Unlike RUNBOOK.md/DEPLOY_CHECKLIST.md (which describe what exists),
everything here is **not yet built**.

## Productized "new client setup"

Business direction (confirmed 2026-08-05): package Hermes seriously
enough to resell to other store clients later, but **not** as a full
multi-tenant SaaS yet — that's premature before there's a real second
client. The near-term goal is making per-client deployment fast and
repeatable (a productized install), not a bespoke one-off each time.

Confirmed (2026-08-05): each client gets their own fully isolated
VPS/domain/WhatsApp Business account/QRIS image/bank account — not shared
infrastructure between clients. The wizard below configures one isolated
deployment per run; it does not introduce any cross-client sharing.

**What this item is:** an interactive setup wizard (not just a checklist)
that walks through provisioning a fresh VPS + domain + ERPNext instance +
config for a brand-new store, based on everything learned deploying the
first one. README.md's "Setting up Hermes for a new client" section is
the current manual version of this walkthrough — this item is about
turning that into a guided, mostly-automated tool:

- **Interactive**: prompts the operator for the new client's specific
  values — VPS IP/hostname, domain name, store/company name, WhatsApp
  Business credentials (phone number ID, access token, webhook verify
  token, app secret), QRIS static image (file or URL), bank transfer
  details (bank name, account number, account name) — and writes them
  into the right places automatically: repo-root `.env`,
  `infra/docker/.env`, `infra/nginx/hermes.conf.template` (domain
  substitution), and the `infra/systemd/` unit files (`SITE_NAME`,
  install path) — rather than the operator hand-editing each file.
- Generates real random secrets itself (`JWT_SECRET`,
  `ERPNEXT_WEBHOOK_SECRET`, DB/admin passwords) instead of the current
  pattern of manually running `openssl rand` and pasting the result in.
- Does what README.md's steps 1–11 currently describe by hand: VPS
  provisioning checks, Docker install, ERPNext site creation, seed
  script run (with the per-client company/warehouse names it already
  collected, instead of seeding "Toko Hermes" and renaming after the
  fact), Nginx + certbot setup, systemd backup timer installation
  (`infra/systemd/`, added 2026-08-05), and WhatsApp webhook
  registration reminders.
- Consider whether the WhatsApp/AI-provider *account creation* steps
  (which happen on external dashboards, not in this codebase — creating
  the Meta Business App itself, generating an AI provider key) can be
  reduced to a guided checklist with direct deep-links even if they
  can't be fully scripted, since the wizard can't drive someone else's
  web UI.

**Investigate before building:** Frappe/ERPNext natively supports running
multiple isolated sites on one `bench` instance (`bench new-site`, one
site per client, same server/containers). If/when there's real demand for
a second client, this is worth evaluating as a lower-effort path to true
multi-tenancy — sharing infrastructure across clients while keeping each
site's data fully isolated — rather than building custom multi-tenant
routing/auth into Hermes' own `apps/api` from scratch. Not investigated
in depth yet; flagging the option so it's not rediscovered from zero
later.

## Offline product-catalog cache — possible follow-ups

Not required now, noted while building the cache (see
docs/IMPLEMENTATION_LOG.md for the full feature):

- Incremental (`since`-based) sync instead of full-replace, if a client's
  catalog ever grows large enough that a full re-pull becomes slow
  (full-replace was deliberately chosen for the first client's catalog
  size — see the code's own doc comments for the reasoning).
- Caching Grosir/Member tier pricing too (not just Retail), which would
  remove the "harga mungkin belum terbaru" staleness warning for
  registered customers — needs a design for how much extra data that adds
  to the offline cache per tier.

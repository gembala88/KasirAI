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

**What this item is:** a "new client setup" checklist/script that walks
through provisioning a fresh VPS + domain + ERPNext instance + config for
a brand-new store, based on everything learned deploying the first one.
README.md's "Setting up Hermes for a new client" section is the current
manual version of this walkthrough — this item is about turning that into
something more automated and less error-prone:

- A single setup script (or a small number of them) that does what
  README.md's steps 1–9 currently describe by hand: VPS provisioning
  checks, Docker install, `.env` generation (with real random secrets,
  not copy-pasted placeholders), ERPNext site creation, seed script run,
  Nginx + certbot setup, and — closing a real gap found while writing
  the README — the backup systemd timer/service unit files, which
  currently only exist hand-created on the one deployed VPS, not
  version-controlled or templated anywhere in this repo.
- A per-client config file (store name, domain, default company/warehouse
  names, price list names if they should differ from Retail/Grosir/
  Member) that the setup script reads, instead of the current pattern of
  manually renaming the seeded "Toko Hermes" placeholder after the fact.
- Consider whether the WhatsApp/AI-provider account creation steps (which
  involve external dashboards, not just this codebase) can be reduced to
  a guided checklist with direct deep-links, even if they can't be fully
  scripted.

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

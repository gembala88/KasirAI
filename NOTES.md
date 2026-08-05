# Notable Decisions & Bugs — plain-language running log

This is the non-technical version of the project history — what was
decided and why, and what real problems were found and fixed, written so
it's useful without reading code or git history. The technical version of
each phase (with code paths, exact commands, live-verification evidence)
is in [docs/IMPLEMENTATION_LOG.md](docs/IMPLEMENTATION_LOG.md); this file
is the "what actually happened and why does it matter" summary. New
entries get added to the bottom as work continues.

## Foundation & core setup (Phase 0-1)

- Built on **ERPNext**, an existing, mature open-source business system
  (inventory, invoicing, accounting), rather than writing all of that from
  scratch. Hermes is the layer on top: the AI assistant, WhatsApp,
  cashier/warehouse apps, and the owner dashboard — all built specifically
  for this store, all talking to ERPNext as the single source of truth for
  real business data (stock levels, sales, customers, money).
- Product units (Pcs, Lusin, Karton) and pricing tiers (Retail, Grosir,
  Member) were set up as real, standard ERPNext features, not custom
  workarounds — meaning they show up correctly in ERPNext's own reports
  too, not just inside Hermes.

## POS, inventory, WhatsApp, payments (Phase 2-6)

- The AI assistant (WhatsApp + owner chat) is deliberately built so it can
  **never invent numbers**. Every price, stock count, or order detail it
  states comes from a real, freshly-checked ERPNext lookup — the AI
  proposes an action, the system checks it's real and valid, then it's
  either auto-applied (safe reads) or held for a human confirm (money-
  moving actions), never taken purely on the AI's say-so.
- **Real bug found and fixed:** a payment-instruction message could, in
  rare cases, get a WhatsApp send failure mixed up with an invoice
  creation failure, because both were sharing one error-handling path —
  risking a confusing "did it work or not" state for a customer. Fixed,
  and flagged as a pattern to specifically check for on any future
  payment-related feature (the underlying mistake — treating two different
  failures as one — is an easy one to repeat by accident).
- **Real bug found and fixed:** live testing showed the AI could pick the
  wrong action for a payment request and then describe fake account
  details in its own reply, even though no real invoice existed yet. This
  was serious enough (a customer could be told to pay a made-up account)
  that it was fixed at the code level, not just by tweaking the AI's
  instructions — the system now always builds payment-instruction replies
  from real, verified facts, and separately scans any other reply for
  payment-detail-shaped text and blocks it if the AI tries to state
  account numbers on its own.

## Dashboard, login security (Phase 7-8)

- **Real bug found and fixed:** one of ERPNext's own numbers (labeled
  "gross profit" on each sale) turned out not to be reliably calculated by
  ERPNext itself — using it directly could have shown wrong profit figures
  on the dashboard. Switched to computing profit from the actual stock
  movement records instead, which are always accurate.
- **Real bug found and fixed:** a security feature meant to slow down
  repeated failed login attempts wasn't actually turned on, due to a small
  setup mistake — meaning unlimited login attempts were possible before
  the fix. Found and closed before go-live.
- The system now refuses to even start up in production if it detects a
  placeholder/example security key still in place, specifically to prevent
  an accidental real launch with default, guessable credentials.

## Checkout screen & offline resilience (pre-Phase 9)

- Discovered the cashier checkout screen didn't actually exist yet — only
  the warehouse stock-scanning tool and the backend logic behind checkout
  had been built. Confirmed with the store owner before building it for
  real, rather than assuming or quietly building something different than
  expected.
- **Real bug found and fixed:** a literal barcode scan at checkout didn't
  find the product, because the search only matched product *names*, not
  product *codes* (which is what a barcode actually is).
- Built real **offline support**: if the internet drops mid-sale, the sale
  is saved on the device instantly and finishes syncing automatically once
  the connection is back — tested for real by killing the network mid-
  checkout and confirming exactly one sale reached the system (not zero,
  not duplicated).
- **Real bug found and fixed:** the offline-saving feature could hang
  forever with no error message if an old browser tab was left open in the
  background — fixed so a leftover tab can no longer block anything.

## Going live — Phase 9 (production deployment)

- Deployed everything for real to a live server, not just tested locally.
- **Real bug found and fixed:** the server image was built on an older
  version of Node.js that didn't support a feature the app had been quietly
  relying on since an earlier phase — the server would have crash-looped on
  any fresh deployment. This had never been caught before because nothing
  had actually rebuilt that image from scratch until this phase.
- **Real bug found and fixed:** two webhook addresses (the ones ERPNext and
  WhatsApp use to notify Hermes about events) were missing from the
  server's routing rules entirely — they would have silently failed on
  real traffic.
- Set up automated daily backups, and proved they actually work by
  restoring one onto a throwaway copy of the system and checking the data
  came back correctly — not just confirming a backup file exists.
- The first deployment ended up sharing a server with two unrelated
  existing projects (a leftover from how the test server was originally
  set up). Handled carefully: checked what was already running before
  touching anything, asked before proceeding, and scoped Hermes down to
  fit without disturbing the other projects. This shared box was only ever
  meant as a functional test, not the real production setup — a dedicated
  server is needed before real customers use this.

## Cleanup & polish pass (2026-08-03)

- Removed the unrelated leftover project ("paybox-bot") from the test
  server at the store owner's explicit request, after confirming exactly
  what belonged to it and that nothing needed to be kept. The other
  unrelated project on that box (robin_darkpools) was explicitly left
  untouched throughout, as instructed.
- Added a weight-based unit ("Kg") for products sold by weight (like rice
  or sugar), ready for when those products are added — unlike the existing
  units (Pcs, Lusin, Karton), Kg correctly allows fractional amounts like
  0.5 kg.
- Added automatic 30-day cleanup for two kinds of data that are pure
  bookkeeping/logs, not real business records: the technical "receipt" of
  each offline sale once it's successfully synced (the real sale itself
  stays in ERPNext forever — this only removes the duplicate-safety log
  entry), and the raw technical logs the server and web server produce.
  Nothing about real sales, stock, invoices, customers, or WhatsApp
  conversation history is ever auto-deleted by anything in this system.
- **Real security gap found and fixed:** two internal services (the
  ERPNext admin panel and an internal database) were still reachable
  directly from outside the server, not just through the properly secured
  front door — a leftover from early testing that had gone unnoticed
  because the server's firewall was blocking outside access anyway at the
  time. Fixed to only be reachable the proper way, as a safety net
  independent of the firewall.

## Going live for real: domain, HTTPS, camera scanning (2026-08-03)

- The real domain (newpelangi.duckdns.org) and a real security certificate
  are now live. Confirmed the cloud firewall on the VPS's provider
  (Tencent Cloud Lighthouse) was the reason it took two rounds to actually
  open the right ports — the firewall itself was configured correctly the
  whole time, it just took a bit for the change to take effect.
- **This was the first time either app had ever actually been opened in a
  real web browser through the real website address** — every check
  before this used technical shortcuts that skipped past the exact path a
  real customer's or staff member's browser would take. That difference
  mattered: it uncovered three real, serious bugs that nothing before had
  caught, because nothing before had actually tried loading the real
  pages the real way.
  1. The warehouse scanning app was loading a blank page — it was
     accidentally pulling in the owner dashboard's files instead of its
     own, due to a technical path mismatch. Fixed.
  2. Once that was fixed, a second, sneakier problem showed up: a
     background caching feature (meant to make the apps work offline)
     could permanently "hijack" the warehouse app and keep serving the
     wrong content to any phone/computer that had ever opened the owner
     dashboard even once — this would have kept happening indefinitely
     until deliberately fixed, not something that fixes itself. Fixed.
  3. Once real pages were finally loading, logging in still failed — for
     both apps — because of a duplicated address in the login request.
     Also fixed.
  All three were re-tested for real afterward with genuinely fresh logins
  (not just reloading a page that already worked) — both apps' logins now
  work correctly through the real website address.
- Added real camera-based barcode scanning to the warehouse app only
  (not the cashier checkout screen, which keeps using a physical barcode
  scanner device, exactly as the original plan called for). Tested as far
  as technically possible without a real phone in hand: the scan button
  correctly asks the browser for real camera access every time, and shows
  a clear error message if no camera is available (which is what happened
  in this testing environment, since it doesn't have a physical camera
  attached) — recommend a quick one-time check on an actual phone to see
  the real "allow camera access?" prompt and confirm scanning works on a
  real barcode.

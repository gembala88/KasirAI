# Hermes

AI-powered wholesale & retail ERP platform. ERPNext is the single source of
truth for all business data; this repo is the application layer on top of it
(WhatsApp ordering, POS/scanning, owner analytics, dashboard). See the full
spec for architecture, data model, and roadmap — this README only covers
running what's in the repo right now (§10 Phases 0–7: foundation, core data
layer, POS + Inventory, Customer & Piutang, AI Gateway, WhatsApp
Integration, Payments, Dashboard & Owner Analytics).

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

**Phase 2 (POS + Inventory):**

- `apps/api/src/modules/sales-pos` — tier-aware product search/pricing
  (`GET /api/v1/products/search`, `GET /api/v1/products/:id/price`) and the
  POS transaction lifecycle (`POST /api/v1/pos/transactions`,
  `.../parked`, `.../:id/park`, `.../:id/payment` — split payment,
  auto-completes the sale once payments cover the total). Backed by
  ERPNext's `Sales Invoice` doctype (`is_pos=1`) rather than the dedicated
  `POS Invoice` doctype — see the module's doc comment for why.
- `apps/api/src/modules/inventory` — real-time cached stock reads
  (`GET /api/v1/products/:id/stock`, 30s TTL), stock opname with a variance
  report (`.../inventory/stock-opname`), scanner actions
  (`.../inventory/scan/{add-stock,reduce-stock,transfer}`), and low-stock /
  near-expiry alerts. Also owns `POST /webhooks/erpnext` — verifies
  Frappe's HMAC signature, invalidates the stock cache, and republishes
  every event on the shared event bus for other modules.
- `apps/api/scripts/seed-erpnext.ts` (extended) — also bootstraps what
  ERPNext requires before any Sales Invoice/Stock Entry can exist: a
  Company, Warehouse, Fiscal Year, Item Groups, Stock Entry Types, Modes of
  Payment — each posting to its own account (Cash to the Company's default
  cash account; QRIS and Bank Transfer to their own Bank-type accounts, for
  real reconciliation) — a "Walk-in Customer", and the `Webhook` records
  that make `/webhooks/erpnext` actually fire.
- `apps/pwa-scanner` — installable PWA (Vite + React) for scan actions,
  offline-first via an IndexedDB queue (`src/lib/offline-queue.ts`) that
  syncs automatically when connectivity returns.
- `@fastify/cors` on the API (`CORS_ALLOWED_ORIGINS` env var) — required
  for `apps/pwa-scanner` (and later `apps/dashboard`) to call the API from
  a browser at all; without it every cross-origin request is blocked
  before it reaches a route.

**Phase 3 (Customer & Piutang):**

- `apps/api/src/modules/customer-membership` — customer profile/membership
  (`GET /api/v1/customers/:id`, `POST /api/v1/customers` to register with a
  tier) and piutang (accounts receivable) tracking read live from ERPNext's
  Sales Invoice ledger — never a separate cache (§1.4 NFR "Data
  consistency"): `GET /api/v1/customers/:id/piutang` (outstanding invoices
  with due dates, overdue flag), `GET /api/v1/customers/:id/purchase-history`.
- Piutang reminder job (spec §7, §3.3) — a repeatable BullMQ job
  (`PIUTANG_REMINDER_CRON`, daily by default) that finds invoices due
  within `PIUTANG_REMINDER_DAYS_AHEAD` days across every customer, records
  each via the shared audit logger, and publishes `piutang.reminder_due` on
  the shared event bus. It does **not** send a WhatsApp message — that
  integration is §10 Phase 5 and doesn't exist yet; fabricating a send here
  would violate the same "never fabricate" principle the spec applies to
  the AI persona (§8.1). A future notification/whatsapp module subscribes
  to that same event to actually deliver it. Also exposed as
  `GET /api/v1/customers/piutang/due-reminders` (synchronous read, same
  query, for inspection) and `POST /api/v1/customers/piutang/check-reminders`
  (enqueues an immediate run through the real queue, for manual/ops
  triggering).
- `hermes-redis` — a new service in `infra/docker/docker-compose.yml`,
  separate from ERPNext's internal Redis instances, for the Node API's own
  BullMQ queues. Published to the host on port 6380 (`REDIS_URL`), since
  `apps/api` runs on the host, not in this compose file, until it's
  containerized in Phase 9.

**Phase 4 (AI Gateway):**

- `apps/api/src/modules/ai-gateway/providers` — real implementations for
  Mimo, Gemini, and NVIDIA NIM (§3.1's confirmed 5 providers, starting with
  the free-tier ones — OpenAI/Claude aren't implemented yet). NVIDIA NIM
  and Mimo share an OpenAI-compatible chat-completions client; Gemini uses
  Google's native `generateContent` shape. All hand-rolled with `fetch`, no
  SDK dependency, consistent with `shared/erpnext-client`.
- Two-level failover (`infrastructure/gateway.ts`): rotates through a
  provider's key pool before falling back to the next provider in
  `AI_PROVIDER_PRIORITY`. Key health is tracked in `hermes-redis`
  (`infrastructure/key-rotation.ts`, hashed keys only — never the raw key
  in Redis's keyspace) behind a `KeyHealthStore` interface, so the failover
  logic itself is unit-testable with an in-memory fake and needs no live
  Redis in CI. Every failover is recorded via the shared audit logger.
- Validation layer (`validation/index.ts`) — checks stock availability,
  price correctness (an AI-proposed price that doesn't match ERPNext's is
  always rejected, never trusted), and MOQ for Grosir tier (using Item's
  own `min_order_qty`) before any ERPNext write. Queries ERPNext directly
  rather than reaching into sales-pos/inventory's internals (§2.1/§3.3
  module boundaries).
- `ai_action_audit` table — Hermes' first "own database" table (§5).
  Uses Node's built-in `node:sqlite` (still experimental, but needs no
  native dependency and adds ~zero container memory) rather than a
  separate Postgres/MariaDB server — the confirmed 2 GB VPS budget was
  already tight after Phase 3's Redis addition. A single file at
  `apps/api/data/hermes.sqlite`, gitignored.
- `POST /api/v1/ai/action/propose` / `POST /api/v1/ai/action/:id/confirm`
  (§6): propose validates and persists to `ai_action_audit`, never
  touching ERPNext; confirm re-validates (stock/price may have moved since
  the proposal) and only then executes — creating and submitting a real
  ERPNext `Sales Order`. Starting with `propose_sales_order` as the one
  concrete action type.
- `POST /api/v1/ai/query` (§6) — a minimal endpoint that runs a prompt
  through the failover gateway and returns the raw response. Not the full
  owner-analytics chat (that needs live ERPNext data grounding, a later
  phase) — this is the concrete way to prove the provider/failover
  machinery reaches a real AI provider.

**Phase 5 (WhatsApp Integration):**

- `apps/api/src/modules/whatsapp/interfaces/webhook.routes.ts` — the real
  WhatsApp Cloud API webhook: `GET /whatsapp/webhook` handles Meta's
  verification handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`);
  `POST /whatsapp/webhook` verifies `X-Hub-Signature-256` (HMAC-SHA256 of
  the raw body, same `removeAllContentTypeParsers()` fix as the Phase 2
  ERPNext webhook needed) and dispatches each inbound text message.
- Hermes persona (`application/persona.ts`, §8) — a Bahasa Indonesia system
  prompt carried as a real `systemPrompt` on `AIRequest` (Gemini's native
  `systemInstruction`; the OpenAI-compatible client prepends a `system`
  message) rather than string-concatenated into the prompt. The model
  always answers with one JSON envelope, `{"reply": ..., "action": null |
  {...}}`; native LLM function-calling isn't used since the Phase 4
  provider abstraction doesn't carry tool schemas — a documented scope
  simplification, not an oversight.
- `application/conversation.ts` — `handleInboundMessage` runs up to two AI
  Gateway turns per inbound message: turn A can request real data via a
  structured `action`; if it does, this layer executes it for real
  (`application/actions.ts`) and calls the model again with the result as
  `system_data` so the final reply is grounded, never guessed. Every
  fact-shaped action result the model can see is real — including
  `check_stock`'s `{found: false}` vs `{found: true, matches: [...,
  {stockQty: 0}]}` distinction, added after live testing showed a
  small model conflating "no such product" with "out of stock" when both
  just looked like an empty/zero-quantity result.
- 7 conversation actions, each routed through the module that owns that
  data (never straight to ERPNext from `whatsapp`): `check_stock` /
  `check_price` (sales-pos), `propose_sales_order` (ai-gateway's Phase 4
  propose→confirm validated-action layer — proposed *and* confirmed in the
  same turn once the model judges the request unambiguous, unlike the
  AI Gateway's own two-call HTTP endpoints), `get_order_status` /
  `cancel_order` (new `ai-gateway/application/orders.ts`), and
  `get_purchase_history` (customer-membership).
- QRIS payment flow (§7): converts a confirmed Sales Order into a *draft*
  Sales Invoice (`sales-pos/application/transactions.ts`'s
  `createInvoiceFromSalesOrder`, `is_pos: 1` — found live that Frappe only
  honours the `payments` child table on submit when `is_pos` is set,
  regardless of sales channel) and sends the static QRIS image if
  `QRIS_STATIC_IMAGE_URL` is configured. Generalized into a
  method-agnostic `initiate_payment` action in Phase 6 alongside COD and
  Bank Transfer — see that section.
- `apps/api/src/shared/erpnext-queries` — `resolvePriceListForTier` /
  `lookupItemPrice` / `getStockQty` extracted here once a third module
  (whatsapp) needed the same ERPNext lookups sales-pos and ai-gateway's
  validator already had duplicated.
- Live-verified against the real ERPNext stack and a real NVIDIA NIM call
  (no Gemini/Mimo/OpenAI/Claude keys are configured yet, so NVIDIA NIM is
  the only provider actually exercised so far): a multi-turn WhatsApp
  conversation created and submitted a real Sales Order at the real
  ERPNext Grosir price even after the model stated a different, fabricated
  price earlier in the same conversation — the validated-action layer
  silently corrected it, which is the property this whole design exists
  to guarantee. `cancel_order` and the full QRIS initiate → confirm cycle
  (draft invoice → real payment posted → stock reduced) were verified the
  same way. Outbound WhatsApp sends attempt a real Graph API call and are
  handled gracefully when they fail (no `WHATSAPP_ACCESS_TOKEN` is
  configured yet) — a send is never faked as successful.
- Known limitation, not a code defect: free-tier small models (verified
  with NVIDIA NIM's `meta/llama-3.1-8b-instruct`) don't reliably pick the
  intended structured action from natural language even with explicit
  per-action trigger keywords in the prompt — e.g. it sometimes chose
  `get_order_status` for a message clearly about paying. The
  `initiate_qris_payment` code path itself was separately verified correct
  against real ERPNext; the gap is the small model's instruction-following,
  which a stronger/paid model would likely improve. `AI_PROVIDER_PRIORITY`
  reordering to test Gemini's reliability for this specifically is blocked
  on a real `GEMINI_API_KEYS` value — nothing has been reordered without
  that evidence.

**Phase 6 (Payments):**

- §10's Phase 6 line calls for "QRIS integration (via licensed aggregator —
  Midtrans/Xendit, since direct QRIS API access requires a licensed
  payment processor), COD/transfer flows." Only the COD/transfer half is
  built here — real aggregator integration (dynamic QR codes,
  webhook-based automatic payment confirmation) needs a real Midtrans or
  Xendit sandbox account, which doesn't exist yet; deferred by explicit
  project decision rather than assumed. Phase 5's static-image + manual
  QRIS confirmation stays as-is until then.
- `whatsapp/domain/index.ts`'s `initiate_qris_payment` action is now the
  method-agnostic `initiate_payment`, taking `{orderName, method: "qris" |
  "transfer" | "cod"}` — same underlying draft-invoice mechanics for all
  three, different customer-facing instructions
  (`application/actions.ts`): QRIS sends the static image if configured,
  Transfer sends the real bank details (`BANK_TRANSFER_BANK_NAME` /
  `_ACCOUNT_NUMBER` / `_ACCOUNT_NAME`) if configured, COD always sends a
  confirmation (no external config needed — it's just "pay the courier").
  Each method maps 1:1 to a real ERPNext Mode of Payment: qris→`QRIS`,
  transfer→`Transfer`, cod→`Cash` (COD *is* cash, just collected by the
  courier instead of at a till).
- `POST /api/v1/whatsapp/orders/:invoiceName/confirm-payment` now takes a
  required `method` alongside `phoneNumber`, validated against the same
  three values, so the owner/cashier confirms whichever method was
  actually used.
- Bug found and fixed via live testing (initial version of this phase):
  the payment-instruction send (QRIS image / bank details / COD text) was
  inside the *same* try/catch as the draft-invoice creation, so a
  WhatsApp send failure after a successful ERPNext write got mislabeled
  as `invoice_failed` — the exact masking bug already fixed once for
  `confirmPayment`, recurring here. This class of bug (independent
  outcomes sharing one try/catch) is worth checking for in any future
  payment-adjacent endpoint.
- **Payment-detail hardening** (`application/payment-reply.ts`) —
  structural, not prompt-level. Live testing found the model can pick the
  *wrong* action for a payment request (e.g. `get_order_status` instead
  of `initiate_payment`) and then invent account details in its freeform
  reply anyway; a stronger persona-prompt example reduced how often this
  happened but doesn't prevent it, and the cost of failure (a customer
  transferring money to a fabricated account) is worse than a wrong
  price. So, matching how price/stock correctness is already enforced
  outside the model's control:
  - `actions.ts`'s `initiate_payment` case no longer sends any WhatsApp
    message itself — it only creates the invoice and returns real facts
    (`invoiceName`, `grandTotal`, `method`).
  - `conversation.ts` is now the *only* place a payment-instruction
    reply is composed. Whenever this turn's action really was a
    successful `initiate_payment`, the customer-facing reply is always
    `buildPaymentInstructionReply(result)` — assembled from the real
    ERPNext write and real server config, never from the model's own
    turn text (there's no second AI turn at all in this path; the
    model's freeform reply for that turn is discarded outright, even if
    it happened to be correct).
  - Any other reply is scanned by `containsUnverifiedPaymentDetails`
    (Indonesian payment-detail keywords, or a bare 6+ digit run) before
    being sent. A match is blocked and replaced with a safe fallback
    ("sebentar ya kak, saya pastikan dulu...") rather than relayed —
    deliberately erring toward false positives, since an occasional
    over-cautious fallback is far cheaper than leaking a fabricated
    account number.
  - `test/whatsapp-conversation.test.ts` reproduces the original live
    failure with mocked AI responses (model picks `get_order_status`,
    then fabricates a transfer account number) and asserts the hardened
    path blocks it — not just that one prompt example happens to fix it.
    Also covers: a fabricated reply on the very first turn (no action at
    all), a successful payment's template overriding a deliberately
    wrong model reply, QRIS image delivery, and that an ordinary reply
    mentioning a short number is never blocked.
- Live-verified against real ERPNext: COD and Bank Transfer each ran the
  full cycle through a real WhatsApp conversation — draft invoice created
  with the real order total, owner-confirmed via the API, invoice
  submitted (`status: Paid`, correct `paid_amount`), real payment row
  posted to the method's real ERPNext account (`Cash - TH` for COD,
  `Bank Transfer - TH` for Transfer), stock reduced. QRIS re-verified
  working under the renamed `initiate_payment` action.
- `GEMINI_MODEL` fixed from `gemini-1.5-flash` (404s — deprecated) to
  `gemini-flash-latest`, found live once a real `GEMINI_API_KEYS` value
  was supplied — same kind of provider-catalog drift as Phase 4's NVIDIA
  NIM model fix. With a real Gemini key configured, `AI_PROVIDER_PRIORITY`
  (`mimo,gemini,nvidia,...`, unchanged) means Gemini — not NVIDIA NIM —
  became the active provider automatically, since Mimo has no key
  configured; this was **not** a deliberate reordering to run a
  comparison. Incidentally, the COD hardening regression check above ran
  against Gemini and picked `initiate_payment` correctly on the first
  attempt, unlike NVIDIA NIM's `meta/llama-3.1-8b-instruct` in earlier
  testing — a genuine but informal data point, not the systematic A/B
  comparison that's still pending explicit go-ahead.

**Phase 7 (Dashboard & Owner Analytics):**

- `apps/dashboard` — new Vite + React app (port 5174 in dev), the first
  real UI for `apps/api`'s data. Three views behind a tab bar: Ringkasan
  (Overview), Tanya Hermes (owner chat), Konfirmasi Pembayaran (the real
  UI for Phase 5/6's "API endpoint only, no UI" confirm-payment decision
  — that decision was for *that* phase, not permanent). Dark mode by
  default with a persisted light-mode toggle (`localStorage`), per §9.
  No auth/RBAC yet — `apps/api`'s `auth` module is still Phase 0's
  placeholder, so every dashboard view is unauthenticated for now; not
  requested this phase, called out here rather than silently assumed.
- `apps/api/src/modules/report-dashboard/application/queries.ts` — real
  ERPNext analytics (FR-6): today's revenue/profit, best/worst sellers
  and most-active-customer over a rolling 30-day window (a single day is
  too thin a sample), best supplier, near-out-of-stock and
  expiring-batch alerts (reusing inventory's own real queries via its
  interfaces barrel). `GET /api/v1/reports/dashboard-summary` bundles
  all of it in one call (matches §9's "card-based summary... at top");
  `GET /api/v1/reports/sales?from=&to=` is the drill-down detail view.
  Real bug found and fixed via live testing: Sales Invoice Item's
  `gross_profit`/`valuation_rate` fields are **not** reliably populated
  on a plain document fetch (only ever confirmed populated on a Sales
  *Order* item, which is a live projection, not the actual posted cost)
  — profit silently came out as `0` despite real revenue. Fixed by
  computing COGS from `Stock Ledger Entry.stock_value_difference`
  instead, the authoritative source, confirmed against a real invoice's
  real stock ledger row before trusting it.
- Owner chat analytics (FR-6) — `POST /api/v1/ai/query` (§6's existing
  "owner analytics chat" endpoint, a raw AI passthrough since Phase 4)
  now delegates to `report-dashboard/application/owner-chat.ts`, which
  follows the exact same two-turn validated pattern as the WhatsApp
  persona: the model requests real data via `get_dashboard_summary` or
  `get_sales_report({from, to})`, this layer runs the real query, the
  model's final answer is grounded in that result. Live-verified
  answering "no data" honestly for a date range with zero real sales
  (§8.1's "never fabricate" rule, same as everywhere else), and
  correctly citing real revenue/profit/best-seller/supplier/customer
  figures matching the dashboard's own numbers exactly.
- `GET /api/v1/whatsapp/orders/pending-payment` — WhatsApp orders with a
  draft invoice awaiting manual payment confirmation (`sales-pos`'s
  `listPendingPaymentConfirmations`, filtering on `po_no` being set,
  same signal Phase 6 already used to distinguish these from
  cashier-parked POS sales). The dashboard's Payments view lists them
  with the customer's real phone number pre-filled and calls the
  existing `confirm-payment` endpoint.
- Live-verified end-to-end through the actual browser UI, not just curl:
  loaded the dashboard against the real running API and ERPNext stack,
  confirmed real numbers rendered (matching direct `curl` checks byte
  for byte), asked the owner-chat widget a real question and got a
  grounded answer, and clicked "Konfirmasi Pembayaran" on a real pending
  order — confirmed afterward directly against ERPNext that the invoice
  really submitted (`status: Paid`, correct `paid_amount`, a real
  payment row posted to the right account).
- A pre-existing Phase 2 test artifact (`[DELETED] Test Item...`, a
  disabled item with 0 stock) shows up in the real "near out of stock"
  alert — accurate reporting of what's actually in ERPNext, left as-is
  rather than filtered out, consistent with never hiding real data to
  make a demo look cleaner.

**Phase 8 (Hardening — in progress):**

- **Real authentication (hard gate before Phase 9).** JWT-based login
  (`apps/api/src/modules/auth`), delegating credential verification to
  ERPNext's own `/api/method/login` rather than duplicating a
  password store — matches §5's data-model note that a separate
  `user_roles_extended` table is only needed "if RBAC needs finer grain
  than Frappe's native roles," which a single `hermes_role` custom
  Select field on ERPNext's existing `User` doctype covers for the 4
  roles in §1.4 (Owner, Manager, Cashier, Warehouse Staff). Access/refresh
  JWT pair (`type: 'access'|'refresh'` claim prevents token-type
  confusion); refresh rotates both tokens (no server-side revocation
  list yet — documented scope simplification, not silently dropped).
  A global Fastify `preHandler` (`attachAuthentication`) protects every
  route by default except an explicit public allowlist (`/health`,
  the two webhook receivers, `/auth/login`, `/auth/refresh`); a
  `requireRole(...)` per-route guard enforces the role matrix on top —
  `/reports/*`, `/ai/*`, and the payment-confirmation endpoints
  restricted to Owner/Manager(/Cashier for payment confirmation), the
  rest matrixed per module. The dashboard (`apps/dashboard`) got a real
  login screen and role-gated tabs to match.
  Live-verified: a request to a protected endpoint with no token
  returns `401`; curl-driven access-matrix testing across all 4 real
  seeded ERPNext users (one per role) confirmed every endpoint's
  expected-vs-actual access matched exactly, both via the API directly
  and through the real browser UI.
- **Rate limiting on public endpoints** (`@fastify/rate-limit`,
  `global: false` with a per-route `config.rateLimit` override) — the
  only routes with no JWT to lean on for abuse control: `/auth/login`
  (10 attempts / 15 min, brute-force protection) and the two webhook
  receivers (60 req/min each). Found and fixed two real bugs live while
  building this, both silent-failure classes that a mocked-only test
  would not have caught: (1) `app.register(rateLimit, ...)` wasn't
  `await`ed in `main.ts` — Fastify route registration is synchronous
  while plugin registration is async, so routes were being added before
  the plugin's `onRoute` hook attached, silently skipping rate limiting
  entirely; (2) the global error handler only special-cased the app's
  own `AppError` hierarchy, flattening every other error — including
  `@fastify/rate-limit`'s real `429` — to a generic `500`, which likely
  also affected other framework-level errors (Fastify's own 404s, body
  parse errors) since Phase 0. Fixed by `await`ing the rate-limit
  registration specifically and adding a second error-handler branch for
  any error carrying a 4xx `statusCode`. Live-verified against the real
  running server (not just `app.inject`): a curl loop of 12 wrong-password
  login attempts returned `401` × 10 then `429` × 2, with a clean JSON
  body (`{"error":"CLIENT_ERROR","message":"Rate limit exceeded, retry in
  15 minutes"}`) rather than a stack-trace leak; an ordinary unauthenticated
  request elsewhere still returned a normal `401`, confirming the fix
  didn't disturb existing error handling.
- **Retry/circuit-breaker audit across all external calls.** Inventory:
  `shared/erpnext-client` (all ERPNext `/api/resource` reads/writes —
  the vast majority of external calls in the app) already has
  `cockatiel` retry-with-backoff + a consecutive-failure circuit breaker
  from Phase 1, confirmed still correctly wired. The AI Gateway's
  "two-level failover" (rotate key → fall back to next provider, §3.1)
  is a different resilience strategy for a different failure mode
  (unreliable/rate-limited third-party providers, not a single backend
  of record) — auditing it surfaced one real gap: `generateWithFailover`
  only treated `AIProviderRateLimitError` (HTTP 429) as failover-worthy;
  a plain network error or a `5xx` from a provider — clearly transient,
  same as a 429 — fell through the same `throw error` path as a genuine
  bug, aborting the entire multi-provider pool instead of trying the
  next key. Fixed by adding a `retryable` flag to `AIProviderError`
  (true for network errors and 5xx, false for other 4xx/malformed
  responses — mirrors `shared/erpnext-client`'s own `isRetryable` split),
  and having the failover loop rotate to the next key/provider on any
  retryable `AIProviderError`, not just rate-limit ones (without marking
  the key on cooldown, since a transient blip isn't evidence the key
  itself is exhausted). Covered by new tests in
  `apps/api/test/ai-gateway-failover.test.ts`. Two calls remain
  deliberately without retry/circuit-breaker, both already documented at
  the point of the decision: the WhatsApp Cloud API client
  (`modules/whatsapp/infrastructure/whatsapp-client.ts` — a failed send
  just means a reply doesn't go out, no partial-write risk) and the
  ERPNext login call in `modules/auth/infrastructure/erpnext-session.ts`
  (a human is already in the loop and will just press "log in" again,
  unlike the automated/background callers the shared client protects).
  BullMQ's piutang-reminder job runs with default (no) job-level retry;
  left as-is since the job is self-healing by design — it's a daily
  recurring "due within N days" check, so a single failed run doesn't
  lose a reminder, it just reappears on the next day's check.
- **Optional Sentry error tracking** (`apps/api/src/shared/observability/sentry.ts`).
  `SENTRY_DSN` was a Phase 0 placeholder env var with nothing behind it;
  now `createSentryReporter(dsn, environment, client)` is a real,
  injectable wrapper around `@sentry/node` (same factory-plus-singleton
  shape as `createErpNextClient`) — a no-op when `SENTRY_DSN` is empty
  (the default), so every environment without a configured Sentry
  project still boots and runs identically. Wired into the four places
  an error would otherwise go unreported: the Fastify error handler's
  generic-500 branch (real bugs, not expected `AppError`s or framework
  4xxs); the `close-with-grace` shutdown callback (the only hook for an
  `uncaughtException`/`unhandledRejection` that's about to crash the
  whole process — arguably the single worst class of failure to miss);
  the piutang-reminder BullMQ worker's `failed` event; and two
  operational (not per-request) events surfaced by the retry audit
  above — the ERPNext circuit breaker opening and the AI Gateway
  exhausting every provider/key.
  Genuinely live-verified, not just mocked: pointed a real `SENTRY_DSN`
  at a throwaway local HTTP listener and ran the actual `@sentry/node`
  SDK (not a fake), which sent real envelope `POST` requests over the
  wire containing the exact test error/message text — proving the SDK
  really activates and really sends data when configured, the one part
  of this that a unit test with a mocked client can't prove by itself.
  (No live Sentry account/project exists to verify against yet — that's
  a real external dependency this environment doesn't have, called out
  here rather than silently assumed working.)
- **Real load test against the confirmed §13 VPS specs** (2 vCPU / 2 GB).
  `infra/docker/docker-compose.yml` already had per-container `mem_limit`s
  from Phase 1; added explicit `cpus` limits too (0.7 backend, 0.7 db, the
  rest split across queue/scheduler/frontend/websocket/redis, summing to
  2.0) so the stack is genuinely capped at the VPS's CPU budget regardless
  of how many cores the dev machine actually has — otherwise a load test
  on bigger hardware would just hide the real contention. New reusable
  `apps/api/scripts/load-test.ts` (`npm run load-test --workspace=apps/api
  -- <email> <password>`) drives real HTTP traffic at the real running
  API + capped ERPNext stack across three scenarios sized to how a single
  small store actually uses this system, not an arbitrary stress number:
  product search at 20 connections (the highest-frequency real action,
  tested well past real concurrency to find the ceiling), the dashboard
  summary at 5 connections (the heaviest single query, but the owner only
  opens it occasionally), and POS transaction creation at 3 connections
  (the real write path — deliberately low, matching "one or two
  simultaneous cashiers," and the script deletes every draft invoice it
  creates afterward so the load test doesn't leave throwaway data in the
  real store).
  Real results: product search held at 20 concurrent with 0 errors
  (p50 563ms, p99 666ms). The dashboard summary's ~1.9s p50 at 5
  concurrent looked concerning until checked against a single unloaded
  request (~0.6s) — most of that gap is `GUNICORN_WORKERS=1` (spec §13's
  own deliberate low-memory tradeoff) serializing concurrent requests, not
  the query itself being slow; `docker stats` confirmed it, with
  `backend` peaking at ~71% CPU against its 0.7 vCPU cap while `db` stayed
  at ~23% of its own 0.7 cap and every container's memory stayed
  comfortably inside its limit — CPU, not RAM, is the real ceiling on this
  VPS, exactly what §13 predicted.
  The write-path test surfaced a genuine bug: concurrent Sales Invoice
  creation hit MariaDB's naming-series row lock and threw a real
  `frappe.exceptions.QueryDeadlockError` (`HTTP 500`) — correctly
  classified as retryable by `shared/erpnext-client`'s `isRetryable`, but
  the previous default of 3 total attempts (200ms-2000ms backoff)
  sometimes wasn't enough to outlast the contention: an initial run saw
  13/59 requests (22%) fail this way. Fixed by raising the client's
  default `maxAttempts` from 3 to 5 — re-running the identical test
  afterward dropped the failure rate to 3/54 (~6%), confirmed via server
  logs to be the same error class, now just needing more attempts to
  clear rather than exhausting them. A small residual failure rate
  remains under this specific synthetic load (three simultaneous
  zero-delay writes, harsher than a real cashier's think-time between
  checkouts) — documented honestly rather than chased to zero with an
  unreasonably large retry budget that would just stack up latency
  instead.
- **Security pass: input validation + secrets handling.** Audited every
  route across every module for zod validation on its input, every place
  a secret could leak (logs, error responses, URLs), CORS config,
  webhook-signature comparison, and every ERPNext query for
  string-concatenated (vs. parameterized) filters. Most of the codebase
  was already sound — every business-write route already validated with
  zod, both webhook signature checks already used `timingSafeEqual` (not
  `===`), no secret-embedding URL (e.g. Gemini's key-in-query-string) is
  ever passed to the logger, every ERPNext query already goes through the
  parameterized `filters: [[field, op, value]]` array form, and the
  dashboard has no `dangerouslySetInnerHTML`/raw HTML injection anywhere.
  Two real gaps found and fixed:
  - **No production guard on insecure defaults.** `JWT_SECRET` had a
    placeholder default (`CHANGE_ME_TO_A_RANDOM_32_CHAR_MINIMUM_SECRET`,
    passes the 32-char zod check, and is sitting in this very repo's
    history) with nothing stopping the app from booting on it in
    production — anyone who read this code could forge an Owner-role
    token against a deployment that forgot to override it. Likewise
    `ERPNEXT_WEBHOOK_SECRET` unset silently skips signature verification
    (a `logger.warn`, not a refusal) — fine for local dev, not fine
    unnoticed in production. Fixed with `assertProductionSafety()` in
    `apps/api/src/config/env.ts`: when `NODE_ENV=production`, the app now
    refuses to boot (`process.exit(1)`, clear message listing every
    problem) if `JWT_SECRET` is still the placeholder, if
    `ERPNEXT_WEBHOOK_SECRET` is empty, or if `WHATSAPP_APP_SECRET` is
    empty while WhatsApp is actually configured (`WHATSAPP_ACCESS_TOKEN`
    set) — conditional, since an app that never set up WhatsApp has no
    webhook traffic there to protect. Wildcard `CORS_ALLOWED_ORIGINS` in
    production gets a loud warning rather than a hard refusal (bearer
    tokens in an `Authorization` header aren't the same CSRF-style risk
    cookies would be, and blocking boot on a config choice the user
    hasn't necessarily finalized yet felt disproportionate) — still
    called out rather than silently carried forward. Live-verified, not
    just unit-tested: ran the real app with
    `NODE_ENV=production JWT_SECRET=<placeholder> ERPNEXT_WEBHOOK_SECRET=`
    and confirmed it printed both problems and exited `1` rather than
    booting.
  - **`/api/v1/products/search` had no runtime input validation** — a TS
    type annotation on the query string only, unenforced at request time,
    inconsistent with every other route's zod pattern (not itself
    exploitable, since Frappe's array-filter format isn't susceptible to
    string-concatenation injection, but still worth fixing for
    consistency and to cap unbounded input). Added a zod schema
    (`q`/`customer_tier`, both capped at a sane max length);
    live-verified an over-long `q` now gets a clean `400
    VALIDATION_ERROR` instead of silently reaching ERPNext.
  Also hardened `apps/api/src/modules/auth/infrastructure/jwt.ts` to pass
  an explicit `algorithms: ['HS256']` allowlist to `jwt.verify` (and
  `algorithm: 'HS256'` to `jwt.sign`) — defense in depth against
  algorithm-confusion attacks, even though this app only ever signs with
  HS256 today.
  One finding reviewed and *not* changed:
  `customer-membership`'s `/customers/:id` family lets any authenticated
  Cashier/Manager/Owner look up any customer's piutang/purchase history
  by ID with no additional ownership check. Flagged by the audit as an
  IDOR pattern in general, but this is a single-store internal-staff ERP,
  not a multi-tenant app — every role gated onto this route is a trusted
  employee who legitimately needs to pull up any customer's balance to
  process a sale, the same as they could by opening the physical ledger.
  Documented here as a reviewed-and-accepted design choice rather than
  silently dropped.

### Renaming the placeholder company

`ERPNEXT_DEFAULT_COMPANY` / `ERPNEXT_DEFAULT_WAREHOUSE` default to a
placeholder ("Toko Hermes" / "Gudang Utama - TH") since the spec left the
real store name as `[Nama Toko]` (§8.1) — nothing was provided when Phase 2
was built. To use your real business name: rename the Company and Warehouse
in ERPNext's UI (Company rename cascades to linked accounts/warehouses
automatically), then update both env vars to match. `apps/api`'s modules
never hardcode the name — they only read these two env vars.

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
(auto-restarts on file changes) and, since `npm run dev` runs the same
`main()` entry point as production, also starts the piutang reminder
BullMQ worker — which needs `hermes-redis` up first:

```bash
cd infra/docker && docker compose up -d hermes-redis
```

(`buildApp()`, used by the test suite, does **not** start background
workers — tests never need a live Redis.) Verify it's up:

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

## Running the PWA scanner locally

```bash
npm run dev --workspace=apps/pwa-scanner
```

Opens on `http://localhost:5173`, talking to the API at
`http://localhost:3000` by default (override with `VITE_API_BASE_URL` in a
`.env` in `apps/pwa-scanner`). Requires the API's `@fastify/cors` to allow
its origin — the default `CORS_ALLOWED_ORIGINS=*` covers this out of the
box for local dev. See [apps/pwa-scanner/README.md](apps/pwa-scanner/README.md)
for how to exercise the offline queue.

## Running the dashboard locally

```bash
npm run dev --workspace=apps/dashboard
```

Opens on `http://localhost:5174`, talking to the API at
`http://localhost:3000` by default (override with `VITE_API_BASE_URL` in a
`.env` in `apps/dashboard`, same convention as the PWA scanner). No login
yet — `apps/api`'s `auth` module is still unimplemented (Phase 0
placeholder), so every view is open; don't expose this outside a trusted
network until that lands.

## Setting up AI providers

None of Mimo/Gemini/NVIDIA NIM have keys configured by default — without
any, `POST /api/v1/ai/query` returns `503 SERVICE_UNAVAILABLE` (correctly:
there's nothing to fail over to). `propose_action`/`confirm_action` don't
need any AI provider at all — validation and execution talk to ERPNext
directly, not an LLM.

To enable a provider, add one or more comma-separated keys to its env var
and restart:

```bash
# .env
NVIDIA_NIM_API_KEYS=key1,key2
GEMINI_API_KEYS=key1
MIMO_API_KEYS=key1
```

- **NVIDIA NIM**: free tier at [build.nvidia.com](https://build.nvidia.com)
  (uses your own NVIDIA account — not a link this repo can vouch for
  beyond "it's NVIDIA's official developer portal").
- **Gemini**: free tier via Google AI Studio.
- **Mimo**: Xiaomi MiMo, `https://api.xiaomimimo.com/v1`.

`AI_PROVIDER_PRIORITY` (default `mimo,gemini,nvidia,openai,claude`)
controls fallback order — only providers with at least one key configured
are actually tried; OpenAI/Claude have no implementation yet regardless of
whether keys are set (§10 starts with the free-tier providers).

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

### Setting up the ERPNext data model (Phase 1 + 2)

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

Safe to re-run — every step checks whether its record already exists before
creating it, so nothing gets duplicated. Besides the Phase 1 Custom
Fields/Price Lists/UOMs, this also creates the Phase 2 prerequisites (Company,
Warehouse, Fiscal Year, Modes of Payment, Walk-in Customer) and registers the
`Webhook` records that make `POST /webhooks/erpnext` fire — set
`ERPNEXT_WEBHOOK_SECRET` in `.env` first so those are created with signature
verification enabled (an empty secret means the endpoint accepts unsigned
requests, logged as a warning — fine for a first local run, not for anything
beyond localhost). If your API isn't reachable at
`http://host.docker.internal:3000` from inside the ERPNext containers,
override `ERPNEXT_WEBHOOK_CALLBACK_URL` before seeding.

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

Steady-state container memory ceiling is ~1.71 GB (1750m across all
`mem_limit`s — see the running budget table in
`infra/docker/docker-compose.yml`'s header comment, kept current as
services are added), leaving ~250 MB headroom for the host OS and the Node
API. On the actual VPS, also run the swap setup script once (see below) —
it's a host-level change, not something Docker can do from inside a
container.

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

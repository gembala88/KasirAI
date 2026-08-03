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

**Pre-Phase 9: POS refinements (cashier checkout screen, receipt printing).**

Requested as three "small" refinements before Production Launch, but
investigating them surfaced a real scope gap: **no cashier checkout/POS
screen existed anywhere.** `apps/pwa-scanner` only ever implemented the
warehouse inventory-scan tool (§1.3 FR-7); the spec's separate "POS screen
(cashier) — barcode scan auto-adds to cart, numeric keypad always visible,
big 'Bayar' button" (§1.3) was never built, only the backend `sales-pos`
module behind it. Confirmed with the user before proceeding (building a
full checkout UI is not actually "small") and got the go-ahead to build it
for real, not defer it again.

- **Cashier checkout screen** — new "Kasir" tab in `apps/pwa-scanner`
  (`components/Kasir.tsx`), alongside the existing scan tool (now
  `components/WarehouseScan.tsx`; `App.tsx` gates both behind login and
  role — Warehouse Staff/Cashier see one tab each, Owner/Manager see both,
  matching backend `requireRole` exactly). Product search/barcode input,
  an always-visible numeric keypad for scan quantity, a cart, customer ID
  field (blank = Walk-in/Retail), and a big "Bayar" button leading to a
  payment step (method + amount + the print toggle below).
- **Barcode-scan quantity merge (item 1)** — fixed in two places, not
  one: `createTransaction` (`apps/api/src/modules/sales-pos/application/transactions.ts`)
  now merges cart lines with the same item code + warehouse by summing
  quantity before creating the ERPNext Sales Invoice, so *any* caller gets
  this guarantee, not just the one UI; the Kasir screen also merges
  client-side so the cart visibly increments the instant the same item is
  scanned twice, not after a round trip. Live-verified through the actual
  browser UI (not just curl): scanning `DEMO-BERAS-5KG` twice showed one
  line, "2 × Rp 65.000 = Rp 130.000", confirmed directly against the real
  ERPNext invoice afterward (`items: [{item_code, qty: 2}]`, one row).
  Building this also surfaced a real, unrelated bug: `searchProducts` only
  filtered on `item_name`, never `item_code` — a literal barcode/code scan
  (as opposed to typing a product name) matched nothing. Fixed by adding
  `item_code` to the search via Frappe's `or_filters` (confirmed live via
  curl that `or_filters` combines with `filters` as `AND(OR(...))`, the
  right semantics here — "not disabled, AND (code matches OR name
  matches)").
- **Print-receipt toggle (item 2)** — a checkbox on the payment step,
  default on. On a successful sale, if checked, the app opens the receipt
  and triggers the browser's print dialog; if unchecked, it's skipped
  entirely — the transaction is recorded identically either way, exactly
  as asked. A failed print (tested live via the automated browser's popup
  blocker) is handled as "sale succeeded, print failed" rather than
  rolling back or misreporting the sale as failed.
- **Receipt content: zero hardcoded values, real ERPNext Print Format
  (item 3)** — audited first and confirmed nothing was hardcoded anywhere
  in the app (no store address/phone/invoice-numbering strings existed to
  begin with), then built the receipt endpoint to keep it that way. New
  `GET /api/v1/pos/transactions/:id/receipt` (`sales-pos/application/receipt.ts`)
  proxies ERPNext's own `/printview` route — real HTML rendered entirely
  by ERPNext's Print Format engine from the Company/Customer/Item data,
  confirmed live to contain the real Company name ("Toko Hermes", pulled
  from ERPNext, not a string in this codebase) and real invoice content.
  A new optional `ERPNEXT_RECEIPT_PRINT_FORMAT` env var lets the owner
  point at a custom Print Format (built in ERPNext's own Print Format
  designer, Setup > Printing) later without any code change; empty uses
  the doctype's default format. The frontend never constructs receipt
  markup itself — it only opens what this endpoint returns and calls
  `window.print()`.
  Real infrastructure gap found live along the way: the original plan was
  a real PDF via Frappe's `print_format.download_pdf`, but that fails in
  this ERPNext Docker image — `wkhtmltopdf` itself errors
  (`OSError: ... network error: ConnectionRefusedError`), a genuine
  environment issue, not a guess. Pivoted to `/printview`'s HTML instead,
  which avoids `wkhtmltopdf` entirely and lets the browser's native print
  dialog handle the PDF/print conversion (works with any printer the OS
  has a driver for, thermal receipt printers included) — arguably a
  better fit for a 2 vCPU/2 GB VPS than adding a heavier PDF-rendering
  dependency anyway.
- **Also fixed: a real Phase 8 regression.** `apps/pwa-scanner` never sent
  an `Authorization` header — Phase 8's global auth rollout made every
  API route reject unauthenticated requests, silently breaking the
  warehouse scan tool the moment it shipped (confirmed live: a real
  unauthenticated scan request returned `401` against the running API).
  Nothing caught this at the time because Phase 8's own verification only
  covered curl and the dashboard's browser UI, not this app. Fixed with
  the same login/JWT-attach pattern as `apps/dashboard`
  (`lib/auth.ts`/`lib/api.ts`, new `components/Login.tsx`) — live-verified
  the warehouse scan flow works end-to-end again post-login, as Warehouse
  Staff, through the real browser UI.
- All of the above live-verified together in one real session: logged in
  as Cashier through the actual UI, scanned a real item twice (merged to
  qty 2), paid by Cash, confirmed the real ERPNext invoice (`status:
  Paid`, `docstatus: 1`, correct `paid_amount`), then cancelled it again
  afterward so the test sale doesn't linger in the real books (`report-dashboard`'s
  queries already filter on `docstatus = 1`, so a cancelled invoice
  wouldn't have polluted real figures regardless — confirmed, not
  assumed). Also verified Warehouse Staff can scan again post-login, and
  that Owner/Manager see both tabs while Cashier/Warehouse Staff each see
  only their own.

**Pre-Phase 9: §15 Fault Tolerance & Offline Resilience.**

Raised by the user as a gap check before going live: the spec's §15
("right-sized for 1 kasir") wasn't in any prior phase report. Root cause,
confirmed and disclosed rather than hidden: every phase so far had been
checked against `HERMES_PROJECT_SPEC (1).md`, and §15 only exists in
`HERMES_PROJECT_SPEC (2).md`. Audited honestly against the actual code
before building anything: the offline queue had no UUID (just an
IndexedDB auto-increment key), no content hash, no status field beyond
implicit "queued or not," covered only warehouse scans (the new Kasir
checkout screen had zero offline handling), no server-side
`offline_sync_queue` staging table existed despite §5 naming it, and
`innodb_flush_log_at_trx_commit=1` was correct only by InnoDB's implicit
default, never explicitly configured. All of it built for real this pass:

- **`offline_sync_queue` (§5, formalized by §15.2)** — new table in
  Hermes' own SQLite (`shared/database/index.ts`): `uuid` (primary key),
  `action_type`, `content_hash`, `client_timestamp`, `status`, `payload`,
  `erpnext_reference`, `result`, `error_message`, timestamps.
- **New `apps/api/src/modules/sync` module** — `POST /api/v1/sync/actions`
  is the one idempotent entry point for every offline action (warehouse
  scans and POS sales alike): verifies the content hash server-side
  first (rejects a corrupted/altered payload without writing anything),
  then checks the UUID against `offline_sync_queue` — already `Synced` or
  `Conflict` means skip, never re-apply, exactly §15.2's wording. A
  `pos-sale` action is one offline action but two ERPNext writes (create
  invoice, then pay it) — the invoice's name is persisted as a *partial*
  `erpnext_reference` the moment it's known, before payment is even
  attempted, so a retry after a partial failure resumes from the existing
  invoice instead of creating a second one. `GET /api/v1/sync/conflicts`
  (Owner/Manager) backs the dashboard's manual-review list.
- **Conflict classification is a real ERPNext error, not a guess** —
  live-curled a genuine negative-stock attempt against real ERPNext
  first to find the actual shape: `exc_type: "NegativeStockError"` in the
  response body. That specific error is classified `Conflict`
  (§15.2: "e.g., stock went negative because two changes happened in
  overlapping windows") and routed to the dashboard's new **Konflik
  Sinkron** tab (Owner/Manager) rather than retried automatically —
  "silently guessing on a stock/money discrepancy is worse than asking
  the owner to glance at it," per spec. Everything else that can fail
  (network blips, validation errors) stays a plain retryable `Failed`.
- **Frontend offline queue redesign** — `apps/pwa-scanner/src/lib/offline-queue.ts`:
  every queued action now gets a real `crypto.randomUUID()`, a SHA-256
  content hash (Web Crypto client-side, `node:crypto` server-side —
  cross-checked byte-for-byte identical for the same payload, with tests
  on both sides pinned to a known hash so the two can never silently
  drift apart), a client timestamp, and the full six-state status
  (`Pending`/`Processing`/`Synced`/`Failed`/`Retry`/`Conflict`).
  New unified `lib/sync.ts`: every action — online or not — is written
  to the local queue *first*, then an immediate sync attempt is made.
  This closes a real gap the old "try direct submit, catch → enqueue"
  pattern had: if a request reached the server and was applied but the
  *response* never made it back (closed tab, connection drop right at the
  end), the old code would think it failed and retry, which — without
  server-side idempotency — would have silently created a duplicate sale
  or stock movement. Now every attempt, first or retried, carries the
  same UUID, and the server skips it if already synced. The Kasir
  checkout screen now goes through this same path, closing the "zero
  offline handling" gap entirely.
- **`innodb_flush_log_at_trx_commit=1`** now explicit in
  `infra/erpnext/mariadb/hermes-tuning.cnf`, not implicit. Restarted the
  real `db` container (not just reloaded config) and re-queried
  `SHOW VARIABLES` afterward to confirm the explicit line was actually
  read and accepted, not coincidentally matching the old default.
- **A real bug found live while testing this, not in production:**
  `openDB`'s version bump (1 → 2, for the new `uuid`-keyed schema) hung
  indefinitely — no error, no timeout — when a stale connection at the
  old version was still open (hit via a leftover browser tab; the same
  failure mode a cashier could hit with two tabs open, or an old
  background tab from before a PWA update). Root-caused via
  `indexedDB.databases()` showing the DB stuck at version 1 no matter
  what. Fixed with the `blocking` handler IndexedDB's own upgrade
  protocol expects: a connection about to block a newer version closes
  itself so the upgrade can proceed, instead of hanging forever on a tab
  the cashier may have forgotten about.
- **Live-verified with a real network kill, not a simulated one:**
  logged in as Cashier in the real browser, added a real item to the
  cart, opened the payment step, then **killed the actual API server
  process** (confirmed via curl: connection refused) before pressing
  "Konfirmasi Pembayaran". The UI correctly reported the sale saved
  locally rather than lost; inspecting IndexedDB directly confirmed a
  real record with a real UUID, content hash, client timestamp, and
  `Failed` status (the immediate sync attempt genuinely failed against
  the dead server). Restarted the real API server, clicked "Sinkron
  Sekarang", and confirmed against real ERPNext: **exactly one** new
  invoice (`status: Paid`, `docstatus: 1`) — not zero, not duplicated.
  Then, for the strongest possible proof, manually replayed the *exact
  same* sync request via curl (identical UUID) against the real running
  server: response came back `"skipped": true` with the same cached
  invoice, and ERPNext still showed exactly one invoice afterward, not
  two. The Conflict path was verified the same way — a real
  `reduce-stock` request big enough to go negative, against real
  ERPNext, correctly returned `Conflict`, was not re-applied on a
  replayed retry, and appeared correctly in the real dashboard's Konflik
  Sinkron tab. Every test invoice/stock entry created during this was
  cleaned up afterward (cancelled + deleted, or deleted while still
  draft) so nothing lingers in the real books.

## Phase 9: Production Launch (smoke-tested on a shared VPS)

Deployed for real to `43.128.68.124`, per the user's explicit go-ahead
after §15 was confirmed solid. Full detail in `RUNBOOK.md` and
`DEPLOY_CHECKLIST.md` — this section is the summary.

**This VPS is shared, not dedicated — confirmed live before touching
anything, per explicit instruction.** The SSH key found on this
environment was aliased `paybox-vps`; rather than assume it was the
right target, the user was asked directly, and confirmed it is the real
Hermes VPS despite the name — reused from an earlier unrelated project.
A read-only survey (before any install/deploy step) found it already
running two other live projects: `robin_darkpools` (four Node bots) and
`paybox-bot` (a pm2-managed server on port 3000 — the same port Hermes'
API would have defaulted to). Real numbers at that point: 1.9 GB RAM,
861 MB already committed, ~546 MB genuinely free (up to ~1.1 GB counting
reclaimable cache), 1.9 GB swap with ~1.5 GB free. Per explicit
instruction, neither project was touched, stopped, or modified at any
point — confirmed again at the end of this phase (same PIDs, same
processes, still running).

**Scope decision (explicit):** deploy scoped down to fit this shared
box's real headroom rather than wait for a dedicated VPS, understood
and stated up front as a functional smoke test only ("untuk coba"), not
representative of §13's intended dedicated-VPS performance. A dedicated
VPS is required before real go-live — not a suggestion, an agreed
prerequisite.

- **`infra/docker/docker-compose.shared-vps-test.yml`** — a Compose
  override with a further-trimmed memory/CPU budget specific to this one
  box, layered on top of (not replacing) `docker-compose.yml`'s own
  numbers, which remain correct for a dedicated 2 vCPU/2 GB VPS matching
  §13. The base file also gained real `api`/`dashboard`/`pwa-scanner`
  services (finally containerizing apps/api, which ran on the host
  through Phase 8) and had its own budget re-balanced to fit all three
  alongside ERPNext within the original 2 GB dedicated-VPS target.
  Confirmed live after deploy: swap usage rose from 399 MB to 986 MB
  (`free -h`, before vs. after) — the stack genuinely leans on swap on
  this box, exactly the accepted trade-off, not a surprise.
- **Hermes' API moved off port 3000** (paybox-bot's port) to 3001,
  reachable only via `127.0.0.1` (never `0.0.0.0`) — same for
  `dashboard` (`:5175`) and `pwa-scanner` (`:5176`). Nginx (host-level,
  not containerized) is the only thing meant to be internet-facing.
- **A real deployment-only bug, found live:** `Dockerfile.api` used
  `node:20-alpine` — the container crash-looped on every single start
  with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. `node:sqlite` has been
  used since Phase 4 (`ai_action_audit`) but this Dockerfile was written
  in Phase 0 and never actually rebuilt/run again until now — local dev
  never touches it (runs on the host with whatever Node version is
  locally installed), so nothing had ever caught the drift. Fixed:
  `node:22-alpine`.
- **Nginx** (`infra/nginx/hermes.conf.template`) fixed to also route
  `/webhooks/erpnext` and `/whatsapp/webhook` — both are top-level paths
  on the Fastify app (not under `/api/`), and the original template only
  routed `/`, `/scan/`, `/api/`, `/erp/`; these two would have 404'd.
  Installed and verified live on the VPS: every route
  (`/`, `/scan/`, `/api/v1/auth/login`, `/health`, `/erp/`,
  `/webhooks/erpnext`) returns the correct response — including
  `/webhooks/erpnext` correctly returning `401` for an unsigned test
  request, confirming signature verification is live end-to-end through
  the proxy, not bypassed.
- **Real backup automation, not just a script that exists:** a systemd
  timer (`hermes-backup.timer`, daily at 02:00 + jitter) runs
  `infra/scripts/backup.sh`, which uses Frappe's own `bench backup
  --with-files` (not a hand-rolled mysqldump — bench's own command is
  what correctly captures the site's encryption key alongside the DB
  dump; a DB-only backup without it would be a real file that's
  practically useless on restore) with daily/weekly/monthly retention
  tiers. Live-verified two ways: (1) manually started the actual systemd
  *service* the timer invokes (`systemctl start hermes-backup.service`)
  and confirmed via `journalctl` it completed with `status=0/SUCCESS`,
  not just that the shell script works when run by hand; (2) ran
  `infra/scripts/restore.sh --verify-only` against the real backup file
  produced — this restores onto a throwaway ERPNext site (never the real
  one), runs a real data query against it, then tears the throwaway site
  down. Completed successfully, proving the backup is genuinely
  restorable, not merely present on disk.
- **A real, un-worked-around blocker found and reported, not
  papered over:** the VPS's cloud security group blocks every port
  except 22 (SSH) from the public internet — confirmed by testing port
  80 and port 8080 from outside (both time out) versus from inside the
  box itself (both work instantly), and confirming the OS-level firewall
  (`ufw` inactive, `iptables` INPUT policy `ACCEPT`) isn't the cause.
  This is infrastructure-level, outside SSH's reach — opening it requires
  the VPS provider's own console/API. Everything below this point is
  therefore verified working *from inside the VPS only* (via SSH +
  `curl localhost`), which is genuine, real evidence of the application
  stack's correctness, but is not the same as public reachability.
- **HTTPS not yet issued** — certbot is installed and confirmed working
  (`certbot --version`), and the Nginx config is ready for it, but Let's
  Encrypt's HTTP-01 challenge needs both a real domain pointing at this
  VPS and port 80 reachable from the internet — neither exists yet (no
  domain was provided; see the firewall item above). Not attempted
  against Let's Encrypt's real servers, since it would just fail against
  their rate limits for no reason without those two prerequisites.
  Full instructions for the actual `certbot --nginx -d <domain>` run are
  in the Nginx template's own header comment, ready for whenever DNS +
  firewall are in place.
- **WhatsApp: nothing to test live, honestly, because nothing has ever
  been configured.** Checked directly (not assumed): all four WhatsApp
  credentials (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`) are empty both
  locally and on the VPS — this project has never had a real Meta
  Business API connection at any point, in any earlier phase. The
  webhook *endpoint* is deployed and its signature verification is
  confirmed live (see the Nginx bullet above), but no real Meta traffic
  has ever reached it. Getting real credentials and configuring Meta's
  app dashboard (with a matching verify token, and a reachable HTTPS
  URL — which needs the two items above first) is the user's own action.
- See `DEPLOY_CHECKLIST.md` for the complete, itemized state of every
  secret/credential/DNS/firewall item — done vs. outstanding — and
  `RUNBOOK.md` for restart/log/rollback/failure-mode procedures.

### Renaming the placeholder company

`ERPNEXT_DEFAULT_COMPANY` / `ERPNEXT_DEFAULT_WAREHOUSE` default to a
placeholder ("Toko Hermes" / "Gudang Utama - TH") since the spec left the
real store name as `[Nama Toko]` (§8.1) — nothing was provided when Phase 2
was built. To use your real business name: rename the Company and Warehouse
in ERPNext's UI (Company rename cascades to linked accounts/warehouses
automatically), then update both env vars to match. `apps/api`'s modules
never hardcode the name — they only read these two env vars.

## Domain, HTTPS, and camera scanning (2026-08-03)

Real domain (`newpelangi.duckdns.org` via DuckDNS) pointed at the VPS,
ports 80/443 opened in Tencent Cloud Lighthouse's firewall panel, and a
real Let's Encrypt certificate issued via `certbot --nginx` — verified
with `openssl s_client` (not `curl -k`), a real dry-run renewal
(`certbot renew --dry-run`), and the HTTP→HTTPS redirect.

**This was the first time either app had ever been loaded in a real
browser through the actual domain/Nginx path** — every earlier check used
direct `curl` to a container's own port, which doesn't exercise Nginx
routing or the frontend's build-time configuration at all. That surfaced
three real, previously-invisible bugs, found and fixed in order as each
one unblocked the next:

1. **Asset routing collision:** `apps/pwa-scanner`'s build referenced its
   own JS/CSS at the domain root (`/assets/...`, Vite's default) instead
   of under its actual served path (`/scan/assets/...`). A request for
   `/scan/assets/...` doesn't match Nginx's `/scan/` location, so it fell
   through to `apps/dashboard`'s location block and silently got served
   *dashboard's* HTML instead — the page returned 200 OK but React never
   mounted, no console error. Fixed with `base: '/scan/'` in
   `vite.config.ts`, conditional on the build command so local dev
   (served at its own root) is unaffected.
2. **Service worker scope collision** (found immediately after #1): both
   apps generate their own Workbox service worker via `vite-plugin-pwa`.
   Dashboard's registers at scope `/` (correct — it's genuinely served at
   the domain root), but Workbox's `generateSW` mode auto-adds a
   `NavigationRoute` that serves that app's own `index.html` for *every*
   navigation within its scope — and `/` technically covers `/scan/` too.
   Once active, this permanently hijacked navigation to `/scan/` for any
   device that had ever loaded the dashboard even once, before pwa-scanner's
   own more-specifically-scoped service worker ever got a chance to
   register. Fixed with `navigateFallbackDenylist: [/^\/scan\//]` in
   dashboard's workbox config.
3. **Doubled `/api/api/` URL** (found once #1/#2 let the real page load
   far enough to attempt a login): both apps' `VITE_API_BASE_URL` build
   arg defaulted to `/api`, but `src/lib/api.ts` in both apps already
   builds full `/api/v1/...` paths itself — producing
   `/api/api/v1/auth/login`, a 401. This broke login for **both** apps
   through the real Nginx path, never caught because nothing had tested a
   real browser login that way before. Fixed by changing the default to
   empty in `docker-compose.yml`, both Dockerfiles, and `.env.example`
   (and the VPS's own `.env`, which explicitly set `/api`).

All three fixed, rebuilt, redeployed, and **re-verified with genuine
fresh logins** (service workers/caches explicitly unregistered first, to
rule out stale state) — cashier login on `/scan/` and owner login on `/`
both confirmed working through the real production HTTPS path, via
network requests showing `200 OK` on `/api/v1/auth/login`, not a cached
result.

**Camera-based barcode scanning** (spec §1.3 FR-7, §14 — reserved for
warehouse/stock-opname use, *not* the Kasir checkout counter, which keeps
its USB/Bluetooth keyboard-emulation text input per §14's hardware
recommendation): added to `WarehouseScan.tsx` only. Prefers the native
`BarcodeDetector` API (Chrome/Edge on Android) and falls back to
`@zxing/browser` where it isn't available (notably Safari/iOS, which has
never shipped `BarcodeDetector`) — the fallback library (~450KB) is
dynamically imported only inside that code path, so Kasir users and
Android Chrome users (who have native support) never load it at all;
confirmed via a real production build (167KB main bundle vs. a separate
454KB chunk) and via live network request timing on the deployed VPS
(the chunk only loads when "📷 Scan" is actually tapped). Live-verified
on the real HTTPS domain, logged in as Warehouse Staff: the scan button
correctly triggers a real `getUserMedia`/`BarcodeDetector` attempt (not a
mock) and the code's error handling correctly surfaces a clear Indonesian
message when no camera is available — the automated browser environment
used for this verification has no physical camera device attached, so a
literal "tap Allow" permission dialog can't be produced here; a real
phone's browser will show the actual OS-level permission prompt the
first time a store staff member taps Scan, which is worth one manual
confirmation on an actual device.

## Pre-launch polish pass (2026-08-03)

Requested after Phase 9: domain/HTTPS setup (in progress — blocked on the
user identifying their cloud provider), plus six smaller items, all
verified live rather than assumed:

- **Kg UOM**: added alongside Pcs/Lusin/Karton for weight-sold items
  (rice, sugar, etc.), with `must_be_whole_number: 0` (unlike the other
  three) so fractional amounts like 0.5kg are actually usable. Live-
  verified on both local dev and the VPS's ERPNext via the real seeded
  UOM's field values, not just that the seed script ran without error.
- **Data retention**: 30-day auto-delete for `offline_sync_queue` rows
  that already reached `Synced` status (a BullMQ scheduled job,
  `apps/api/src/modules/sync/infrastructure/retention-queue.ts`, same
  pattern as the piutang reminder job) and for Docker/Nginx logs (compose
  `logging:` size/count bounds + a 30-day nginx logrotate config). Never
  touches ERPNext's own data, or any non-`Synced` sync-queue row — kept
  by the store owner's explicit decision, indefinitely, is the WhatsApp
  conversation history (`ai_conversation_log`/`notification_log`), since
  it isn't "just a log" the way the others are. Live-verified: a real
  45-day-old `Synced` row was deleted by the actual job (through the real
  BullMQ queue + Redis + SQLite file), a 2-day-old one was not. Full
  policy documented in RUNBOOK.md's "Data retention" section.
- **Real security gap found and fixed** while in `docker-compose.yml` for
  the above: `frontend` (ERPNext, :8080) and `hermes-redis` (:6380) were
  still published to `0.0.0.0` from local-dev defaults, not `127.0.0.1`
  like `api`/`dashboard`/`pwa-scanner` already were — harmless only
  because the cloud firewall was also blocking those ports. Rebound to
  `127.0.0.1` as defense-in-depth; live-verified via `ss -tlnp` on the
  VPS post-deploy, plus a real login still succeeding afterward.
- **RUNBOOK.md** gained three new sections: a plain-language "if
  something seems wrong" quick-fix list (reload → clear site data →
  reinstall the PWA → restart services → reboot, in that order, with an
  explicit warning about the shared VPS before the reboot step), a "Store
  PC/tablet setup" guide (Android Chrome / iOS Safari / Windows Chrome or
  Edge, each with concrete steps), and the data-retention policy above.
- **NOTES.md** (new) — a plain-language, non-technical running log of
  every notable decision and real bug found across all phases, meant to
  be readable without touching code or git history.
- **Receipt redesigned**: the checkout receipt was, until now, ERPNext's
  own default Sales Invoice print format — real ERPNext content (the
  company name pulled correctly), but a full-page, English-language
  business invoice layout ("Bill to:", "In Words:"), not a compact retail
  receipt. Built a new ERPNext Print Format ("Hermes Struk Kasir",
  Jinja-templated, seeded idempotently by `scripts/seed-erpnext.ts`,
  editable anytime via ERPNext's own Print Format designer with zero code
  changes) — compact, Indonesian-labeled, shows items/qty/subtotal/
  payment method/change, set as the new default via
  `ERPNEXT_RECEIPT_PRINT_FORMAT`. Two real bugs found and fixed live
  while building it: a stray trailing period on the printed time, and
  quantities showing as "1.0" instead of "1". Found and documented (not
  fixed in code, since it isn't a code problem): the store's address is
  currently blank on the letterhead because it was never entered in
  ERPNext's Company record — see `DEPLOY_CHECKLIST.md`.
- **Kasir checkout screen polish**: the payment-confirmation step's
  "Metode Pembayaran"/"Jumlah Diterima" fields were unstyled native
  browser controls (small, inconsistent with the rest of the app) —
  reused the app's existing `.scan-form` styling so they match every
  other input (confirmed live via computed CSS: 48px min-height, 8px
  border-radius, matching the cart screen). Also added a read-only order
  summary to the payment screen so the cashier can see what's actually in
  the cart before confirming, not just the total.
- **Store branding made easy to edit**: both `apps/dashboard` and
  `apps/pwa-scanner` now have a single `src/branding.ts` file exporting
  `STORE_NAME`, used by both the header and the installed PWA's
  name/home-screen label — one line to change, no other code touched.
- **Real bug found and fixed**: `apps/dashboard` had no PWA manifest at
  all — despite RUNBOOK.md's "Store PC/tablet setup" instructions telling
  the owner to install it as an app, Chrome had nothing to install (no
  `<link rel="manifest">`, no `vite-plugin-pwa` dependency). Added the
  same manifest/service-worker setup `apps/pwa-scanner` already had.
  Live-verified with a real production build:
  `dist/manifest.webmanifest` is generated with the correct name/icons,
  and `index.html` correctly links to it.

All of the above deployed and live-verified on the VPS too (not just
locally): containers rebuilt, `docker ps` confirms all 12 healthy,
`robin_darkpools`'s four processes confirmed untouched (same PIDs)
throughout every step.

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

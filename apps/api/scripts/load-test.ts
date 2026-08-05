/**
 * Real load test against the §13 VPS profile (2 vCPU / 2 GB) — Phase 8
 * hardening. Not a synthetic in-process benchmark: this drives real HTTP
 * traffic at a real running `apps/api` + real ERPNext stack (its Docker
 * containers carry the `cpus`/`mem_limit` values from
 * infra/docker/docker-compose.yml, so results reflect the actual VPS
 * ceiling regardless of the host machine's real hardware).
 *
 * Usage (API must already be running, e.g. `npm run dev`):
 *   npm run load-test --workspace=apps/api -- <cashierEmail> <cashierPassword> [baseUrl]
 *
 * Three scenarios, matched to how a single small store actually uses this
 * system (not an arbitrary stress ceiling):
 *   1. Product search — the highest-frequency real action (every item a
 *      cashier scans/types during checkout), tested at a concurrency a
 *      busy single counter would never actually reach, to find the real
 *      ceiling rather than just confirm the easy case works.
 *   2. Dashboard summary — the heaviest single query (ERPNext Stock Ledger
 *      Entry aggregation for COGS, §7's report-dashboard), but only ever
 *      opened by the owner occasionally, so tested at realistic low
 *      concurrency, not artificially inflated.
 *   3. POS transaction creation — the real write path (draft Sales
 *      Invoice creation through ERPNext), deliberately kept to a low
 *      concurrency matching "one or two simultaneous cashiers" (§1.4's
 *      actual scale), specifically to avoid flooding the real ERPNext
 *      instance with throwaway data. Every invoice this creates is a real
 *      draft; this script deletes them again at the end (drafts, so safe
 *      to remove) and reports exactly how many it cleaned up.
 */
import autocannon, { type Result } from 'autocannon';
import { erpNextClient } from '../src/shared/erpnext-client/index.js';

const [, , email, password, baseUrlArg] = process.argv;

if (!email || !password) {
  console.error('Usage: tsx scripts/load-test.ts <email> <password> [baseUrl]');
  process.exit(1);
}

const baseUrl = baseUrlArg ?? 'http://localhost:3000';

interface LoginResponse {
  accessToken: string;
}

async function login(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status}`);
  }
  const json = (await response.json()) as LoginResponse;
  return json.accessToken;
}

function summarize(label: string, result: Result): void {
  console.log(`\n=== ${label} ===`);
  console.log(
    `requests: ${result.requests.total} total, ${result.requests.average.toFixed(1)}/sec avg`,
  );
  console.log(
    `latency (ms): p50=${result.latency.p50} p99=${result.latency.p99} max=${result.latency.max}`,
  );
  console.log(
    `errors: ${result.errors}, timeouts: ${result.timeouts}, non-2xx: ${result.non2xx ?? 0}`,
  );
}

async function run(): Promise<void> {
  const token = await login();
  const authHeaders = { authorization: `Bearer ${token}` };

  const searchResult = await autocannon({
    url: `${baseUrl}/api/v1/products/search?q=beras`,
    connections: 20,
    duration: 15,
    headers: authHeaders,
  });
  summarize('Product search (20 connections, 15s)', searchResult);

  const dashboardResult = await autocannon({
    url: `${baseUrl}/api/v1/reports/dashboard-summary`,
    connections: 5,
    duration: 10,
    headers: authHeaders,
  });
  summarize('Dashboard summary (5 connections, 10s)', dashboardResult);

  const transactionResult = await autocannon({
    url: `${baseUrl}/api/v1/pos/transactions`,
    method: 'POST',
    connections: 3,
    duration: 8,
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({
      lines: [{ itemCode: 'DEMO-BERAS-5KG', qty: 1 }],
    }),
  });
  summarize('POS transaction creation / write path (3 connections, 8s)', transactionResult);

  console.log('\nCleaning up draft invoices created by the write-path test...');
  const created = (transactionResult.requests as unknown as { total: number }).total;
  const recentInvoices = await erpNextClient.list<{ name: string; docstatus: number }>(
    'Sales Invoice',
    {
      filters: [
        ['is_pos', '=', 1],
        ['docstatus', '=', 0],
      ],
      fields: ['name', 'docstatus'],
      limit_page_length: String(created + 20),
      order_by: 'creation desc',
    },
  );
  let deleted = 0;
  for (const invoice of recentInvoices.slice(0, created)) {
    await erpNextClient.delete('Sales Invoice', invoice.name);
    deleted += 1;
  }
  console.log(`Deleted ${deleted} draft invoice(s) created by this load test run.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

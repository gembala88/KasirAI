import {
  AuthRequiredError,
  clearAuth,
  getStoredAuth,
  notifyAuthRequired,
  storeAuth,
  type AuthUser,
} from './auth';
import { searchLocalCatalog, syncCatalog, type CatalogItem } from './catalog-cache';
import type { QueuedAction, SyncStatus } from './offline-queue';

const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/**
 * Thrown by get()/post() when the server actually responded but rejected
 * the request (bad data, a permanent validation error, etc.) — distinct
 * from fetch() itself throwing, which means the request never reached the
 * server at all (offline, DNS failure, server unreachable). Real bug this
 * fixes: syncPendingQueue() used to treat both cases identically and abort
 * the whole sweep on the first failure of either kind, so one permanently-
 * broken item anywhere in the queue silently blocked every item behind it
 * from ever being retried, even when the network was fine.
 */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message ?? 'Login gagal');
  }
  const tokens = (await response.json()) as TokenPair;
  storeAuth(tokens);
  // Fire-and-forget: populates the offline product-catalog cache (spec
  // §15.3) for this session. Never blocks login, never surfaces an error
  // to the cashier — a failed sync just means the cache stays at whatever
  // it was left at (empty, on a brand-new device); see triggerCatalogSync.
  void triggerCatalogSync();
  return tokens;
}

/** Also called on the browser's 'online' event (see App.tsx) so a long shift that starts offline still picks up the catalog once connectivity returns. */
export async function triggerCatalogSync(): Promise<void> {
  try {
    await syncCatalog(fetchCatalogPage);
  } catch (err) {
    console.error('Catalog sync failed (will retry on next login/reconnect):', err);
  }
}

function fetchCatalogPage(
  offset: number,
  limit: number,
): Promise<{ items: CatalogItem[]; hasMore: boolean }> {
  return get(`/api/v1/products/catalog?offset=${offset}&limit=${limit}`);
}

export function logout(): void {
  clearAuth();
}

/** Returns the new access token on success, or null if the refresh token is itself invalid/expired. */
async function tryRefresh(): Promise<string | null> {
  const stored = getStoredAuth();
  if (!stored) {
    return null;
  }
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
  });
  if (!response.ok) {
    return null;
  }
  const tokens = (await response.json()) as TokenPair;
  storeAuth({ ...tokens, user: stored.user });
  return tokens.accessToken;
}

/**
 * Every request goes through here — attaches the bearer token, and on a
 * 401 (expired access token) tries exactly one silent refresh-and-retry
 * before giving up. If there's no stored auth at all, or the refresh
 * itself fails, throws AuthRequiredError so the UI can show the login
 * screen instead of a confusing raw fetch error. Mirrors
 * apps/dashboard/src/lib/api.ts's authorizedFetch exactly — same
 * requirement (spec §1.4 "JWT-based auth on every endpoint") applies here,
 * this app just never had it wired up when Phase 8 shipped.
 */
async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const stored = getStoredAuth();
  if (!stored) {
    notifyAuthRequired();
    throw new AuthRequiredError();
  }

  const withAuth = (token: string): RequestInit => ({
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  let response = await fetch(`${API_BASE_URL}${path}`, withAuth(stored.accessToken));

  if (response.status === 401) {
    const refreshed = await tryRefresh();
    if (!refreshed) {
      clearAuth();
      notifyAuthRequired();
      throw new AuthRequiredError();
    }
    response = await fetch(`${API_BASE_URL}${path}`, withAuth(refreshed));
  }

  return response;
}

async function get<T>(path: string): Promise<T> {
  const response = await authorizedFetch(path);
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(
      detail?.message ?? `GET ${path} failed with status ${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await authorizedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(
      detail?.message ?? `POST ${path} failed with status ${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const response = await authorizedFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(
      detail?.message ?? `PUT ${path} failed with status ${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

// --- Offline sync (spec §15.2) ---
// One shared endpoint for every offline action type (scan or POS sale) —
// see apps/api/src/modules/sync for the server-side idempotency this
// relies on (checks `uuid` against already-synced records before ever
// writing to ERPNext).

export interface SyncResponse {
  status: SyncStatus;
  result?: unknown;
  message?: string;
  skipped: boolean;
}

export function syncAction(queued: QueuedAction): Promise<SyncResponse> {
  return post<SyncResponse>('/api/v1/sync/actions', {
    uuid: queued.uuid,
    contentHash: queued.contentHash,
    clientTimestamp: queued.clientTimestamp,
    action: queued.action,
  });
}

// --- Kasir / checkout (spec §1.3 "POS screen (cashier)") ---

export interface ProductSearchResult {
  itemCode: string;
  itemName: string;
  stockUom: string;
  priceList: string;
  price: number | null;
  /**
   * True when this result came from the offline catalog cache while a
   * customer ID was entered — the cache only ever holds Retail-tier
   * pricing (spec §15.3), so a Grosir/Member customer's real price may
   * differ and needs a live lookup to confirm. Never set for walk-in
   * (no customer ID) results, since Retail is exactly what's cached.
   */
  stale?: boolean;
}

export interface PosTransaction {
  name: string;
  status: string;
  customer: string;
  grandTotal: number;
  paidAmount: number;
  outstandingAmount: number;
}

/**
 * Cache-first (spec §15.3 "kasir tetap bisa jualan walau internet mati"):
 * checks the offline catalog before ever touching the network, so a hit is
 * instant whether online or offline. Only falls back to a live search on a
 * cache miss — and only while online, since there's no point attempting a
 * request that can't succeed. `hasCustomer` flags cache-served results as
 * possibly-stale-priced (see ProductSearchResult.stale) rather than trying
 * to guess the customer's actual tier offline.
 */
export async function searchProducts(
  query: string,
  hasCustomer = false,
): Promise<{ results: ProductSearchResult[] }> {
  const cached = await searchLocalCatalog(query);
  if (cached.length > 0) {
    return {
      results: cached.map((item) => ({
        itemCode: item.itemCode,
        itemName: item.itemName,
        stockUom: item.stockUom,
        priceList: 'Retail',
        price: item.retailPrice,
        stale: hasCustomer,
      })),
    };
  }

  if (!navigator.onLine) {
    throw new Error(
      'Barang tidak ditemukan di katalog offline, dan koneksi sedang terputus untuk memeriksa lebih lanjut.',
    );
  }

  return get<{ results: ProductSearchResult[] }>(
    `/api/v1/products/search?q=${encodeURIComponent(query)}`,
  );
}

// --- Gudang / "Tambah Produk Baru" (bulk product onboarding) ---

export interface WarehouseOption {
  name: string;
}

/**
 * Real ERPNext Warehouse records — every Gudang field (Input Stok,
 * Transfer, and "Tambah Produk Baru"'s Stok Awal) is a dropdown built
 * from this list, not free text. Real bug this closes: a free-text
 * Gudang field let a warehouse worker type a plausible-looking but wrong
 * value (confirmed live: "4", "60"), which only failed at ERPNext's own
 * raw error, after the item and its prices were already created.
 * ERPNext's own auto-generated per-Company warehouses (Stores, Work In
 * Progress, etc.) are excluded server-side — this list is only ever the
 * store's actual receiving/selling warehouses. `default` is the one to
 * pre-select rather than leaving the field on an ambiguous placeholder.
 */
export function fetchWarehouses(): Promise<{ warehouses: WarehouseOption[]; default: string }> {
  return get('/api/v1/inventory/warehouses');
}

export interface ItemGroupOption {
  name: string;
}

export function fetchItemGroups(): Promise<{ itemGroups: ItemGroupOption[] }> {
  return get('/api/v1/products/item-groups');
}

export interface UomOption {
  name: string;
}

export function fetchUoms(): Promise<{ uoms: UomOption[] }> {
  return get('/api/v1/products/uoms');
}

export interface ExistingItemUomPrice {
  uom: string;
  retailPrice: number | null;
  grosirPrice: number | null;
}

export interface ExistingItemMatch {
  itemCode: string;
  itemName: string;
  /** One entry per UOM the item actually sells under — base unit first. Grosir is null when offline (only the Retail-only local cache was checked, not "confirmed no Grosir price exists"). */
  uoms: ExistingItemUomPrice[];
}

/**
 * Purpose-built for the onboarding scan flow, not a reuse of
 * searchProducts() above — that function *throws* on a cache-miss while
 * offline (correct for Kasir: can't sell what it can't verify), but here
 * a cache-miss is the normal, expected "this barcode is genuinely new"
 * case, online or off. Returning null (not throwing) is what tells the
 * caller to show the create-item form. If the client-side check is wrong
 * (e.g. someone else registered this exact barcode moments ago on another
 * device, before this one's cache refreshed), the server-side duplicate
 * check in createItem — the actual source of truth — catches it at sync
 * time as a Conflict; this is just a fast, offline-friendly first look.
 */
/** Live per-UOM Retail/Grosir breakdown for one item — used by Daftar Produk's Edit form to prefill current prices (unlike the offline catalog cache, which only ever has Retail). Always online; the edit form itself is Owner/Manager-only, not offered while offline. */
export function fetchItemUomPrices(itemCode: string): Promise<{ item: ExistingItemMatch | null }> {
  return get(`/api/v1/products/${encodeURIComponent(itemCode)}/uom-prices`);
}

export async function findExistingItem(itemCode: string): Promise<ExistingItemMatch | null> {
  const cached = await searchLocalCatalog(itemCode);
  const cachedMatch = cached.find((item) => item.itemCode.toLowerCase() === itemCode.toLowerCase());
  if (cachedMatch) {
    return {
      itemCode: cachedMatch.itemCode,
      itemName: cachedMatch.itemName,
      uoms: [
        { uom: cachedMatch.stockUom, retailPrice: cachedMatch.retailPrice, grosirPrice: null },
      ],
    };
  }

  if (!navigator.onLine) {
    return null;
  }

  const { results } = await get<{ results: ProductSearchResult[] }>(
    `/api/v1/products/search?q=${encodeURIComponent(itemCode)}`,
  );
  const liveMatch = results.find((item) => item.itemCode.toLowerCase() === itemCode.toLowerCase());
  if (!liveMatch) {
    return null;
  }

  const { item } = await get<{ item: ExistingItemMatch | null }>(
    `/api/v1/products/${encodeURIComponent(liveMatch.itemCode)}/uom-prices`,
  );
  return item ?? { itemCode: liveMatch.itemCode, itemName: liveMatch.itemName, uoms: [] };
}

export interface ItemSearchCandidate {
  itemCode: string;
  itemName: string;
  retailPrice: number | null;
}

/**
 * Name-based search for "Cari/Input Manual" (no-barcode products) — a
 * lightweight disambiguation list, not the full per-UOM breakdown
 * findExistingItem returns. Reuses the same fuzzy name+code search Kasir
 * already relies on (searchProducts's or_filters), rather than an
 * exact-code check, since a barcode-less product has no natural code to
 * check against — the whole point here is catching "this might already be
 * registered under a different self-assigned code."
 */
export async function searchItemsByName(query: string): Promise<ItemSearchCandidate[]> {
  if (!navigator.onLine) {
    const cached = await searchLocalCatalog(query);
    return cached.map((item) => ({
      itemCode: item.itemCode,
      itemName: item.itemName,
      retailPrice: item.retailPrice,
    }));
  }
  const { results } = await get<{ results: ProductSearchResult[] }>(
    `/api/v1/products/search?q=${encodeURIComponent(query)}`,
  );
  return results.map((r) => ({ itemCode: r.itemCode, itemName: r.itemName, retailPrice: r.price }));
}

// --- QRIS/Transfer payment confirmation (Group 2) ---

export interface PaymentInfo {
  qris: { imageUrl: string | null };
  transfer: { bankName: string | null; accountNumber: string | null; accountName: string | null };
}

export function fetchPaymentInfo(): Promise<PaymentInfo> {
  return get('/api/v1/pos/payment-info');
}

export interface LowStockAlert {
  itemCode: string;
  itemName: string;
  warehouse: string;
  actualQty: number;
  threshold: number;
}

/** Beranda's low-stock banner (Owner/Manager only — see Home.tsx). Real ERPNext Bin data, not a static list — reuses the same alert the owner dashboard's report already draws on. */
export function fetchLowStockAlerts(): Promise<{ threshold: number; alerts: LowStockAlert[] }> {
  return get('/api/v1/inventory/alerts/low-stock');
}

/**
 * Fetches the ERPNext-rendered receipt (real HTML from its Print Format —
 * see the receipt endpoint for why this isn't built client-side) for
 * inline preview. Real bug found live: the previous window.open()-based
 * flow got silently blocked by the browser's popup blocker ("Popup
 * diblokir browser"), and even when allowed, printing was auto-triggered
 * without a user gesture — a pattern browsers increasingly distrust. This
 * just returns the HTML; the caller renders it inline (an iframe) and
 * calls print() from that iframe on an explicit button tap, which is
 * neither a popup nor an auto-triggered print.
 */
export async function fetchReceiptHtml(transactionName: string): Promise<string> {
  const response = await authorizedFetch(
    `/api/v1/pos/transactions/${encodeURIComponent(transactionName)}/receipt`,
  );
  if (!response.ok) {
    throw new Error(`Gagal memuat struk (status ${response.status})`);
  }
  return response.text();
}

// --- Riwayat Transaksi (transaction history) ---

export interface TransactionPayment {
  modeOfPayment: string;
  amount: number;
}

export interface TransactionSummary {
  name: string;
  customerName: string;
  postingDate: string;
  postingTime: string;
  grandTotal: number;
  outstandingAmount: number;
  isPaid: boolean;
  payments: TransactionPayment[];
}

export interface TransactionLineItem {
  itemCode: string;
  itemName: string;
  qty: number;
  uom: string;
  rate: number;
  amount: number;
}

export interface TransactionDetail extends TransactionSummary {
  items: TransactionLineItem[];
}

/** Always-online, like the rest of Daftar Produk/Edit Price — history lookup has no offline cache. */
export function fetchTransactions(
  offset: number,
  limit: number,
): Promise<{ transactions: TransactionSummary[]; hasMore: boolean }> {
  return get(`/api/v1/pos/transactions?offset=${offset}&limit=${limit}`);
}

export function fetchTransactionDetail(name: string): Promise<TransactionDetail> {
  return get(`/api/v1/pos/transactions/${encodeURIComponent(name)}/detail`);
}

// --- Settings ---

export type ReceiptTemplate = 'Minimal' | 'Standard' | 'Detailed';

export interface ReceiptTemplateInfo {
  template: ReceiptTemplate;
  /** The ERPNext Print Format this template resolves to — used to deep-link into ERPNext's own Print Format designer for header/footer editing, rather than duplicating that editor in-app. */
  printFormat: string;
}

export function fetchReceiptTemplate(): Promise<ReceiptTemplateInfo> {
  return get('/api/v1/settings/receipt-template');
}

export function updateReceiptTemplate(template: ReceiptTemplate): Promise<ReceiptTemplateInfo> {
  return put('/api/v1/settings/receipt-template', { template });
}

export interface StoreProfile {
  companyName: string;
  phone: string;
  address: string;
  logoUrl: string | null;
}

export function fetchStoreProfile(): Promise<StoreProfile> {
  return get('/api/v1/settings/store-profile');
}

export function updateStoreProfile(input: {
  phone: string;
  address: string;
}): Promise<StoreProfile> {
  return put('/api/v1/settings/store-profile', input);
}

/** Real file upload (not a pasted URL) — see settings.ts's uploadCompanyLogo doc comment. Bypasses the JSON post/put helpers since this is a multipart body. */
export async function uploadStoreLogo(file: File): Promise<StoreProfile> {
  const form = new FormData();
  form.append('file', file);
  const response = await authorizedFetch('/api/v1/settings/store-logo', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(
      detail?.message ?? `Logo upload failed with status ${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<StoreProfile>;
}

export interface ReceiptCustomization {
  headerText: string;
  footerText: string;
  logoUrl: string;
}

export function fetchReceiptCustomization(): Promise<ReceiptCustomization> {
  return get('/api/v1/settings/receipt-customization');
}

export function updateReceiptCustomization(
  input: ReceiptCustomization,
): Promise<ReceiptCustomization> {
  return put('/api/v1/settings/receipt-customization', input);
}

// --- Kasbon / credit sale (Group 3) ---

export interface CustomerSearchResult {
  id: string;
  name: string;
  mobileNo: string;
  tier: string;
}

/** Live only (always online, like searchItemsByName) — no offline customer cache exists, so Kasbon's customer picker requires connectivity even though the rest of Kasir works offline. */
export async function searchCustomers(query: string): Promise<CustomerSearchResult[]> {
  const { results } = await get<{ results: CustomerSearchResult[] }>(
    `/api/v1/customers/search?q=${encodeURIComponent(query)}`,
  );
  return results;
}

export interface KasbonInvoice {
  invoice: string;
  customer: string;
  customerName: string;
  grandTotal: number;
  outstandingAmount: number;
  postingDate: string;
  dueDate: string;
  daysUntilDue: number;
  overdue: boolean;
}

/** "Tagihan Kasbon" screen — always-online, like Riwayat Transaksi/Daftar Produk. */
export function fetchKasbonInvoices(): Promise<{ invoices: KasbonInvoice[] }> {
  return get('/api/v1/customers/kasbon');
}

export function confirmKasbonPaid(invoiceName: string): Promise<PosTransaction> {
  return post(`/api/v1/pos/kasbon/${encodeURIComponent(invoiceName)}/confirm-payment`, {});
}

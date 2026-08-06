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
    throw new Error(detail?.message ?? `GET ${path} failed with status ${response.status}`);
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
    throw new Error(detail?.message ?? `POST ${path} failed with status ${response.status}`);
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

/**
 * Opens the ERPNext-rendered receipt (real HTML from its Print Format —
 * see the receipt endpoint for why this isn't built client-side) in a new
 * tab and triggers the browser's native print dialog once it's loaded —
 * works with any printer the OS has a driver for, thermal receipt
 * printers included, no extra software.
 */
export async function openReceipt(transactionName: string): Promise<void> {
  const response = await authorizedFetch(
    `/api/v1/pos/transactions/${encodeURIComponent(transactionName)}/receipt`,
  );
  if (!response.ok) {
    throw new Error(`Gagal memuat struk (status ${response.status})`);
  }
  const html = await response.text();
  const receiptWindow = window.open('', '_blank');
  if (!receiptWindow) {
    throw new Error('Popup diblokir browser — izinkan popup untuk mencetak struk.');
  }
  receiptWindow.document.write(html);
  receiptWindow.document.close();
  receiptWindow.addEventListener('load', () => receiptWindow.print());
}

import {
  AuthRequiredError,
  clearAuth,
  getStoredAuth,
  notifyAuthRequired,
  storeAuth,
  type AuthUser,
} from './auth';
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
  return tokens;
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
}

export interface PosTransaction {
  name: string;
  status: string;
  customer: string;
  grandTotal: number;
  paidAmount: number;
  outstandingAmount: number;
}

export function searchProducts(query: string): Promise<{ results: ProductSearchResult[] }> {
  return get<{ results: ProductSearchResult[] }>(
    `/api/v1/products/search?q=${encodeURIComponent(query)}`,
  );
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

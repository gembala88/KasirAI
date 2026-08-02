import {
  AuthRequiredError,
  clearAuth,
  getStoredAuth,
  notifyAuthRequired,
  storeAuth,
  type AuthUser,
} from './auth';
import type { DashboardSummary, PaymentMethod, PendingPaymentOrder } from './types';

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
 * screen instead of a confusing raw fetch error.
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
    throw new Error(`GET ${path} failed with status ${response.status}`);
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

export function fetchDashboardSummary(): Promise<DashboardSummary> {
  return get<DashboardSummary>('/api/v1/reports/dashboard-summary');
}

export function fetchPendingPayments(): Promise<{ orders: PendingPaymentOrder[] }> {
  return get<{ orders: PendingPaymentOrder[] }>('/api/v1/whatsapp/orders/pending-payment');
}

export function confirmPendingPayment(
  invoiceName: string,
  phoneNumber: string,
  method: PaymentMethod,
): Promise<{ confirmed: boolean; customerNotified: boolean }> {
  return post(`/api/v1/whatsapp/orders/${encodeURIComponent(invoiceName)}/confirm-payment`, {
    phoneNumber,
    method,
  });
}

export function askOwnerChat(prompt: string): Promise<{ reply: string }> {
  return post<{ reply: string }>('/api/v1/ai/query', { prompt });
}

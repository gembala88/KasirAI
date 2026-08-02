// Token storage + login/refresh (spec §1.4 NFR "Security": JWT-based
// auth). localStorage so a reload doesn't force re-login; cleared on
// logout or when a refresh attempt itself fails (§8's hardening: never
// keep using a token the server has already rejected).

export interface AuthUser {
  email: string;
  fullName: string;
  role: 'Owner' | 'Manager' | 'Cashier' | 'Warehouse Staff';
}

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const STORAGE_KEY = 'hermes-dashboard-auth';

export function getStoredAuth(): StoredAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function storeAuth(auth: StoredAuth): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Thrown by lib/api.ts when a request can't be authenticated (no token, or refresh failed) — the UI shows the login screen on this. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Sesi berakhir, silakan login ulang.');
    this.name = 'AuthRequiredError';
  }
}

// A minimal global notification so api.ts (which has no React context) can
// tell App.tsx "the session just expired, drop back to the login screen"
// without every single fetch call site needing to catch AuthRequiredError
// and redirect itself.
let onAuthRequiredCallback: (() => void) | null = null;

export function setOnAuthRequired(callback: (() => void) | null): void {
  onAuthRequiredCallback = callback;
}

export function notifyAuthRequired(): void {
  onAuthRequiredCallback?.();
}

/**
 * Credential verification delegated to ERPNext's own `/api/method/login`
 * (spec §5: Hermes doesn't duplicate ERPNext's schema — a
 * `user_roles_extended` table is only called for "if RBAC needs finer
 * grain than Frappe's native roles", which a single Select field isn't).
 * Hermes never stores or sees a password; ERPNext's own User doctype
 * (bcrypt-hashed) remains the one source of truth for credentials, and
 * this module only issues its own JWTs on top of a successful ERPNext
 * login. Hand-rolled fetch, not the shared token-auth ErpNextClient —
 * this is Frappe's separate cookie-session login endpoint, a different
 * auth mechanism from the `/api/resource` token auth everything else
 * in this codebase uses.
 */
import { env } from '../../../config/env.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { isRole, type Role } from '../domain/index.js';

export interface ErpNextLoginResult {
  fullName: string;
}

/**
 * Returns null for invalid credentials (never throws for that case — it's
 * an expected outcome, not an error).
 *
 * No retry/circuit-breaker here (unlike shared/erpnext-client): a login
 * request has a human in the loop who will simply press "log in" again on
 * a transient failure, unlike the automated/background callers (webhooks,
 * POS transactions, scheduled jobs) the shared client protects.
 */
export async function verifyErpNextCredentials(
  email: string,
  password: string,
): Promise<ErpNextLoginResult | null> {
  let response: Response;
  try {
    response = await fetch(`${env.ERPNEXT_BASE_URL}/api/method/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ usr: email, pwd: password }),
    });
  } catch (cause) {
    throw new Error(`ERPNext login request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  if (response.status === 401 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ERPNext login failed with status ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as { full_name?: string };
  return { fullName: json.full_name ?? email };
}

interface UserDoc {
  hermes_role?: string;
  enabled: number;
}

/** Null if the user has no hermes_role assigned, or is disabled — both are "not authorized for the Hermes app", not an error. */
export async function fetchHermesRole(email: string): Promise<Role | null> {
  const user = await erpNextClient.get<UserDoc>('User', email);
  if (!user.enabled || !isRole(user.hermes_role)) {
    return null;
  }
  return user.hermes_role;
}

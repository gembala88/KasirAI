/**
 * Auth module — login/refresh use cases (spec §6 "POST /auth/login",
 * "POST /auth/refresh").
 */
import { UnauthorizedError } from '../../../shared/errors/index.js';
import type { AuthUser, TokenPair } from '../domain/index.js';
import { fetchHermesRole, verifyErpNextCredentials } from '../infrastructure/erpnext-session.js';
import { issueTokenPair, verifyRefreshToken } from '../infrastructure/jwt.js';

export async function login(email: string, password: string): Promise<TokenPair & { user: AuthUser }> {
  const credentials = await verifyErpNextCredentials(email, password);
  if (!credentials) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const role = await fetchHermesRole(email);
  if (!role) {
    // Valid ERPNext login, but not provisioned for the Hermes app (no
    // hermes_role assigned, or disabled) — deliberately the same
    // "Invalid email or password" message as a wrong password, not a
    // more specific one, so this endpoint never confirms to an
    // unauthenticated caller which ERPNext accounts exist.
    throw new UnauthorizedError('Invalid email or password');
  }

  const user: AuthUser = { email, fullName: credentials.fullName, role };
  return { ...issueTokenPair(user), user };
}

export function refreshAccessToken(refreshToken: string): TokenPair & { user: AuthUser } {
  const user = verifyRefreshToken(refreshToken);
  return { ...issueTokenPair(user), user };
}

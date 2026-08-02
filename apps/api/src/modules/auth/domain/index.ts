/**
 * Auth module — domain layer (spec §1.4 NFR "Security": JWT-based auth,
 * RBAC with at least 4 roles).
 */
import 'fastify';

export const ROLES = ['Owner', 'Manager', 'Cashier', 'Warehouse Staff'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export interface AuthUser {
  email: string;
  fullName: string;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth module's global preHandler once a valid access token is verified. */
    user?: AuthUser;
  }
}

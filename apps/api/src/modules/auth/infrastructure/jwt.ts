/**
 * JWT sign/verify (spec §1.4 NFR "Security": JWT-based auth). Uses the
 * `jsonwebtoken` library rather than hand-rolling — unlike this
 * codebase's other hand-rolled fetch clients (low-risk HTTP calls), JWT
 * has real, well-known implementation pitfalls (algorithm-confusion
 * attacks, timing-unsafe comparison, expiry handling) that a
 * well-audited library exists specifically to avoid getting wrong.
 */
import jwt from 'jsonwebtoken';
import { env } from '../../../config/env.js';
import { UnauthorizedError } from '../../../shared/errors/index.js';
import { isRole, type AuthUser, type TokenPair } from '../domain/index.js';

interface HermesJwtPayload {
  sub: string;
  fullName: string;
  role: string;
  /** Distinguishes access vs refresh tokens — a refresh token must never be accepted where an access token is expected, and vice versa. */
  type: 'access' | 'refresh';
}

function sign(user: AuthUser, type: 'access' | 'refresh', expiresIn: string): string {
  const payload: HermesJwtPayload = {
    sub: user.email,
    fullName: user.fullName,
    role: user.role,
    type,
  };
  const options: jwt.SignOptions = {
    algorithm: 'HS256',
    expiresIn: expiresIn as unknown as NonNullable<jwt.SignOptions['expiresIn']>,
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function issueTokenPair(user: AuthUser): TokenPair {
  return {
    accessToken: sign(user, 'access', env.JWT_ACCESS_TTL),
    refreshToken: sign(user, 'refresh', env.JWT_REFRESH_TTL),
  };
}

function verify(token: string, expectedType: 'access' | 'refresh'): AuthUser {
  let decoded: HermesJwtPayload;
  try {
    // Explicit algorithm allowlist (defense in depth against
    // algorithm-confusion attacks — e.g. a token crafted with `alg: none`
    // or an asymmetric algorithm) even though this app only ever signs
    // with HS256 today.
    decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as HermesJwtPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }

  if (decoded.type !== expectedType || !isRole(decoded.role)) {
    throw new UnauthorizedError('Invalid or expired token');
  }

  return { email: decoded.sub, fullName: decoded.fullName, role: decoded.role };
}

export function verifyAccessToken(token: string): AuthUser {
  return verify(token, 'access');
}

export function verifyRefreshToken(token: string): AuthUser {
  return verify(token, 'refresh');
}

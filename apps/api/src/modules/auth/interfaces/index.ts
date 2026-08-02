export { registerAuthRoutes } from './auth.routes.js';

// Callable exports for other modules and the app bootstrap (§1.4 RBAC) —
// attachAuthentication is called once in main.ts; requireRole is applied
// per-route by every other module's routes file.
export { attachAuthentication, requireRole } from './auth-plugin.js';
export { issueTokenPair } from '../infrastructure/jwt.js';
export { ROLES } from '../domain/index.js';
export type { Role, AuthUser } from '../domain/index.js';

export { registerAiGatewayRoutes } from './ai-gateway.routes.js';

// Callable exports for other modules (whatsapp's conversation actions,
// §7) — same precedent as customer-membership's interfaces barrel
// exporting background-job lifecycle functions, not just HTTP registrars.
export { proposeAction, confirmAction, getAction } from '../application/actions.js';
export { getOrderStatus, cancelOrder } from '../application/orders.js';
export type { SalesOrderSummary } from '../application/orders.js';
export { runAiQuery } from '../application/query.js';

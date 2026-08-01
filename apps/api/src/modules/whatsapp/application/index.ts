/**
 * WhatsApp module — application layer.
 *
 * Use cases / application services (orchestrate domain + infrastructure).
 * Other modules must never import from here directly — only through
 * `../interfaces`.
 */
export { handleInboundMessage } from './conversation.js';
export { confirmPayment } from './actions.js';

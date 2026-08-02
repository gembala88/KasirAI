/**
 * Report/Dashboard module — application layer.
 *
 * Use cases / application services (orchestrate domain + infrastructure).
 * Other modules must never import from here directly — only through
 * `../interfaces`.
 */
export { getDashboardSummary, getSalesReport } from './queries.js';
export { answerOwnerQuestion } from './owner-chat.js';

export { registerReportDashboardRoutes } from './report-dashboard.routes.js';

// Callable export for other modules (ai-gateway's /api/v1/ai/query route,
// which is the owner-analytics-chat endpoint per spec §6).
export { answerOwnerQuestion } from '../application/index.js';

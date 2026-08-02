import type { FastifyInstance } from 'fastify';
import { requireRole } from '../../auth/interfaces/index.js';
import { ValidationError } from '../../../shared/errors/index.js';
import { getDashboardSummary, getSalesReport } from '../application/index.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Report/Dashboard module — public HTTP boundary (spec §1.3 FR-6, FR-8, §6).
 * Analytics are Owner/Manager-only (§1.3 FR-8: "Owner (full analytics)");
 * Cashier/Warehouse Staff don't see revenue/profit data.
 */
export function registerReportDashboardRoutes(app: FastifyInstance): void {
  app.get('/api/v1/reports/_status', async () => ({
    module: 'report-dashboard',
    status: 'scaffolded',
  }));

  app.get(
    '/api/v1/reports/dashboard-summary',
    { preHandler: requireRole('Owner', 'Manager') },
    async () => getDashboardSummary(),
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/v1/reports/sales',
    { preHandler: requireRole('Owner', 'Manager') },
    async (request) => {
      const { from, to } = request.query;
      if (!from || !to || !DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
        throw new ValidationError('"from" and "to" query params are required, format YYYY-MM-DD');
      }
      return getSalesReport(from, to);
    },
  );
}

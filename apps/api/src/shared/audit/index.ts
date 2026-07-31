/**
 * Auditability boundary (NFR, §1.4): every write action (stock change, price
 * change, order creation, AI-proposed action) must be logged with actor,
 * timestamp, and before/after value — persisted to the `ai_action_audit` /
 * general audit tables described in §5.
 *
 * Phase 0 ships the interface plus a console-logging implementation only.
 * A persistent implementation (writing to Hermes' own Postgres/MariaDB
 * database) lands alongside the modules that first need it.
 */
import { logger } from '../logger/index.js';

export interface AuditEntry {
  actor: string;
  action: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
}

class ConsoleAuditLogger implements AuditLogger {
  async record(entry: AuditEntry): Promise<void> {
    logger.info({ audit: entry }, 'audit.record');
  }
}

export const auditLogger: AuditLogger = new ConsoleAuditLogger();

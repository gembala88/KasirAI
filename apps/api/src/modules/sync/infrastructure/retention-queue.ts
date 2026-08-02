/**
 * Data retention scheduled job (post-launch requirement): auto-deletes
 * Synced offline_sync_queue rows older than RETENTION_SYNC_QUEUE_DAYS.
 * Same BullMQ repeatable-job pattern as customer-membership's piutang
 * reminder (reminder-queue.ts) — deliberately not a cron/systemd job on the
 * VPS, since this is app-level data Hermes' own process already owns a
 * scheduler for.
 *
 * Scope is intentionally narrow: this only ever calls
 * cleanupSyncedQueueRows, which only ever deletes `status = 'Synced'` rows
 * from Hermes' own SQLite. It has no ERPNext client, no way to reach
 * ERPNext's database — stock, invoices, reports, and customer data are
 * structurally unreachable from this file, not just policy-excluded.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { env } from '../../../config/env.js';
import { logger } from '../../../shared/logger/index.js';
import { sentry } from '../../../shared/observability/sentry.js';
import { getRedisConnection } from '../../../shared/queue/index.js';
import { cleanupSyncedQueueRows } from '../application/sync.js';

const QUEUE_NAME = 'retention-cleanup';
const SCHEDULER_ID = 'cleanup-synced-queue-rows';

let queue: Queue | undefined;
let worker: Worker | undefined;

export function getRetentionQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

async function processCleanup(): Promise<{ deleted: number }> {
  const { deleted } = cleanupSyncedQueueRows(env.RETENTION_SYNC_QUEUE_DAYS);
  logger.info({ deleted, retentionDays: env.RETENTION_SYNC_QUEUE_DAYS }, 'retention_cleanup.ran');
  return { deleted };
}

/** Starts the worker that processes both the daily schedule and one-off manual triggers. */
export function startRetentionWorker(): Worker {
  worker ??= new Worker(QUEUE_NAME, () => processCleanup(), {
    connection: getRedisConnection(),
  });
  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ err, jobId: job?.id }, 'retention_cleanup.job_failed');
    sentry.captureException(err, { jobId: job?.id });
  });
  return worker;
}

/** Registers the recurring daily cleanup (idempotent — upserting the same scheduler ID replaces it). */
export async function scheduleRepeatingRetentionCleanup(): Promise<void> {
  await getRetentionQueue().upsertJobScheduler(SCHEDULER_ID, {
    pattern: env.RETENTION_CLEANUP_CRON,
  });
}

/** Enqueues a one-off run right now, through the real queue/worker — for manual/ops triggering. */
export async function triggerRetentionCleanupNow(): Promise<{ jobId: string }> {
  const job = await getRetentionQueue().add('manual-cleanup', undefined, {
    jobId: `manual-${randomUUID()}`,
  });
  return { jobId: job.id ?? 'unknown' };
}

export async function closeRetentionQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
}

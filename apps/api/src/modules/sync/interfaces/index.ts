export { registerSyncRoutes } from './sync.routes.js';

// Background job lifecycle (retention cleanup) — same boundary pattern as
// customer-membership's piutang reminder jobs; app bootstrap never imports
// sync/infrastructure directly.
import {
  closeRetentionQueue,
  scheduleRepeatingRetentionCleanup,
  startRetentionWorker,
} from '../infrastructure/retention-queue.js';

export async function startSyncBackgroundJobs(): Promise<void> {
  startRetentionWorker();
  await scheduleRepeatingRetentionCleanup();
}

export async function stopSyncBackgroundJobs(): Promise<void> {
  await closeRetentionQueue();
}

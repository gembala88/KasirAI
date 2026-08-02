/**
 * Piutang reminder job (spec §7 "Piutang reminder flow", §3.3 "Async:
 * BullMQ + Redis ... piutang due-date reminders").
 *
 * This is the boundary the spec describes: a scheduled job checks for
 * piutang nearing due date. What it does with each one — record + publish
 * an event — is as far as this can honestly go until the WhatsApp
 * integration exists (§10 Phase 5). A future notification/whatsapp module
 * subscribes to `piutang.reminder_due` on the shared event bus to actually
 * send the message; faking that send now would violate the same
 * "never fabricate" principle the spec applies to the AI persona (§8.1).
 */
import { Queue, Worker, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { env } from '../../../config/env.js';
import { auditLogger } from '../../../shared/audit/index.js';
import { eventBus } from '../../../shared/event-bus/index.js';
import { logger } from '../../../shared/logger/index.js';
import { sentry } from '../../../shared/observability/sentry.js';
import { getRedisConnection } from '../../../shared/queue/index.js';
import { findDuePiutangReminders } from '../application/piutang.js';

const QUEUE_NAME = 'piutang-reminders';
const SCHEDULER_ID = 'check-piutang-due';

let queue: Queue | undefined;
let worker: Worker | undefined;

export function getPiutangReminderQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

async function processCheckPiutangDue(): Promise<{ remindersFound: number }> {
  const reminders = await findDuePiutangReminders(env.PIUTANG_REMINDER_DAYS_AHEAD);

  for (const reminder of reminders) {
    await auditLogger.record({
      actor: 'system:piutang-reminder-job',
      action: 'piutang.reminder_due',
      after: reminder,
    });
    eventBus.publish('piutang.reminder_due', reminder);
  }

  logger.info(
    { count: reminders.length, daysAhead: env.PIUTANG_REMINDER_DAYS_AHEAD },
    'piutang_reminder.checked',
  );
  return { remindersFound: reminders.length };
}

/** Starts the worker that processes both the daily schedule and one-off manual triggers. */
export function startPiutangReminderWorker(): Worker {
  worker ??= new Worker(QUEUE_NAME, () => processCheckPiutangDue(), {
    connection: getRedisConnection(),
  });
  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ err, jobId: job?.id }, 'piutang_reminder.job_failed');
    sentry.captureException(err, { jobId: job?.id });
  });
  return worker;
}

/** Registers the recurring daily check (idempotent — upserting the same scheduler ID replaces it). */
export async function scheduleRepeatingPiutangCheck(): Promise<void> {
  await getPiutangReminderQueue().upsertJobScheduler(SCHEDULER_ID, {
    pattern: env.PIUTANG_REMINDER_CRON,
  });
}

/** Enqueues a one-off run right now, through the real queue/worker — for manual/ops triggering. */
export async function triggerPiutangCheckNow(): Promise<{ jobId: string }> {
  const job = await getPiutangReminderQueue().add('manual-check', undefined, {
    jobId: `manual-${randomUUID()}`,
  });
  return { jobId: job.id ?? 'unknown' };
}

export async function closePiutangReminderQueue(): Promise<void> {
  await worker?.close();
  await queue?.close();
}

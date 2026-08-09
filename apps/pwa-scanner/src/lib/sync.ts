/**
 * Unified submit path for both screens (spec §15.2). Every action —
 * whether the device is online or not — is written to the local queue
 * FIRST (durable: the intent survives a crash/reload the instant the
 * cashier confirms), then an immediate sync attempt is made. This closes
 * a real gap the old "try direct submit, catch -> enqueue" pattern had:
 * if a submit's request reached the server and was applied, but the
 * *response* never made it back (closed tab, flaky connection right at
 * the end), the old code would think it failed and enqueue a retry —
 * which, without server-side idempotency, would have silently created a
 * duplicate sale/stock movement. Now every attempt (first or retried)
 * carries the same UUID, and the server skips it if that UUID already
 * synced — see apps/api/src/modules/sync.
 */
import { ApiError, syncAction, type SyncResponse } from './api';
import {
  enqueueAction,
  listQueuedActions,
  removeQueuedAction,
  updateActionStatus,
  type QueuedAction,
} from './offline-queue';
import type { OfflineAction, OfflineActionType } from './types';

export type SubmitResult =
  | { outcome: 'synced'; result: unknown }
  // 'rejected' means the server was reached and said no (bad data, a
  // permanent validation error) — other queued items are unaffected and
  // still worth trying. 'network' means the request never reached the
  // server at all — every other item is equally unreachable right now.
  | { outcome: 'queued'; reason: 'network' | 'rejected' }
  | { outcome: 'conflict'; message: string | undefined };

async function trySyncOne(queued: QueuedAction): Promise<SubmitResult> {
  let response: SyncResponse;
  try {
    response = await syncAction(queued);
  } catch (err) {
    // Network/API error — leave it Pending-equivalent (Failed) in the
    // local queue; the next sync sweep (reconnect or manual button)
    // carries the identical UUID, so a retry here is always safe.
    // Real bug found live: this used to discard the caught error
    // entirely, so a real, specific ERPNext validation reason (e.g.
    // "Could not find Row #1: Item Code: X" for a barcode with no
    // matching Item) only ever showed up as "Failed" in the UI, visible
    // nowhere except server logs.
    const message = err instanceof Error ? err.message : String(err);
    await updateActionStatus(queued.uuid, 'Failed', message);
    return { outcome: 'queued', reason: err instanceof ApiError ? 'rejected' : 'network' };
  }

  if (response.status === 'Conflict') {
    await updateActionStatus(queued.uuid, 'Conflict', response.message);
    return { outcome: 'conflict', message: response.message };
  }

  await removeQueuedAction(queued.uuid);
  return { outcome: 'synced', result: response.result };
}

export async function submitOrQueue(
  actionType: OfflineActionType,
  action: OfflineAction,
): Promise<SubmitResult> {
  const queued = await enqueueAction(actionType, action);
  return trySyncOne(queued);
}

export interface SyncSweepSummary {
  synced: number;
  stillQueued: number;
  conflicts: number;
}

/** Retries every queued action still eligible for sync (not already flagged Conflict — those wait for manual review, spec §15.2). */
export async function syncPendingQueue(): Promise<SyncSweepSummary> {
  const pending = await listQueuedActions();
  const summary: SyncSweepSummary = { synced: 0, stillQueued: 0, conflicts: 0 };

  for (const item of pending) {
    if (item.status === 'Conflict') {
      summary.conflicts += 1;
      continue;
    }
    const result = await trySyncOne(item);
    if (result.outcome === 'synced') {
      summary.synced += 1;
    } else if (result.outcome === 'conflict') {
      summary.conflicts += 1;
    } else {
      summary.stillQueued += 1;
      // Real bug found live: this used to break on ANY failure, including
      // a per-item server rejection (bad data, a permanent validation
      // error) — meaning one broken item anywhere in the queue silently
      // blocked every item behind it from ever being retried, even while
      // genuinely online. Only a network-unreachable failure means the
      // rest of the sweep would fail identically; stop burning requests
      // only in that case.
      if (result.reason === 'network') {
        break;
      }
    }
  }

  return summary;
}

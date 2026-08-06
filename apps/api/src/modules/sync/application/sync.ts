/**
 * Sync orchestration (spec §15.2): the one place that enforces "check the
 * UUID against already-synced records before writing — if it already
 * exists, it's skipped (not re-applied)". Everything about durability and
 * duplicate-prevention lives here; process-action.ts only knows how to
 * perform one action, not how to make retrying it safe.
 */
import { computeContentHash } from '../../../shared/content-hash/index.js';
import { ValidationError } from '../../../shared/errors/index.js';
import type { SyncRequest, SyncResponse } from '../domain/index.js';
import * as syncStore from '../infrastructure/sync-store.js';
import { isConflict, processAction } from './process-action.js';

export async function syncAction(request: SyncRequest): Promise<SyncResponse> {
  const expectedHash = computeContentHash(request.action);
  if (expectedHash !== request.contentHash) {
    throw new ValidationError(
      'Content hash mismatch — the payload may have been corrupted or altered in transit',
    );
  }

  const existing = syncStore.findByUuid(request.uuid);

  // The core §15.2 guarantee: a UUID already marked Synced or Conflict is
  // never re-applied, no matter how many times the client retries it.
  if (existing?.status === 'Synced') {
    return { status: 'Synced', result: existing.result, skipped: true };
  }
  if (existing?.status === 'Conflict') {
    return { status: 'Conflict', message: existing.errorMessage ?? undefined, skipped: true };
  }

  if (!existing) {
    syncStore.insertProcessing(
      request.uuid,
      request.action.type,
      request.contentHash,
      request.clientTimestamp,
      request.action,
    );
  } else {
    // A Failed row being retried.
    syncStore.markProcessing(request.uuid);
  }

  try {
    const result = await processAction(request.uuid, request.action);
    const reference =
      (result as { name?: string } | undefined)?.name ??
      syncStore.findByUuid(request.uuid)?.erpnextReference ??
      request.uuid;
    syncStore.markSynced(request.uuid, reference, result);
    return { status: 'Synced', result, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isConflict(error)) {
      syncStore.markConflict(request.uuid, message);
      return { status: 'Conflict', message, skipped: false };
    }
    syncStore.markFailed(request.uuid, message);
    throw error;
  }
}

export function listConflicts() {
  return syncStore.listConflicts();
}

/** Data retention (post-launch requirement): purges Synced sync-queue rows older than `retentionDays`. Never touches ERPNext. */
export function cleanupSyncedQueueRows(retentionDays: number): { deleted: number } {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deleted = syncStore.deleteSyncedOlderThan(cutoff);
  return { deleted };
}

/**
 * offline_sync_queue persistence (spec §5, §15.2). Thin wrapper over
 * Hermes' own SQLite — same pattern as ai-gateway's ai_action_audit
 * store (apps/api/src/modules/ai-gateway/application/actions.ts).
 */
import { getDb } from '../../../shared/database/index.js';
import type {
  OfflineAction,
  OfflineActionType,
  SyncQueueRow,
  SyncStatus,
} from '../domain/index.js';

interface Row {
  uuid: string;
  action_type: string;
  content_hash: string;
  client_timestamp: string;
  status: string;
  payload: string;
  erpnext_reference: string | null;
  result: string | null;
  error_message: string | null;
  created_at: string;
  synced_at: string | null;
}

function rowToQueueRow(row: Row): SyncQueueRow {
  return {
    uuid: row.uuid,
    actionType: row.action_type as OfflineActionType,
    contentHash: row.content_hash,
    clientTimestamp: row.client_timestamp,
    status: row.status as SyncStatus,
    payload: JSON.parse(row.payload) as OfflineAction,
    erpnextReference: row.erpnext_reference,
    result: row.result ? JSON.parse(row.result) : null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    syncedAt: row.synced_at,
  };
}

export function findByUuid(uuid: string): SyncQueueRow | undefined {
  const row = getDb().prepare('SELECT * FROM offline_sync_queue WHERE uuid = ?').get(uuid) as
    Row | undefined;
  return row ? rowToQueueRow(row) : undefined;
}

export function insertProcessing(
  uuid: string,
  actionType: OfflineActionType,
  contentHash: string,
  clientTimestamp: string,
  payload: OfflineAction,
): void {
  getDb()
    .prepare(
      `INSERT INTO offline_sync_queue
        (uuid, action_type, content_hash, client_timestamp, status, payload, created_at)
       VALUES (?, ?, ?, ?, 'Processing', ?, ?)`,
    )
    .run(
      uuid,
      actionType,
      contentHash,
      clientTimestamp,
      JSON.stringify(payload),
      new Date().toISOString(),
    );
}

export function markProcessing(uuid: string): void {
  getDb()
    .prepare(
      "UPDATE offline_sync_queue SET status = 'Processing', error_message = NULL WHERE uuid = ?",
    )
    .run(uuid);
}

/** Records the ERPNext reference as soon as it's known — before the action is fully done — so a retry after a partial failure (e.g. invoice created but payment not yet recorded) can resume instead of re-creating a document. */
export function savePartialReference(uuid: string, erpnextReference: string): void {
  getDb()
    .prepare('UPDATE offline_sync_queue SET erpnext_reference = ? WHERE uuid = ?')
    .run(erpnextReference, uuid);
}

export function markSynced(uuid: string, erpnextReference: string, result: unknown): void {
  getDb()
    .prepare(
      `UPDATE offline_sync_queue
       SET status = 'Synced', erpnext_reference = ?, result = ?, synced_at = ?, error_message = NULL
       WHERE uuid = ?`,
    )
    .run(erpnextReference, JSON.stringify(result), new Date().toISOString(), uuid);
}

export function markFailed(uuid: string, errorMessage: string): void {
  getDb()
    .prepare("UPDATE offline_sync_queue SET status = 'Failed', error_message = ? WHERE uuid = ?")
    .run(errorMessage, uuid);
}

export function markConflict(uuid: string, errorMessage: string): void {
  getDb()
    .prepare("UPDATE offline_sync_queue SET status = 'Conflict', error_message = ? WHERE uuid = ?")
    .run(errorMessage, uuid);
}

export function listConflicts(): SyncQueueRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM offline_sync_queue WHERE status = 'Conflict' ORDER BY created_at DESC")
    .all() as unknown as Row[];
  return rows.map(rowToQueueRow);
}

/**
 * Deletes Synced rows older than the cutoff — data retention policy. Only
 * ever targets `status = 'Synced'`: Pending/Processing/Failed/Retry/Conflict
 * rows represent unresolved state and must never be silently deleted, and
 * this function has no way to reach ERPNext's own data at all. Returns the
 * number of rows actually deleted, for real reporting rather than a guess.
 */
export function deleteSyncedOlderThan(cutoffIso: string): number {
  const result = getDb()
    .prepare("DELETE FROM offline_sync_queue WHERE status = 'Synced' AND synced_at < ?")
    .run(cutoffIso);
  return Number(result.changes);
}

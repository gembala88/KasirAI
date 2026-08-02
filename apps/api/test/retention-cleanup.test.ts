import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/shared/database/index.js';
import { cleanupSyncedQueueRows } from '../src/modules/sync/application/index.js';

function insertQueueRow(overrides: {
  uuid: string;
  status: string;
  syncedAt: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO offline_sync_queue
        (uuid, action_type, content_hash, client_timestamp, status, payload, created_at, synced_at)
       VALUES (?, 'pos-sale', 'hash', '2026-01-01T00:00:00.000Z', ?, '{}', '2026-01-01T00:00:00.000Z', ?)`,
    )
    .run(overrides.uuid, overrides.status, overrides.syncedAt);
}

function rowExists(uuid: string): boolean {
  return (
    getDb().prepare('SELECT 1 FROM offline_sync_queue WHERE uuid = ?').get(uuid) !== undefined
  );
}

describe('cleanupSyncedQueueRows — data retention (§ post-launch requirement)', () => {
  beforeEach(() => {
    getDb().exec('DELETE FROM offline_sync_queue');
  });

  it('deletes only Synced rows older than the retention window', () => {
    const now = Date.now();
    const oldSynced = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days ago
    const recentSynced = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago

    insertQueueRow({ uuid: 'old-synced', status: 'Synced', syncedAt: oldSynced });
    insertQueueRow({ uuid: 'recent-synced', status: 'Synced', syncedAt: recentSynced });

    const { deleted } = cleanupSyncedQueueRows(30);

    expect(deleted).toBe(1);
    expect(rowExists('old-synced')).toBe(false);
    expect(rowExists('recent-synced')).toBe(true);
  });

  it('never deletes unresolved rows (Pending/Processing/Failed/Retry/Conflict), regardless of age', () => {
    const veryOld = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();

    insertQueueRow({ uuid: 'old-processing', status: 'Processing', syncedAt: null });
    insertQueueRow({ uuid: 'old-failed', status: 'Failed', syncedAt: null });
    insertQueueRow({ uuid: 'old-conflict', status: 'Conflict', syncedAt: null });
    // A row that somehow has a stale synced_at but a non-Synced status must
    // still survive — the WHERE clause filters on status, not just the date.
    insertQueueRow({ uuid: 'stale-timestamp-but-conflict', status: 'Conflict', syncedAt: veryOld });

    const { deleted } = cleanupSyncedQueueRows(30);

    expect(deleted).toBe(0);
    expect(rowExists('old-processing')).toBe(true);
    expect(rowExists('old-failed')).toBe(true);
    expect(rowExists('old-conflict')).toBe(true);
    expect(rowExists('stale-timestamp-but-conflict')).toBe(true);
  });
});

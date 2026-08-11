import { beforeEach, describe, expect, it, vi } from 'vitest';

// sync.ts's two dependencies (offline-queue.ts's IndexedDB store, api.ts's
// network calls) are mocked entirely rather than exercised for real,
// matching this project's convention of not unit-testing IndexedDB-backed
// code directly (see catalog-cache.test.ts) — what's under test here is
// syncPendingQueue's own control flow: which failures should abort the
// sweep and which shouldn't.

const offlineQueueMock = {
  enqueueAction: vi.fn(),
  listQueuedActions: vi.fn(),
  updateActionStatus: vi.fn(),
  removeQueuedAction: vi.fn(),
};
vi.mock('./offline-queue', () => offlineQueueMock);

const apiMock = {
  syncAction: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  },
};
vi.mock('./api', () => apiMock);

const { syncPendingQueue } = await import('./sync');

function queuedAction(uuid: string) {
  return {
    uuid,
    actionType: 'add-stock' as const,
    action: { type: 'add-stock' as const, itemCode: uuid, qty: 1, rate: 1000 },
    contentHash: 'hash',
    clientTimestamp: '2026-08-10T10:00:00.000Z',
    status: 'Pending' as const,
  };
}

describe('syncPendingQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a per-item server rejection does not block the rest of the sweep — real bug: this used to break on the first failure of any kind', async () => {
    offlineQueueMock.listQueuedActions.mockResolvedValue([
      queuedAction('dead-item'),
      queuedAction('good-item'),
    ]);
    apiMock.syncAction
      .mockRejectedValueOnce(new apiMock.ApiError('Nilai Penilaian diperlukan', 417))
      .mockResolvedValueOnce({ status: 'Synced', result: { name: 'MAT-STE-1' }, skipped: false });

    const summary = await syncPendingQueue();

    expect(apiMock.syncAction).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({ synced: 1, stillQueued: 1, conflicts: 0 });
    // The server was actually reached and it said no — this is a real
    // Failed, not a "haven't tried yet" state.
    expect(offlineQueueMock.updateActionStatus).toHaveBeenCalledWith(
      'dead-item',
      'Failed',
      'Nilai Penilaian diperlukan',
    );
  });

  it('a genuine network failure stops the sweep — every other item would fail identically right now', async () => {
    offlineQueueMock.listQueuedActions.mockResolvedValue([
      queuedAction('unreachable-1'),
      queuedAction('unreachable-2'),
    ]);
    apiMock.syncAction.mockRejectedValue(new TypeError('Failed to fetch'));

    const summary = await syncPendingQueue();

    expect(apiMock.syncAction).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ synced: 0, stillQueued: 1, conflicts: 0 });
    // Real bug found live: a pure network failure (fetch never reached
    // our server at all, e.g. genuinely offline) used to be stamped
    // Failed same as a real server rejection — alarming a cashier over a
    // sale that's perfectly safe and hasn't actually been rejected by
    // anyone. Nothing was tried-and-refused here, so it stays Pending
    // ("Menunggu Disimpan" in the UI), not Failed ("Gagal").
    expect(offlineQueueMock.updateActionStatus).toHaveBeenCalledWith(
      'unreachable-1',
      'Pending',
      'Failed to fetch',
    );
  });

  it('a Conflict-flagged item is skipped, never retried, and does not block subsequent items', async () => {
    offlineQueueMock.listQueuedActions.mockResolvedValue([
      { ...queuedAction('conflicted'), status: 'Conflict' as const },
      queuedAction('good-item'),
    ]);
    apiMock.syncAction.mockResolvedValue({
      status: 'Synced',
      result: { name: 'MAT-STE-2' },
      skipped: false,
    });

    const summary = await syncPendingQueue();

    expect(apiMock.syncAction).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ synced: 1, stillQueued: 0, conflicts: 1 });
  });
});

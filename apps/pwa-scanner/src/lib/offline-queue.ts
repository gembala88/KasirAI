/**
 * Offline action queue (spec §1.3 FR-7, strengthened by §15.2). Every
 * queued action gets, at creation time on the device — before it ever
 * reaches the network — a client-generated UUID (permanent identity, used
 * server-side to detect a retried/duplicated sync), a content hash (lets
 * the server detect a corrupted payload), a client timestamp (when it was
 * actually created, not when it happened to sync), and a status field.
 */
import { getDb, PENDING_ACTIONS_STORE as STORE_NAME } from './db';
import { computeContentHash } from './hash';
import type { OfflineAction, OfflineActionType } from './types';

export type SyncStatus = 'Pending' | 'Processing' | 'Synced' | 'Failed' | 'Retry' | 'Conflict';

/**
 * Fired whenever the queue's contents change — the one signal both Kasir
 * and WarehouseScan listen for to refresh their own displayed queue list.
 * Needed because a sync sweep can now be triggered from outside either
 * screen (App.tsx's online-reconnect handler), so a screen mounted at the
 * time has no other way to know its list just went stale.
 */
export const QUEUE_CHANGED_EVENT = 'hermes:queue-changed';

function notifyQueueChanged(): void {
  window.dispatchEvent(new Event(QUEUE_CHANGED_EVENT));
}

export interface QueuedAction {
  uuid: string;
  actionType: OfflineActionType;
  action: OfflineAction;
  contentHash: string;
  clientTimestamp: string;
  status: SyncStatus;
  lastError?: string;
}

export async function enqueueAction(
  actionType: OfflineActionType,
  action: OfflineAction,
): Promise<QueuedAction> {
  const queued: QueuedAction = {
    uuid: crypto.randomUUID(),
    actionType,
    action,
    contentHash: await computeContentHash(action),
    clientTimestamp: new Date().toISOString(),
    status: 'Pending',
  };
  const db = await getDb();
  await db.add(STORE_NAME, queued);
  notifyQueueChanged();
  return queued;
}

export async function listQueuedActions(): Promise<QueuedAction[]> {
  const db = await getDb();
  return (await db.getAll(STORE_NAME)) as QueuedAction[];
}

export async function updateActionStatus(
  uuid: string,
  status: SyncStatus,
  lastError?: string,
): Promise<void> {
  const db = await getDb();
  const existing = (await db.get(STORE_NAME, uuid)) as QueuedAction | undefined;
  if (!existing) return;
  await db.put(STORE_NAME, { ...existing, status, ...(lastError ? { lastError } : {}) });
  notifyQueueChanged();
}

export async function removeQueuedAction(uuid: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, uuid);
  notifyQueueChanged();
}

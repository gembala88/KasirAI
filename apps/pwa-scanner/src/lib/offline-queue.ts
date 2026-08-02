/**
 * Offline action queue (spec §1.3 FR-7, strengthened by §15.2). Every
 * queued action gets, at creation time on the device — before it ever
 * reaches the network — a client-generated UUID (permanent identity, used
 * server-side to detect a retried/duplicated sync), a content hash (lets
 * the server detect a corrupted payload), a client timestamp (when it was
 * actually created, not when it happened to sync), and a status field.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { computeContentHash } from './hash';
import type { OfflineAction, OfflineActionType } from './types';

const DB_NAME = 'hermes-scanner';
// Bumped from 1: the store's identity moved from an IndexedDB
// auto-increment key to the action's own UUID (spec §15.2 — the
// autoincrement key was never a real transaction identity, just a local
// row number). Old-shape data is not migrated; pre-launch, there's no
// real queued data at risk, and re-creating the store is simpler and
// more honest than pretending to migrate a shape that had none of the
// new required fields anyway.
const DB_VERSION = 2;
const STORE_NAME = 'pending-actions';

export type SyncStatus = 'Pending' | 'Processing' | 'Synced' | 'Failed' | 'Retry' | 'Conflict';

export interface QueuedAction {
  uuid: string;
  actionType: OfflineActionType;
  action: OfflineAction;
  contentHash: string;
  clientTimestamp: string;
  status: SyncStatus;
  lastError?: string;
}

let dbPromise: Promise<IDBPDatabase> | undefined;

function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'uuid' });
    },
    // Found live: without this, a stale connection at the old schema
    // version (e.g. a second open tab left in the background, or — as
    // hit while testing this — a leftover connection from a dev
    // hot-reload) blocks this version upgrade *forever*: no error, no
    // timeout, the checkout just hangs on "Memproses…" indefinitely.
    // The fix IndexedDB itself expects: a connection that's *about to
    // become* the thing blocking some future newer version must close
    // itself when that happens, so the upgrade can proceed instead of
    // waiting on a tab the user may have long since forgotten about.
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as unknown as IDBDatabase | null)?.close();
      dbPromise = undefined;
    },
  });
  return dbPromise;
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
}

export async function removeQueuedAction(uuid: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, uuid);
}

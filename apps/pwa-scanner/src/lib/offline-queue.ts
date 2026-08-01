/**
 * Offline action queue (spec §1.3 FR-7): scan actions taken while offline
 * are stored in IndexedDB and synced when connection returns.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { ScanAction } from './types';

const DB_NAME = 'hermes-scanner';
const DB_VERSION = 1;
const STORE_NAME = 'pending-actions';

export interface QueuedAction {
  id: number;
  action: ScanAction;
  queuedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | undefined;

function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    },
  });
  return dbPromise;
}

export async function enqueueAction(action: ScanAction): Promise<void> {
  const db = await getDb();
  await db.add(STORE_NAME, { action, queuedAt: new Date().toISOString() });
}

export async function listQueuedActions(): Promise<QueuedAction[]> {
  const db = await getDb();
  return (await db.getAll(STORE_NAME)) as QueuedAction[];
}

export async function removeQueuedAction(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, id);
}

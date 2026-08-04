/**
 * Single shared IndexedDB connection for 'hermes-scanner' — offline-queue.ts
 * and catalog-cache.ts both store data here. IndexedDB versions a whole
 * database, not a store: only one `upgrade()` callback ever runs per actual
 * version bump (the one attached to whichever open() call triggered it), so
 * two modules each independently calling openDB(DB_NAME, ownVersion, {...})
 * would race for which one's callback wins — the loser's store never gets
 * created. Consolidating schema setup here avoids that entirely.
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'hermes-scanner';
// v1 -> v2 (offline-queue): store's identity moved from an auto-increment
// key to the action's own UUID.
// v2 -> v3 (catalog-cache, spec §15.3 "kasir tetap bisa jualan walau
// internet mati"): adds the offline product-catalog store.
const DB_VERSION = 3;

export const PENDING_ACTIONS_STORE = 'pending-actions';
export const PRODUCT_CATALOG_STORE = 'product-catalog';

let dbPromise: Promise<IDBPDatabase> | undefined;

export function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 2 && db.objectStoreNames.contains(PENDING_ACTIONS_STORE)) {
        db.deleteObjectStore(PENDING_ACTIONS_STORE);
      }
      if (!db.objectStoreNames.contains(PENDING_ACTIONS_STORE)) {
        db.createObjectStore(PENDING_ACTIONS_STORE, { keyPath: 'uuid' });
      }
      if (!db.objectStoreNames.contains(PRODUCT_CATALOG_STORE)) {
        db.createObjectStore(PRODUCT_CATALOG_STORE, { keyPath: 'itemCode' });
      }
    },
    // Found live (offline-queue.ts): without this, a stale connection at
    // an old schema version (a second open tab, a leftover dev hot-reload
    // connection) blocks this version upgrade *forever* — no error, no
    // timeout, callers just hang. The fix IndexedDB itself expects: a
    // connection that's about to block a newer version must close itself.
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as unknown as IDBDatabase | null)?.close();
      dbPromise = undefined;
    },
  });
  return dbPromise;
}

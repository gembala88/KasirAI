/**
 * Fetches fresh when online, falls back to whatever was cached last when
 * not — a plain localStorage entry, not IndexedDB: these are small,
 * rarely-changing lookups (Item Groups, UOMs, Warehouses), unlike the
 * product catalog's own dedicated store (spec §15.3), so the heavier
 * machinery isn't warranted here. Shared by TambahProdukBaru and
 * WarehouseScan, which both need a Gudang list. Generic over any
 * JSON-serializable value, not just arrays — the warehouse lookup caches
 * `{ warehouses, default }` as one object so the default survives offline
 * too.
 */
export async function loadWithCacheFallback<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  emptyValue: T,
): Promise<T> {
  if (navigator.onLine) {
    try {
      const fresh = await fetcher();
      localStorage.setItem(cacheKey, JSON.stringify(fresh));
      return fresh;
    } catch {
      // Fall through to whatever's cached — a stale list beats none.
    }
  }
  const cached = localStorage.getItem(cacheKey);
  return cached ? (JSON.parse(cached) as T) : emptyValue;
}

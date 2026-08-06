/**
 * Offline product-catalog cache (spec §15.3 "kasir tetap bisa jualan walau
 * internet mati"). searchProducts() in api.ts reads this before ever
 * touching the network, so a cashier can find and ring up an item they
 * haven't personally searched for yet this session, not just whatever's
 * still sitting in on-screen state.
 *
 * Sync strategy is deliberately a full replace, not incremental
 * (add/changed/deleted diffing): this store's realistic size is hundreds
 * to low thousands of SKUs (see README's ~5,000-SKU infra-upgrade
 * trigger), so a full re-pull is a few seconds even on a slow connection,
 * and it sidesteps an entire class of incremental-sync bugs (a disabled
 * Item lingering forever because its "deleted" event was missed, a page
 * that failed partway leaving the cache in a half-updated state) that
 * aren't worth the complexity for a catalog this size, pre-launch.
 *
 * Price caveat: only Retail-tier pricing is cached (see the backend's
 * CatalogItem doc comment) — a Grosir/Member customer's real price still
 * needs a live lookup. api.ts's searchProducts() flags this by setting
 * `stale: true` on cache-served results whenever a customerId is present,
 * since the client has no offline way to know a customer's actual tier.
 */
import { getDb, PRODUCT_CATALOG_STORE as STORE_NAME } from './db';

const LAST_SYNCED_KEY = 'hermes-pwa-scanner-catalog-synced-at';
const PAGE_SIZE = 200;

export interface CatalogItem {
  itemCode: string;
  itemName: string;
  stockUom: string;
  retailPrice: number | null;
  stockQty: number;
}

interface CatalogPage {
  items: CatalogItem[];
  hasMore: boolean;
}

export function getLastSyncedAt(): string | null {
  return localStorage.getItem(LAST_SYNCED_KEY);
}

/** Case-insensitive substring match on code or name — mirrors the backend's `like %q%` search. */
export function matchCatalog(items: CatalogItem[], query: string): CatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return items.filter(
    (item) =>
      item.itemCode.toLowerCase().includes(needle) || item.itemName.toLowerCase().includes(needle),
  );
}

export async function searchLocalCatalog(query: string): Promise<CatalogItem[]> {
  const db = await getDb();
  const all = (await db.getAll(STORE_NAME)) as CatalogItem[];
  return matchCatalog(all, query);
}

/** Full cached catalog, for a browse/list view rather than Kasir's search-as-you-type. */
export async function listAllCatalogItems(): Promise<CatalogItem[]> {
  const db = await getDb();
  return (await db.getAll(STORE_NAME)) as CatalogItem[];
}

export interface CatalogSyncResult {
  itemCount: number;
  syncedAt: string;
}

/**
 * Pages through GET /api/v1/products/catalog and replaces the local store
 * wholesale. Fetches every page into memory first, then writes — so a sync
 * that dies partway (network drops mid-pull) leaves yesterday's cache
 * intact rather than a half-replaced one; only a *complete* pull commits.
 */
export async function syncCatalog(
  fetchPage: (offset: number, limit: number) => Promise<CatalogPage>,
): Promise<CatalogSyncResult> {
  const allItems: CatalogItem[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, PAGE_SIZE);
    allItems.push(...page.items);
    if (!page.hasMore) {
      break;
    }
    offset += PAGE_SIZE;
  }

  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.store.clear();
  await Promise.all(allItems.map((item) => tx.store.put(item)));
  await tx.done;

  const syncedAt = new Date().toISOString();
  localStorage.setItem(LAST_SYNCED_KEY, syncedAt);
  return { itemCount: allItems.length, syncedAt };
}

/**
 * Inventory module — stock read cache (spec §1.3 FR-2: "Real-time stock
 * read from ERPNext (never cached as source of truth; cache only for
 * read-speed with TTL + webhook invalidation)").
 *
 * In-memory, single-process. Fine for Phase 2's single-instance API; if
 * the API ever runs as multiple instances, this needs to move to Redis —
 * the interface below is small enough that swap is mechanical.
 */
import type { StockLevel } from '../domain/index.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Invalidate every cached key for an item, regardless of warehouse. */
  invalidateItem(itemCode: string): void {
    const prefix = `${itemCode}::`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}

export function stockCacheKey(itemCode: string, warehouse?: string): string {
  return `${itemCode}::${warehouse ?? '*'}`;
}

/** 30s TTL — short enough that a missed webhook invalidation self-heals fast. */
export const stockCache = new TtlCache<StockLevel[]>(30_000);

import { useEffect, useState } from 'react';
import { searchProducts, type ProductSearchResult } from './api';

/**
 * Debounced live-search-as-you-type, shared by Kasir (name/code search
 * while ringing up a sale) and WarehouseScan's Kode Barang field (name
 * search while receiving/counting stock) — same underlying catalog and
 * searchProducts() call, just wired to a different input and a different
 * "on select" action per caller. Never auto-selects anything itself; it
 * only ever populates `results` for the caller to render as a picker.
 * `hasCustomer` mirrors Kasir's stale-price flag (see ProductSearchResult
 * and searchProducts' doc comments) — pass `false` for non-sales contexts
 * where there's no customer tier to worry about.
 */
export function useProductSearch(query: string, hasCustomer = false) {
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      searchProducts(trimmed, hasCustomer)
        .then(({ results }) => {
          // Guards against an older, slower request resolving after a
          // newer one — showing a stale match list is exactly the bug
          // this debounce exists to prevent.
          if (cancelled) return;
          setError(null);
          setResults(results);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, hasCustomer]);

  return {
    results,
    searching,
    error,
    setResults,
    clearResults: () => setResults([]),
  };
}

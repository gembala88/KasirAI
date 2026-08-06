/**
 * Small, shared ERPNext read queries (price/stock) used by three-plus
 * modules (sales-pos, ai-gateway, whatsapp) — promoted here instead of
 * staying duplicated per-module once a third copy would have made it a
 * real DRY violation rather than the "three similar lines" that's
 * usually fine to leave alone. Deliberately minimal: just the shared
 * kernel, not a cross-module dependency (§2.1, §3.3).
 *
 * inventory's own `getStock` stays inventory-owned — it does caching and
 * returns multi-warehouse records, a genuinely different shape/concern
 * from the single-number lookups here.
 */
import { erpNextClient } from '../erpnext-client/index.js';

const CUSTOMER_TIERS = ['Retail', 'Grosir', 'Member'] as const;

/** Unknown/missing tier defaults to Retail — the walk-in customer default. */
export function resolvePriceListForTier(tier: string | undefined): string {
  const match = CUSTOMER_TIERS.find((t) => t === tier);
  return match ?? 'Retail';
}

interface ItemPriceRecord {
  price_list_rate: number;
  uom: string | null;
}

/**
 * Every caller here (Kasir, WhatsApp ordering, the AI gateway) has always
 * meant "the item's one selling price" — i.e. its base/stock unit. That
 * held automatically while every item had exactly one Item Price row per
 * price list. Multi-UOM items (spec: "Tambah Produk Baru" package UOMs)
 * can now have several rows per price list, one per UOM — so on the rare
 * item that actually has more than one, resolve to the row matching the
 * item's own stock_uom rather than an arbitrary one. The extra Item fetch
 * only happens in that ambiguous case, never for an ordinary single-UOM item.
 */
export async function lookupItemPrice(itemCode: string, priceList: string): Promise<number | null> {
  const prices = await erpNextClient.list<ItemPriceRecord>('Item Price', {
    filters: [
      ['item_code', '=', itemCode],
      ['price_list', '=', priceList],
    ],
    fields: ['price_list_rate', 'uom'],
  });
  if (prices.length <= 1) {
    return prices[0]?.price_list_rate ?? null;
  }
  const item = await erpNextClient.get<{ stock_uom: string }>('Item', itemCode);
  const base = prices.find((p) => p.uom === item.stock_uom);
  return (base ?? prices[0])!.price_list_rate;
}

interface BinRecord {
  actual_qty: number;
}

/** Uncached single-warehouse stock quantity — see inventory's own getStock for the cached, multi-warehouse version. */
export async function getStockQty(itemCode: string, warehouse: string): Promise<number> {
  const bins = await erpNextClient.list<BinRecord>('Bin', {
    filters: [
      ['item_code', '=', itemCode],
      ['warehouse', '=', warehouse],
    ],
    fields: ['actual_qty'],
  });
  return bins[0]?.actual_qty ?? 0;
}

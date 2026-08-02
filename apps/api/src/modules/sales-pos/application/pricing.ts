/**
 * Sales/POS module — product search & tier-aware pricing (spec §1.3 FR-1).
 */
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { lookupItemPrice, resolvePriceListForTier } from '../../../shared/erpnext-queries/index.js';
import type { ProductPrice, ProductSearchResult } from '../domain/index.js';

export const resolvePriceList = resolvePriceListForTier;

interface ItemRecord {
  item_code: string;
  item_name: string;
  stock_uom: string;
}

export async function getProductPrice(
  itemCode: string,
  tier: string | undefined,
): Promise<ProductPrice> {
  const priceList = resolvePriceListForTier(tier);
  const price = await lookupItemPrice(itemCode, priceList);
  return { itemCode, priceList, price };
}

export async function searchProducts(
  query: string,
  tier: string | undefined,
): Promise<ProductSearchResult[]> {
  const priceList = resolvePriceListForTier(tier);

  const items = await erpNextClient.list<ItemRecord>('Item', {
    filters: [['disabled', '=', 0]],
    // A barcode scanner (or a cashier typing a code from memory) enters
    // the item *code*, not its display name — searching only item_name
    // meant a literal barcode/code scan matched nothing. or_filters is
    // Frappe's OR-group (combined with `filters` via AND), so this reads
    // as "not disabled, AND (code matches OR name matches)".
    or_filters: [
      ['item_code', 'like', `%${query}%`],
      ['item_name', 'like', `%${query}%`],
    ],
    fields: ['item_code', 'item_name', 'stock_uom'],
    limit_page_length: '20',
  });

  return Promise.all(
    items.map(async (item) => ({
      itemCode: item.item_code,
      itemName: item.item_name,
      stockUom: item.stock_uom,
      priceList,
      price: await lookupItemPrice(item.item_code, priceList),
    })),
  );
}

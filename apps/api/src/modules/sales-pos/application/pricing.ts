/**
 * Sales/POS module — product search & tier-aware pricing (spec §1.3 FR-1).
 */
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { lookupItemPrice, resolvePriceListForTier } from '../../../shared/erpnext-queries/index.js';
import type { CatalogItem, ProductPrice, ProductSearchResult } from '../domain/index.js';

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

interface ItemPriceRecord {
  item_code: string;
  price_list_rate: number;
}

export interface CatalogPage {
  items: CatalogItem[];
  hasMore: boolean;
}

/**
 * Bulk catalog pull for pwa-scanner's offline product cache (spec §15.3 —
 * "kasir tetap bisa jualan walau internet mati"). Unlike searchProducts,
 * this does two BULK ERPNext calls per page instead of one Item Price
 * lookup per item — a search's 20-item cap made the N+1 pattern cheap
 * enough to ignore, but paging through a whole catalog (hundreds to low
 * thousands of items) would turn into hundreds of extra round trips
 * otherwise. Always Retail pricing — see CatalogItem's doc comment.
 */
export async function listCatalogPage(offset: number, limit: number): Promise<CatalogPage> {
  const items = await erpNextClient.list<ItemRecord>('Item', {
    filters: [['disabled', '=', 0]],
    fields: ['item_code', 'item_name', 'stock_uom'],
    order_by: 'item_code asc',
    limit_start: String(offset),
    limit_page_length: String(limit),
  });

  if (items.length === 0) {
    return { items: [], hasMore: false };
  }

  const itemCodes = items.map((item) => item.item_code);
  const prices = await erpNextClient.list<ItemPriceRecord>('Item Price', {
    filters: [
      ['item_code', 'in', itemCodes],
      ['price_list', '=', 'Retail'],
    ],
    fields: ['item_code', 'price_list_rate'],
    limit_page_length: String(itemCodes.length),
  });
  const priceByItemCode = new Map(prices.map((p) => [p.item_code, p.price_list_rate]));

  return {
    items: items.map((item) => ({
      itemCode: item.item_code,
      itemName: item.item_name,
      stockUom: item.stock_uom,
      retailPrice: priceByItemCode.get(item.item_code) ?? null,
    })),
    hasMore: items.length === limit,
  };
}

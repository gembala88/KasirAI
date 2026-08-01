/**
 * Sales/POS module — product search & tier-aware pricing (spec §1.3 FR-1).
 */
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import {
  CUSTOMER_TIERS,
  type CustomerTier,
  type ProductPrice,
  type ProductSearchResult,
} from '../domain/index.js';

/** Unknown/missing tier defaults to Retail — the walk-in customer default. */
export function resolvePriceList(tier: string | undefined): string {
  const match = CUSTOMER_TIERS.find((t) => t === tier);
  return match ?? ('Retail' satisfies CustomerTier);
}

interface ItemRecord {
  item_code: string;
  item_name: string;
  stock_uom: string;
}

interface ItemPriceRecord {
  item_code: string;
  price_list_rate: number;
}

async function lookupPrice(itemCode: string, priceList: string): Promise<number | null> {
  const prices = await erpNextClient.list<ItemPriceRecord>('Item Price', {
    filters: [
      ['item_code', '=', itemCode],
      ['price_list', '=', priceList],
    ],
    fields: ['item_code', 'price_list_rate'],
  });
  return prices[0]?.price_list_rate ?? null;
}

export async function getProductPrice(
  itemCode: string,
  tier: string | undefined,
): Promise<ProductPrice> {
  const priceList = resolvePriceList(tier);
  const price = await lookupPrice(itemCode, priceList);
  return { itemCode, priceList, price };
}

export async function searchProducts(
  query: string,
  tier: string | undefined,
): Promise<ProductSearchResult[]> {
  const priceList = resolvePriceList(tier);

  const items = await erpNextClient.list<ItemRecord>('Item', {
    filters: [
      ['disabled', '=', 0],
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
      price: await lookupPrice(item.item_code, priceList),
    })),
  );
}

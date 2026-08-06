/**
 * Sales/POS module — product search & tier-aware pricing (spec §1.3 FR-1).
 */
import { erpNextClient, ErpNextApiError } from '../../../shared/erpnext-client/index.js';
import { lookupItemPrice, resolvePriceListForTier } from '../../../shared/erpnext-queries/index.js';
import type { CatalogItem, ItemUomPrices, ProductPrice, ProductSearchResult } from '../domain/index.js';

export const resolvePriceList = resolvePriceListForTier;

interface ItemRecord {
  item_code: string;
  item_name: string;
  stock_uom: string;
}

interface ItemPriceUomRecord {
  uom: string | null;
  price_list: string;
  price_list_rate: number;
}

/**
 * Every UOM this item actually sells under, with its own Retail/Grosir
 * pair — what "Tambah Produk Baru"'s existing-item card shows instead of
 * a single Retail number, since a Dus and its base Renteng obviously
 * don't share a price. Returns null (not a thrown 404) for an unknown
 * item_code — the caller (findExistingItem) treats "not found" as the
 * normal "this really is a new item" case, not an error.
 */
export async function getItemUomPrices(itemCode: string): Promise<ItemUomPrices | null> {
  let item: ItemRecord;
  try {
    item = await erpNextClient.get<ItemRecord>('Item', itemCode);
  } catch (error) {
    if (error instanceof ErpNextApiError && error.statusCode === 404) {
      return null;
    }
    throw error;
  }

  const prices = await erpNextClient.list<ItemPriceUomRecord>('Item Price', {
    filters: [
      ['item_code', '=', itemCode],
      ['price_list', 'in', ['Retail', 'Grosir']],
    ],
    fields: ['uom', 'price_list', 'price_list_rate'],
    limit_page_length: '50',
  });

  const byUom = new Map<string, { retailPrice: number | null; grosirPrice: number | null }>();
  for (const p of prices) {
    // A legacy row from before UOM-aware pricing has no uom set — it's
    // always the base unit's price, since only-ever-one-row was the rule then.
    const uom = p.uom ?? item.stock_uom;
    const entry = byUom.get(uom) ?? { retailPrice: null, grosirPrice: null };
    if (p.price_list === 'Retail') entry.retailPrice = p.price_list_rate;
    if (p.price_list === 'Grosir') entry.grosirPrice = p.price_list_rate;
    byUom.set(uom, entry);
  }

  const orderedUoms = [item.stock_uom, ...[...byUom.keys()].filter((u) => u !== item.stock_uom)].filter(
    (u) => byUom.has(u),
  );

  return {
    itemCode: item.item_code,
    itemName: item.item_name,
    stockUom: item.stock_uom,
    uoms: orderedUoms.map((uom) => ({ uom, ...byUom.get(uom)! })),
  };
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
  uom: string | null;
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
    fields: ['item_code', 'price_list_rate', 'uom'],
    // A multi-UOM item can have several Retail rows (one per package
    // UOM) — overfetch generously rather than assume one row per item.
    limit_page_length: String(itemCodes.length * 6),
  });

  // Same base-uom preference as lookupItemPrice, done in bulk here: a
  // first pass gives every item some price (covers legacy single-UOM
  // items whose one row has no uom set), then a second pass overwrites
  // with the row matching the item's own stock_uom wherever one exists.
  const priceByItemCode = new Map<string, number>();
  for (const p of prices) {
    if (!priceByItemCode.has(p.item_code)) {
      priceByItemCode.set(p.item_code, p.price_list_rate);
    }
  }
  const stockUomByItemCode = new Map(items.map((item) => [item.item_code, item.stock_uom]));
  for (const p of prices) {
    if (p.uom && p.uom === stockUomByItemCode.get(p.item_code)) {
      priceByItemCode.set(p.item_code, p.price_list_rate);
    }
  }

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

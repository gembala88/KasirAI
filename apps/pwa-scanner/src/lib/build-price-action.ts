import type { UpdateItemPriceAction } from './types';

export interface EditPriceFormFields {
  itemCode: string;
  uom: string;
  retailPrice: string;
  grosirPrice: string;
  costPrice: string;
  warehouse?: string;
}

/** Validates and converts raw form input into an UpdateItemPriceAction, or returns a Bahasa Indonesia error message. Blank fields are omitted (not sent as 0), so editing only some of Retail/Grosir/Modal never overwrites the others. */
export function buildUpdatePriceAction(
  fields: EditPriceFormFields,
): UpdateItemPriceAction | string {
  const itemCode = fields.itemCode.trim();
  const uom = fields.uom.trim();
  if (!itemCode || !uom) {
    return 'Kode barang dan satuan wajib diisi';
  }

  const retailRaw = fields.retailPrice.trim();
  const grosirRaw = fields.grosirPrice.trim();
  const costRaw = fields.costPrice.trim();

  let retailPrice: number | undefined;
  if (retailRaw) {
    retailPrice = Number(retailRaw);
    if (!Number.isFinite(retailPrice) || retailPrice <= 0) {
      return 'Harga Retail harus lebih dari 0';
    }
  }

  let grosirPrice: number | undefined;
  if (grosirRaw) {
    grosirPrice = Number(grosirRaw);
    if (!Number.isFinite(grosirPrice) || grosirPrice <= 0) {
      return 'Harga Grosir harus lebih dari 0';
    }
  }

  let costPrice: number | undefined;
  if (costRaw) {
    costPrice = Number(costRaw);
    if (!Number.isFinite(costPrice) || costPrice <= 0) {
      return 'Harga Modal harus lebih dari 0';
    }
  }

  if (retailPrice === undefined && grosirPrice === undefined && costPrice === undefined) {
    return 'Harga Retail, Harga Grosir, atau Harga Modal wajib diisi salah satu';
  }

  return {
    type: 'update-item-price',
    itemCode,
    uom,
    ...(retailPrice !== undefined ? { retailPrice } : {}),
    ...(grosirPrice !== undefined ? { grosirPrice } : {}),
    ...(costPrice !== undefined ? { costPrice } : {}),
    ...(fields.warehouse?.trim() ? { warehouse: fields.warehouse.trim() } : {}),
  };
}

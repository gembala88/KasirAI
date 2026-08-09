import type { UpdateItemPriceAction } from './types';

export interface EditPriceFormFields {
  itemCode: string;
  uom: string;
  retailPrice: string;
  grosirPrice: string;
}

/** Validates and converts raw form input into an UpdateItemPriceAction, or returns a Bahasa Indonesia error message. Blank fields are omitted (not sent as 0), so editing only one of Retail/Grosir never overwrites the other. */
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

  if (retailPrice === undefined && grosirPrice === undefined) {
    return 'Harga Retail atau Harga Grosir wajib diisi salah satu';
  }

  return {
    type: 'update-item-price',
    itemCode,
    uom,
    ...(retailPrice !== undefined ? { retailPrice } : {}),
    ...(grosirPrice !== undefined ? { grosirPrice } : {}),
  };
}

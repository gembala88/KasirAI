import type { CreateItemAction, PackageUom } from './types';

export interface PackageUomFormRow {
  uom: string;
  conversionQty: string;
  retailPrice: string;
  grosirPrice: string;
}

export interface NewItemFormFields {
  itemCode: string;
  itemName: string;
  itemGroup: string;
  stockUom: string;
  retailPrice: string;
  grosirPrice: string;
  costPrice: string;
  openingQty: string;
  warehouse: string;
  packageUomRows: PackageUomFormRow[];
}

const isBlankRow = (row: PackageUomFormRow): boolean =>
  !row.uom.trim() &&
  !row.conversionQty.trim() &&
  !row.retailPrice.trim() &&
  !row.grosirPrice.trim();

/** Parses+validates the repeating "Satuan Kemasan" rows, or returns a Bahasa Indonesia error message. Rows left entirely blank (added then never filled in) are silently skipped, same as removing them. */
function buildPackageUoms(rows: PackageUomFormRow[], stockUom: string): PackageUom[] | string {
  const packageUoms: PackageUom[] = [];
  const seenNames = new Set([stockUom.trim().toLowerCase()]);

  for (const row of rows) {
    if (isBlankRow(row)) continue;

    const uom = row.uom.trim();
    if (!uom) {
      return 'Nama Satuan Kemasan wajib diisi';
    }
    const key = uom.toLowerCase();
    if (seenNames.has(key)) {
      return `Satuan "${uom}" sudah dipakai — setiap Satuan Kemasan harus berbeda dari Satuan Dasar dan satuan kemasan lainnya`;
    }
    seenNames.add(key);

    const conversionQty = Number(row.conversionQty);
    if (!Number.isFinite(conversionQty) || conversionQty <= 0) {
      return `Isi konversi ${uom} harus lebih dari 0`;
    }

    const retailPrice = Number(row.retailPrice);
    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      return `Harga Retail untuk ${uom} tidak valid`;
    }

    const packageUom: PackageUom = { uom, conversionQty, retailPrice };

    const grosirRaw = row.grosirPrice.trim();
    if (grosirRaw) {
      const grosirPrice = Number(grosirRaw);
      if (!Number.isFinite(grosirPrice) || grosirPrice < 0) {
        return `Harga Grosir untuk ${uom} tidak valid`;
      }
      packageUom.grosirPrice = grosirPrice;
    }

    packageUoms.push(packageUom);
  }

  return packageUoms;
}

/** Validates and converts the "Tambah Produk Baru" form into a CreateItemAction, or returns a Bahasa Indonesia error message. */
export function buildCreateItemAction(fields: NewItemFormFields): CreateItemAction | string {
  const itemCode = fields.itemCode.trim();
  const itemName = fields.itemName.trim();
  const itemGroup = fields.itemGroup.trim();
  const stockUom = fields.stockUom.trim();

  if (!itemCode) {
    return 'Kode barang (hasil scan) wajib diisi';
  }
  if (!itemName) {
    return 'Nama barang wajib diisi';
  }
  if (!itemGroup) {
    return 'Item Grup wajib dipilih';
  }
  if (!stockUom) {
    return 'Satuan wajib dipilih';
  }

  const retailPrice = Number(fields.retailPrice);
  if (!Number.isFinite(retailPrice) || retailPrice < 0) {
    return 'Harga Retail tidak valid';
  }

  const action: CreateItemAction = {
    type: 'create-item',
    itemCode,
    itemName,
    itemGroup,
    stockUom,
    retailPrice,
  };

  const grosirRaw = fields.grosirPrice.trim();
  if (grosirRaw) {
    const grosirPrice = Number(grosirRaw);
    if (!Number.isFinite(grosirPrice) || grosirPrice < 0) {
      return 'Harga Grosir tidak valid';
    }
    action.grosirPrice = grosirPrice;
  }

  const packageUoms = buildPackageUoms(fields.packageUomRows, stockUom);
  if (typeof packageUoms === 'string') {
    return packageUoms;
  }
  if (packageUoms.length > 0) {
    action.packageUoms = packageUoms;
  }

  const openingQtyRaw = fields.openingQty.trim();
  let openingQty: number | undefined;
  if (openingQtyRaw) {
    openingQty = Number(openingQtyRaw);
    if (!Number.isFinite(openingQty) || openingQty < 0) {
      return 'Stok Awal tidak valid';
    }
    if (openingQty > 0) {
      action.openingQty = openingQty;
      if (fields.warehouse.trim()) {
        action.warehouse = fields.warehouse.trim();
      }
    }
  }

  const costPriceRaw = fields.costPrice.trim();
  if (costPriceRaw) {
    const costPrice = Number(costPriceRaw);
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      return 'Harga Modal/Beli tidak valid';
    }
    action.costPrice = costPrice;
  } else if (openingQty !== undefined && openingQty > 0) {
    return 'Harga Modal/Beli wajib diisi saat Stok Awal lebih dari 0';
  }

  return action;
}

import { describe, expect, it } from 'vitest';
import { buildCreateItemAction } from './build-item-action';

const baseFields = {
  itemCode: '8997212800288',
  itemName: 'Teh Botol 350ml',
  itemGroup: 'Produk Umum',
  stockUom: 'Pcs',
  retailPrice: '5000',
  grosirPrice: '',
  costPrice: '',
  openingQty: '',
  warehouse: '',
  packageUomRows: [],
};

describe('buildCreateItemAction', () => {
  it('builds a valid action without a Grosir price', () => {
    const result = buildCreateItemAction(baseFields);
    expect(result).toEqual({
      type: 'create-item',
      itemCode: '8997212800288',
      itemName: 'Teh Botol 350ml',
      itemGroup: 'Produk Umum',
      stockUom: 'Pcs',
      retailPrice: 5000,
    });
  });

  it('includes grosirPrice when provided', () => {
    const result = buildCreateItemAction({ ...baseFields, grosirPrice: '4000' });
    expect(result).toMatchObject({ grosirPrice: 4000 });
  });

  it('never includes grosirPrice at all when left blank, not even as 0', () => {
    const result = buildCreateItemAction(baseFields);
    expect(result).not.toHaveProperty('grosirPrice');
  });

  it.each(['itemCode', 'itemName', 'itemGroup', 'stockUom'] as const)(
    'rejects a blank %s',
    (field) => {
      const result = buildCreateItemAction({ ...baseFields, [field]: '  ' });
      expect(typeof result).toBe('string');
    },
  );

  it('rejects a non-numeric or negative Harga Retail', () => {
    expect(buildCreateItemAction({ ...baseFields, retailPrice: 'abc' })).toBe(
      'Harga Retail tidak valid',
    );
    expect(buildCreateItemAction({ ...baseFields, retailPrice: '-1' })).toBe(
      'Harga Retail tidak valid',
    );
  });

  it('rejects a non-numeric or negative Harga Grosir when provided', () => {
    expect(buildCreateItemAction({ ...baseFields, grosirPrice: 'abc' })).toBe(
      'Harga Grosir tidak valid',
    );
    expect(buildCreateItemAction({ ...baseFields, grosirPrice: '-1' })).toBe(
      'Harga Grosir tidak valid',
    );
  });

  it('accepts a zero Harga Retail (a genuinely free item is a valid, if unusual, case)', () => {
    const result = buildCreateItemAction({ ...baseFields, retailPrice: '0' });
    expect(result).toMatchObject({ retailPrice: 0 });
  });

  it('registers with no opening stock and no cost price when both are left blank', () => {
    const result = buildCreateItemAction(baseFields);
    expect(result).not.toHaveProperty('openingQty');
    expect(result).not.toHaveProperty('costPrice');
    expect(result).not.toHaveProperty('warehouse');
  });

  it('rejects Stok Awal > 0 with no Harga Modal/Beli — the exact zero-valuation bug this field exists to prevent', () => {
    expect(buildCreateItemAction({ ...baseFields, openingQty: '10' })).toBe(
      'Harga Modal/Beli wajib diisi saat Stok Awal lebih dari 0',
    );
  });

  it('accepts Stok Awal with a matching Harga Modal/Beli, including an optional warehouse', () => {
    const result = buildCreateItemAction({
      ...baseFields,
      openingQty: '10',
      costPrice: '3000',
      warehouse: 'Stores - TH',
    });
    expect(result).toMatchObject({ openingQty: 10, costPrice: 3000, warehouse: 'Stores - TH' });
  });

  it('treats a blank Stok Awal of "0" as no opening stock — costPrice stays optional', () => {
    const result = buildCreateItemAction({ ...baseFields, openingQty: '0' });
    expect(result).not.toHaveProperty('openingQty');
  });

  it('rejects a non-numeric or negative Stok Awal', () => {
    expect(buildCreateItemAction({ ...baseFields, openingQty: 'abc' })).toBe(
      'Stok Awal tidak valid',
    );
    expect(buildCreateItemAction({ ...baseFields, openingQty: '-1' })).toBe(
      'Stok Awal tidak valid',
    );
  });

  it('rejects a non-numeric or negative Harga Modal/Beli', () => {
    expect(buildCreateItemAction({ ...baseFields, costPrice: 'abc' })).toBe(
      'Harga Modal/Beli tidak valid',
    );
    expect(buildCreateItemAction({ ...baseFields, costPrice: '-1' })).toBe(
      'Harga Modal/Beli tidak valid',
    );
  });

  it('allows Harga Modal/Beli to be set even with no opening stock, as a reference cost', () => {
    const result = buildCreateItemAction({ ...baseFields, costPrice: '3000' });
    expect(result).toMatchObject({ costPrice: 3000 });
    expect(result).not.toHaveProperty('openingQty');
  });

  it('omits packageUoms entirely when no rows are added — simple single-UOM items unaffected', () => {
    const result = buildCreateItemAction(baseFields);
    expect(result).not.toHaveProperty('packageUoms');
  });

  it('silently skips a row left entirely blank, same as never adding it', () => {
    const result = buildCreateItemAction({
      ...baseFields,
      packageUomRows: [{ uom: '', conversionQty: '', retailPrice: '', grosirPrice: '' }],
    });
    expect(result).not.toHaveProperty('packageUoms');
  });

  it('builds a package UOM with its own Retail-only price, omitting Grosir when blank', () => {
    const result = buildCreateItemAction({
      ...baseFields,
      packageUomRows: [{ uom: 'Dus', conversionQty: '8', retailPrice: '60000', grosirPrice: '' }],
    });
    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') return;
    expect(result.packageUoms).toEqual([{ uom: 'Dus', conversionQty: 8, retailPrice: 60000 }]);
    expect(result.packageUoms?.[0]).not.toHaveProperty('grosirPrice');
  });

  it('builds multiple package UOMs, each with its own optional Grosir price', () => {
    const result = buildCreateItemAction({
      ...baseFields,
      packageUomRows: [
        { uom: 'Dus', conversionQty: '8', retailPrice: '60000', grosirPrice: '56000' },
        { uom: 'Lusin', conversionQty: '12', retailPrice: '58000', grosirPrice: '' },
      ],
    });
    expect(result).toMatchObject({
      packageUoms: [
        { uom: 'Dus', conversionQty: 8, retailPrice: 60000, grosirPrice: 56000 },
        { uom: 'Lusin', conversionQty: 12, retailPrice: 58000 },
      ],
    });
  });

  it('rejects a package UOM name that collides with the base Satuan Dasar', () => {
    const result = buildCreateItemAction({
      ...baseFields,
      packageUomRows: [{ uom: 'Pcs', conversionQty: '8', retailPrice: '60000', grosirPrice: '' }],
    });
    expect(typeof result).toBe('string');
  });

  it('rejects a package UOM name that collides with another package row (case-insensitive)', () => {
    const result = buildCreateItemAction({
      ...baseFields,
      packageUomRows: [
        { uom: 'Dus', conversionQty: '8', retailPrice: '60000', grosirPrice: '' },
        { uom: 'dus', conversionQty: '10', retailPrice: '70000', grosirPrice: '' },
      ],
    });
    expect(typeof result).toBe('string');
  });

  it('rejects a package UOM with a zero or negative conversion qty', () => {
    expect(
      buildCreateItemAction({
        ...baseFields,
        packageUomRows: [{ uom: 'Dus', conversionQty: '0', retailPrice: '60000', grosirPrice: '' }],
      }),
    ).toBe('Isi konversi Dus harus lebih dari 0');
    expect(
      buildCreateItemAction({
        ...baseFields,
        packageUomRows: [{ uom: 'Dus', conversionQty: '-8', retailPrice: '60000', grosirPrice: '' }],
      }),
    ).toBe('Isi konversi Dus harus lebih dari 0');
  });

  it('rejects a package UOM with a negative or non-numeric Harga Retail', () => {
    expect(
      buildCreateItemAction({
        ...baseFields,
        packageUomRows: [{ uom: 'Dus', conversionQty: '8', retailPrice: 'abc', grosirPrice: '' }],
      }),
    ).toBe('Harga Retail untuk Dus tidak valid');
    expect(
      buildCreateItemAction({
        ...baseFields,
        packageUomRows: [{ uom: 'Dus', conversionQty: '8', retailPrice: '-1', grosirPrice: '' }],
      }),
    ).toBe('Harga Retail untuk Dus tidak valid');
  });

  it('treats a blank Harga Retail on a package row as zero, same as the base Harga Retail field', () => {
    const result = buildCreateItemAction({
      ...baseFields,
      packageUomRows: [{ uom: 'Dus', conversionQty: '8', retailPrice: '', grosirPrice: '' }],
    });
    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') return;
    expect(result.packageUoms).toEqual([{ uom: 'Dus', conversionQty: 8, retailPrice: 0 }]);
  });
});

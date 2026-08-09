import { describe, expect, it } from 'vitest';
import { buildUpdatePriceAction } from './build-price-action';

const baseFields = { itemCode: '', uom: '', retailPrice: '', grosirPrice: '' };

describe('buildUpdatePriceAction', () => {
  it('builds a valid action with only Retail price set', () => {
    const result = buildUpdatePriceAction({
      ...baseFields,
      itemCode: 'BAWANG-MERAH-KG',
      uom: 'Kg',
      retailPrice: '22000',
    });
    expect(result).toEqual({
      type: 'update-item-price',
      itemCode: 'BAWANG-MERAH-KG',
      uom: 'Kg',
      retailPrice: 22000,
    });
  });

  it('builds a valid action with both Retail and Grosir set', () => {
    const result = buildUpdatePriceAction({
      ...baseFields,
      itemCode: 'BAWANG-MERAH-KG',
      uom: 'Kg',
      retailPrice: '22000',
      grosirPrice: '21000',
    });
    expect(result).toEqual({
      type: 'update-item-price',
      itemCode: 'BAWANG-MERAH-KG',
      uom: 'Kg',
      retailPrice: 22000,
      grosirPrice: 21000,
    });
  });

  it('omits grosirPrice entirely (not 0) when left blank', () => {
    const result = buildUpdatePriceAction({
      ...baseFields,
      itemCode: 'X',
      uom: 'Pcs',
      retailPrice: '5000',
    });
    expect(result).not.toHaveProperty('grosirPrice');
  });

  it('rejects when neither price field is filled in', () => {
    expect(buildUpdatePriceAction({ ...baseFields, itemCode: 'X', uom: 'Pcs' })).toBe(
      'Harga Retail atau Harga Grosir wajib diisi salah satu',
    );
  });

  it('rejects a zero or negative Retail price', () => {
    expect(
      buildUpdatePriceAction({ ...baseFields, itemCode: 'X', uom: 'Pcs', retailPrice: '0' }),
    ).toBe('Harga Retail harus lebih dari 0');
    expect(
      buildUpdatePriceAction({ ...baseFields, itemCode: 'X', uom: 'Pcs', retailPrice: '-5' }),
    ).toBe('Harga Retail harus lebih dari 0');
  });

  it('rejects a zero or negative Grosir price', () => {
    expect(
      buildUpdatePriceAction({ ...baseFields, itemCode: 'X', uom: 'Pcs', grosirPrice: '0' }),
    ).toBe('Harga Grosir harus lebih dari 0');
  });

  it('rejects a missing item code or uom', () => {
    expect(buildUpdatePriceAction({ ...baseFields, uom: 'Pcs', retailPrice: '5000' })).toBe(
      'Kode barang dan satuan wajib diisi',
    );
    expect(buildUpdatePriceAction({ ...baseFields, itemCode: 'X', retailPrice: '5000' })).toBe(
      'Kode barang dan satuan wajib diisi',
    );
  });
});

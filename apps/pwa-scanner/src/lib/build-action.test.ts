import { describe, expect, it } from 'vitest';
import { buildAction } from './build-action';

const baseFields = { itemCode: '', qty: '', rate: '', warehouse: '', toWarehouse: '' };

describe('buildAction', () => {
  it('builds a valid add-stock action', () => {
    const result = buildAction('add-stock', {
      ...baseFields,
      itemCode: 'BRG-001',
      qty: '10',
      rate: '5000',
    });
    expect(result).toEqual({ type: 'add-stock', itemCode: 'BRG-001', qty: 10, rate: 5000 });
  });

  it('includes warehouse when provided', () => {
    const result = buildAction('reduce-stock', {
      ...baseFields,
      itemCode: 'BRG-001',
      qty: '3',
      warehouse: 'Gudang Utama - TH',
    });
    expect(result).toEqual({
      type: 'reduce-stock',
      itemCode: 'BRG-001',
      qty: 3,
      warehouse: 'Gudang Utama - TH',
    });
  });

  it('builds a transfer action with fromWarehouse/toWarehouse', () => {
    const result = buildAction('transfer', {
      ...baseFields,
      itemCode: 'BRG-001',
      qty: '5',
      warehouse: 'Gudang A',
      toWarehouse: 'Gudang B',
    });
    expect(result).toEqual({
      type: 'transfer',
      itemCode: 'BRG-001',
      qty: 5,
      fromWarehouse: 'Gudang A',
      toWarehouse: 'Gudang B',
    });
  });

  it('rejects an empty item code', () => {
    expect(buildAction('add-stock', { ...baseFields, qty: '1', rate: '1' })).toBe(
      'Kode barang wajib diisi',
    );
  });

  it('rejects a non-positive quantity', () => {
    expect(buildAction('add-stock', { ...baseFields, itemCode: 'X', qty: '0', rate: '1' })).toBe(
      'Jumlah harus lebih dari 0',
    );
  });

  it('rejects an invalid rate for add-stock', () => {
    expect(buildAction('add-stock', { ...baseFields, itemCode: 'X', qty: '1', rate: '-5' })).toBe(
      'Harga satuan tidak valid',
    );
  });

  it('rejects a transfer with no destination warehouse', () => {
    expect(buildAction('transfer', { ...baseFields, itemCode: 'X', qty: '1' })).toBe(
      'Gudang tujuan wajib diisi',
    );
  });
});

/**
 * Pure reducer for Kasir's on-screen numeric keypad (pendingQty/qtyTouched)
 * — extracted out of the component so the digit/backspace/decimal-point
 * logic can be unit tested without a DOM.
 */
export interface QtyKeypadState {
  pendingQty: string;
  qtyTouched: boolean;
}

export function pressQtyKey(state: QtyKeypadState, key: string): QtyKeypadState {
  const { pendingQty, qtyTouched } = state;

  if (key === 'C') {
    return { pendingQty: '1', qtyTouched: false };
  }

  if (key === '⌫') {
    if (!qtyTouched || pendingQty.length <= 1) {
      return { pendingQty: '1', qtyTouched: false };
    }
    const next = pendingQty.slice(0, -1);
    return { pendingQty: next, qtyTouched: next.length > 0 };
  }

  if (key === '.') {
    // Real bug found live: this used to reset to '0.' whenever the field
    // still showed the untouched default ('1'), so typing '.' then '5' on
    // a fresh Kg item gave 0.5 instead of 1.5. '.' should append to
    // whatever's currently shown, same as every other key, never discard it.
    const next = pendingQty.includes('.') ? pendingQty : pendingQty + '.';
    return { pendingQty: next, qtyTouched: true };
  }

  const base = qtyTouched ? pendingQty : '';
  return { pendingQty: (base + key).replace(/^0+(?=\d)/, '') || '1', qtyTouched: true };
}

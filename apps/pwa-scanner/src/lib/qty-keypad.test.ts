import { describe, expect, it } from 'vitest';
import { pressQtyKey } from './qty-keypad';

describe('pressQtyKey', () => {
  it('appends "." to the untouched default, not resets to "0." — real bug found live: typing "." then "5" on a fresh Kg item gave 0.5 instead of 1.5', () => {
    const afterDot = pressQtyKey({ pendingQty: '1', qtyTouched: false }, '.');
    expect(afterDot).toEqual({ pendingQty: '1.', qtyTouched: true });

    const afterFive = pressQtyKey(afterDot, '5');
    expect(afterFive).toEqual({ pendingQty: '1.5', qtyTouched: true });
  });

  it('does not add a second "." once one is already present', () => {
    const state = pressQtyKey({ pendingQty: '1.5', qtyTouched: true }, '.');
    expect(state).toEqual({ pendingQty: '1.5', qtyTouched: true });
  });

  it('replaces the untouched default when a digit is typed directly (no leading "1")', () => {
    const state = pressQtyKey({ pendingQty: '1', qtyTouched: false }, '5');
    expect(state).toEqual({ pendingQty: '5', qtyTouched: true });
  });

  it('appends digits once touched, stripping a leading zero', () => {
    const first = pressQtyKey({ pendingQty: '1', qtyTouched: false }, '0');
    expect(first).toEqual({ pendingQty: '0', qtyTouched: true });
    const second = pressQtyKey(first, '5');
    expect(second).toEqual({ pendingQty: '5', qtyTouched: true });
  });

  it('"C" resets to the untouched default regardless of current state', () => {
    expect(pressQtyKey({ pendingQty: '2.75', qtyTouched: true }, 'C')).toEqual({
      pendingQty: '1',
      qtyTouched: false,
    });
  });

  it('backspace removes one character at a time, then resets once empty', () => {
    const afterFirst = pressQtyKey({ pendingQty: '25', qtyTouched: true }, '⌫');
    expect(afterFirst).toEqual({ pendingQty: '2', qtyTouched: true });
    const afterSecond = pressQtyKey(afterFirst, '⌫');
    expect(afterSecond).toEqual({ pendingQty: '1', qtyTouched: false });
  });

  it('backspace on the untouched default is a no-op reset, not a delete into empty', () => {
    const state = pressQtyKey({ pendingQty: '1', qtyTouched: false }, '⌫');
    expect(state).toEqual({ pendingQty: '1', qtyTouched: false });
  });
});

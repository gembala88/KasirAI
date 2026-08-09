import { useState } from 'react';

/** Covers the large majority of real products at this store — typing a UOM every time was the slow part, not choosing one. */
const QUICK_UOMS = ['Pcs', 'Kg', 'Lusin', 'Karton', 'Renteng', 'Dus'];

/**
 * Tap grid for the 6 common units, falling back to free text (with
 * autocomplete over every real UOM) via "+ Lainnya" for the rest — UX gap
 * found live: typing every UOM by hand was slow when almost every product
 * uses one of a handful of units.
 */
export default function UomPicker({
  value,
  onChange,
  datalistId,
}: {
  value: string;
  onChange: (value: string) => void;
  datalistId: string;
}) {
  const [customMode, setCustomMode] = useState(() => value !== '' && !QUICK_UOMS.includes(value));

  if (customMode) {
    return (
      <div className="uom-picker">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          list={datalistId}
          placeholder="mis. Botol, Sachet"
          autoFocus
        />
        <button type="button" className="link-button" onClick={() => setCustomMode(false)}>
          Pilih dari daftar
        </button>
      </div>
    );
  }

  return (
    <div className="uom-picker-grid">
      {QUICK_UOMS.map((uom) => (
        <button
          key={uom}
          type="button"
          className={value === uom ? 'uom-chip uom-chip--active' : 'uom-chip'}
          onClick={() => onChange(uom)}
        >
          {uom}
        </button>
      ))}
      <button type="button" className="uom-chip" onClick={() => setCustomMode(true)}>
        + Lainnya
      </button>
    </div>
  );
}

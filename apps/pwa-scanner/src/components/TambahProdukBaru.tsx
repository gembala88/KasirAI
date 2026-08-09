import { useEffect, useState } from 'react';
import {
  IconAlertTriangle,
  IconCamera,
  IconCircleCheck,
  IconPlus,
  IconX,
} from '@tabler/icons-react';
import CameraScanner from './CameraScanner';
import UomPicker from './UomPicker';
import {
  fetchItemGroups,
  fetchUoms,
  fetchWarehouses,
  findExistingItem,
  searchItemsByName,
  triggerCatalogSync,
  type ExistingItemMatch,
  type ItemGroupOption,
  type ItemSearchCandidate,
  type UomOption,
  type WarehouseOption,
} from '../lib/api';
import { buildCreateItemAction, type PackageUomFormRow } from '../lib/build-item-action';
import { loadWithCacheFallback } from '../lib/cached-lookup';
import { formatRupiah } from '../lib/format';
import { listQueuedActions } from '../lib/offline-queue';
import { submitOrQueue } from '../lib/sync';
import type { CreateItemAction } from '../lib/types';

const ITEM_GROUPS_CACHE_KEY = 'hermes-pwa-scanner-item-groups';
const UOMS_CACHE_KEY = 'hermes-pwa-scanner-uoms';
const WAREHOUSES_CACHE_KEY = 'hermes-pwa-scanner-warehouses';
const UOM_DATALIST_ID = 'tambah-produk-uom-options';

function emptyPackageUomRow(): PackageUomFormRow {
  return { uom: '', conversionQty: '', retailPrice: '', grosirPrice: '' };
}

type Stage =
  | { kind: 'entry' }
  | { kind: 'checking' }
  | { kind: 'already-queued'; itemCode: string }
  | { kind: 'existing'; match: ExistingItemMatch }
  | { kind: 'search-results'; query: string; candidates: ItemSearchCandidate[] }
  /** itemCodeEditable is true when this came from "Cari/Input Manual" (no barcode to derive a code from) — the create form then shows an editable Kode Barang field instead of a fixed one. */
  | { kind: 'new'; itemCode: string; itemCodeEditable: boolean };

/**
 * "Tambah Produk Baru" — bulk product onboarding from the Gudang scan
 * screen, replacing slow one-by-one desktop Item entry. Two ways in: scan
 * a barcode (exact item_code check), or search by name for products with
 * no barcode (fuzzy match, self-assigned code). Either way: a match shows
 * read-only info (editing an existing item's price is still ERPNext's own
 * Item screen for now — deliberately out of scope here, see BACKLOG.md),
 * no match shows the create form.
 */
export default function TambahProdukBaru({ onSubmitted }: { onSubmitted: () => void }) {
  const [entryMode, setEntryMode] = useState<'scan' | 'search'>('scan');
  const [stage, setStage] = useState<Stage>({ kind: 'entry' });
  const [manualCode, setManualCode] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [itemGroups, setItemGroups] = useState<ItemGroupOption[]>([]);
  const [uoms, setUoms] = useState<UomOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [defaultWarehouse, setDefaultWarehouse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [itemName, setItemName] = useState('');
  const [itemGroup, setItemGroup] = useState('');
  const [stockUom, setStockUom] = useState('');
  const [retailPrice, setRetailPrice] = useState('');
  const [grosirPrice, setGrosirPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [openingQty, setOpeningQty] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [packageUomRows, setPackageUomRows] = useState<PackageUomFormRow[]>([]);
  // Bumped on every resetNewItemForm() — remounts UomPicker so a prior
  // "+ Lainnya" custom-text session doesn't linger into the next product.
  const [formResetKey, setFormResetKey] = useState(0);

  useEffect(() => {
    void loadWithCacheFallback(
      ITEM_GROUPS_CACHE_KEY,
      async () => (await fetchItemGroups()).itemGroups,
      [],
    ).then(setItemGroups);
    void loadWithCacheFallback(UOMS_CACHE_KEY, async () => (await fetchUoms()).uoms, []).then(
      setUoms,
    );
    void loadWithCacheFallback(WAREHOUSES_CACHE_KEY, fetchWarehouses, {
      warehouses: [],
      default: '',
    }).then(({ warehouses: list, default: def }) => {
      setWarehouses(list);
      setDefaultWarehouse(def);
      // Only backfills if the Gudang field hasn't already been set (by
      // resetNewItemForm running first, or the user picking one) — never
      // stomps a real choice.
      setWarehouse((current) => current || def);
    });
  }, []);

  function resetNewItemForm(prefillName = ''): void {
    setItemName(prefillName);
    setItemGroup(itemGroups[0]?.name ?? '');
    setStockUom('');
    setRetailPrice('');
    setGrosirPrice('');
    setCostPrice('');
    setOpeningQty('');
    setWarehouse(defaultWarehouse);
    setPackageUomRows([]);
    setFormResetKey((k) => k + 1);
  }

  /** True if this exact code is already sitting in the local offline queue, not yet synced — the same barcode shouldn't be offered the create form twice. */
  async function isAlreadyQueued(itemCode: string): Promise<boolean> {
    return (await listQueuedActions()).some(
      (item) =>
        item.actionType === 'create-item' &&
        (item.action as CreateItemAction).itemCode.toLowerCase() === itemCode.toLowerCase(),
    );
  }

  async function handleScanResult(itemCode: string): Promise<void> {
    const trimmed = itemCode.trim();
    if (!trimmed) return;

    setError(null);
    setMessage(null);
    setStage({ kind: 'checking' });

    if (await isAlreadyQueued(trimmed)) {
      setStage({ kind: 'already-queued', itemCode: trimmed });
      return;
    }

    try {
      const match = await findExistingItem(trimmed);
      if (match) {
        setStage({ kind: 'existing', match });
      } else {
        resetNewItemForm();
        setStage({ kind: 'new', itemCode: trimmed, itemCodeEditable: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage({ kind: 'entry' });
    }
  }

  async function handleNameSearch(): Promise<void> {
    const query = nameQuery.trim();
    if (!query) return;

    setError(null);
    setMessage(null);
    setStage({ kind: 'checking' });

    try {
      const candidates = await searchItemsByName(query);
      setStage({ kind: 'search-results', query, candidates });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage({ kind: 'entry' });
    }
  }

  async function handlePickCandidate(candidate: ItemSearchCandidate): Promise<void> {
    setError(null);
    setStage({ kind: 'checking' });
    try {
      const match = await findExistingItem(candidate.itemCode);
      setStage({
        kind: 'existing',
        match: match ?? { itemCode: candidate.itemCode, itemName: candidate.itemName, uoms: [] },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage({ kind: 'entry' });
    }
  }

  function handleNoneMatch(query: string): void {
    resetNewItemForm(query);
    setStage({ kind: 'new', itemCode: '', itemCodeEditable: true });
  }

  function resetToEntry(): void {
    setManualCode('');
    setNameQuery('');
    setStage({ kind: 'entry' });
  }

  async function handleCreateSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (stage.kind !== 'new') return;

    const itemCode = stage.itemCode.trim();
    if (!itemCode) {
      setError('Kode barang wajib diisi');
      return;
    }

    // The scan flow already checked this before showing the form; a
    // self-typed code (from "Cari/Input Manual") hasn't been checked yet.
    if (stage.itemCodeEditable) {
      if (await isAlreadyQueued(itemCode)) {
        setError(`Kode ${itemCode} sudah dalam antrian, menunggu sinkron.`);
        return;
      }
      try {
        const match = await findExistingItem(itemCode);
        if (match) {
          setError(
            `Kode ${itemCode} sudah terdaftar sebagai "${match.itemName}" — gunakan kode lain.`,
          );
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    const built = buildCreateItemAction({
      itemCode,
      itemName,
      itemGroup,
      stockUom,
      retailPrice,
      grosirPrice,
      costPrice,
      openingQty,
      warehouse,
      packageUomRows,
    });
    if (typeof built === 'string') {
      setError(built);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOrQueue('create-item', built);
      if (result.outcome === 'synced') {
        setMessage(`Produk "${itemName}" berhasil ditambahkan.`);
        // The new item only exists on the server at this point — refresh
        // the offline catalog cache so Daftar Produk shows it right away
        // instead of the cashier needing to know to re-sync manually.
        void triggerCatalogSync();
      } else if (result.outcome === 'conflict') {
        setMessage(
          `Ditandai konflik (${result.message ?? 'kode barang mungkin sudah terdaftar'}) — perlu ditinjau di dashboard.`,
        );
      } else {
        setMessage('Produk disimpan secara lokal — akan sinkron otomatis saat online.');
      }
      onSubmitted();
      resetToEntry();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function updatePackageUomRow(index: number, patch: Partial<PackageUomFormRow>): void {
    setPackageUomRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removePackageUomRow(index: number): void {
    setPackageUomRows((rows) => rows.filter((_, i) => i !== index));
  }

  return (
    <div className="tambah-produk">
      <h2 className="section-label">Tambah Produk Baru</h2>

      {message && <p className="message">{message}</p>}
      {error && <p className="error-box">{error}</p>}

      {stage.kind === 'entry' && (
        <>
          <nav className="tabs">
            <button
              type="button"
              className={entryMode === 'scan' ? 'tab tab--active' : 'tab'}
              onClick={() => setEntryMode('scan')}
            >
              Scan Barcode
            </button>
            <button
              type="button"
              className={entryMode === 'search' ? 'tab tab--active' : 'tab'}
              onClick={() => setEntryMode('search')}
            >
              Cari/Input Manual
            </button>
          </nav>

          {entryMode === 'scan' && (
            // Real bug found live: this wasn't a <form> at all, so pressing
            // Enter after typing/scanning a code did nothing — there was no
            // submit handler for the keypress to reach.
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleScanResult(manualCode);
              }}
              className="scan-form"
            >
              <label>
                Kode Barang
                <div className="scan-input-row">
                  <input
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Scan atau ketik kode barang"
                    inputMode="text"
                  />
                  <button
                    type="button"
                    className="camera-scan-button"
                    onClick={() => setCameraOpen(true)}
                  >
                    <IconCamera size={20} /> Scan
                  </button>
                </div>
              </label>
              <button type="submit">Cek Barang</button>
            </form>
          )}

          {entryMode === 'search' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleNameSearch();
              }}
              className="scan-form"
            >
              <p className="hint">Untuk produk tanpa barcode — cari dulu berdasarkan nama.</p>
              <label>
                Nama Barang
                <input
                  value={nameQuery}
                  onChange={(e) => setNameQuery(e.target.value)}
                  placeholder="mis. Bawang Merah"
                  inputMode="text"
                />
              </label>
              <button type="submit">Cari</button>
            </form>
          )}
        </>
      )}

      {stage.kind === 'checking' && <p className="hint">Memeriksa…</p>}

      {stage.kind === 'already-queued' && (
        <div className="card">
          <span className="status-badge status-badge--pending">
            {stage.itemCode} sudah dalam antrian, menunggu sinkron
          </span>
          <button type="button" onClick={resetToEntry}>
            Kembali
          </button>
        </div>
      )}

      {stage.kind === 'search-results' && (
        <div className="card">
          {stage.candidates.length === 0 ? (
            <p className="hint">Tidak ada produk yang mirip dengan "{stage.query}".</p>
          ) : (
            <>
              <p className="hint">
                Produk mirip dengan "{stage.query}" — pastikan bukan duplikat sebelum membuat baru:
              </p>
              <ul className="candidate-list">
                {stage.candidates.map((c) => (
                  <li key={c.itemCode}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => void handlePickCandidate(c)}
                    >
                      {c.itemName} ({c.itemCode}
                      {c.retailPrice !== null ? ` — ${formatRupiah(c.retailPrice)}` : ''})
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" onClick={() => handleNoneMatch(stage.query)}>
            Tidak ada yang cocok — Produk Baru
          </button>
          <button type="button" className="link-button" onClick={resetToEntry}>
            Kembali
          </button>
        </div>
      )}

      {stage.kind === 'existing' && (
        <div className="card">
          <span className="status-badge status-badge--synced">
            <IconCircleCheck size={14} /> Sudah terdaftar
          </span>
          <span className="card-value">{stage.match.itemName}</span>
          <span className="card-sub">Kode: {stage.match.itemCode}</span>
          {stage.match.uoms.length === 0 ? (
            <span className="card-sub">Harga tidak tersedia (cek koneksi)</span>
          ) : (
            stage.match.uoms.map((u) => (
              <span className="card-sub" key={u.uom}>
                {u.uom} — Retail: {u.retailPrice !== null ? formatRupiah(u.retailPrice) : '—'},
                Grosir: {u.grosirPrice !== null ? formatRupiah(u.grosirPrice) : 'Tidak diatur'}
              </span>
            ))
          )}
          <button type="button" onClick={resetToEntry}>
            Kembali
          </button>
        </div>
      )}

      {stage.kind === 'new' && (
        <form onSubmit={(e) => void handleCreateSubmit(e)} className="scan-form">
          <p className="hint">
            <IconAlertTriangle size={14} style={{ color: 'var(--color-warning)' }} />{' '}
            {stage.itemCodeEditable
              ? 'Belum ditemukan produk yang cocok — isi info di bawah untuk menambahkannya.'
              : `Kode ${stage.itemCode} belum terdaftar — isi info di bawah untuk menambahkannya.`}
          </p>

          {stage.itemCodeEditable && (
            <label>
              Kode Barang
              <input
                value={stage.itemCode}
                onChange={(e) =>
                  setStage((prev) =>
                    prev.kind === 'new' ? { ...prev, itemCode: e.target.value } : prev,
                  )
                }
                placeholder="Buat kode sendiri, mis. BAWANG-MERAH-01"
                autoFocus
              />
            </label>
          )}

          <label>
            Nama Barang
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              autoFocus={!stage.itemCodeEditable}
            />
          </label>

          <label>
            Item Grup
            <select value={itemGroup} onChange={(e) => setItemGroup(e.target.value)}>
              {itemGroups.length === 0 && <option value="">Tidak ada data (cek koneksi)</option>}
              {itemGroups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Satuan Dasar
            <UomPicker
              key={formResetKey}
              value={stockUom}
              onChange={setStockUom}
              datalistId={UOM_DATALIST_ID}
            />
          </label>

          <label>
            Harga Retail
            <input
              value={retailPrice}
              onChange={(e) => setRetailPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>

          <label>
            Harga Grosir (opsional)
            <input
              value={grosirPrice}
              onChange={(e) => setGrosirPrice(e.target.value)}
              inputMode="decimal"
              placeholder="Kosongkan jika sama dengan retail"
            />
          </label>

          <div className="package-uoms">
            {packageUomRows.map((row, index) => (
              <div className="package-uom-row" key={index}>
                <div className="package-uom-row-uom">
                  <UomPicker
                    value={row.uom}
                    onChange={(uom) => updatePackageUomRow(index, { uom })}
                    datalistId={UOM_DATALIST_ID}
                  />
                </div>
                <input
                  value={row.conversionQty}
                  onChange={(e) => updatePackageUomRow(index, { conversionQty: e.target.value })}
                  inputMode="decimal"
                  placeholder={`Isi per ${row.uom || 'kemasan'}`}
                />
                <input
                  value={row.retailPrice}
                  onChange={(e) => updatePackageUomRow(index, { retailPrice: e.target.value })}
                  inputMode="decimal"
                  placeholder="Harga Retail"
                />
                <input
                  value={row.grosirPrice}
                  onChange={(e) => updatePackageUomRow(index, { grosirPrice: e.target.value })}
                  inputMode="decimal"
                  placeholder="Harga Grosir (opsional)"
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => removePackageUomRow(index)}
                  aria-label="Hapus Satuan Kemasan"
                >
                  <IconX size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="link-button"
              onClick={() => setPackageUomRows((rows) => [...rows, emptyPackageUomRow()])}
              title={`Untuk produk yang juga dijual per kemasan, mis. Dus berisi beberapa ${stockUom || 'Satuan Dasar'}`}
            >
              <IconPlus size={14} /> Tambah Satuan Kemasan
            </button>
          </div>

          <label>
            Stok Awal (opsional)
            <input
              value={openingQty}
              onChange={(e) => setOpeningQty(e.target.value)}
              inputMode="decimal"
              placeholder="Kosongkan jika belum ada stok fisik"
            />
          </label>
          <p className="hint">Kosongkan untuk tambah stok nanti lewat Input Stok.</p>

          <label>
            Harga Modal/Beli {Number(openingQty) > 0 ? '(wajib)' : '(opsional)'}
            <input
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>

          {Number(openingQty) > 0 && (
            <label>
              Gudang
              <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                {warehouses.length === 0 && <option value="">Tidak ada data (cek koneksi)</option>}
                {warehouses.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Menyimpan…' : 'Simpan Produk'}
          </button>
          <button type="button" className="link-button" onClick={resetToEntry}>
            Batal
          </button>
        </form>
      )}

      <datalist id={UOM_DATALIST_ID}>
        {uoms.map((u) => (
          <option key={u.name} value={u.name} />
        ))}
      </datalist>

      {cameraOpen && (
        <CameraScanner
          onDetect={(value) => {
            setCameraOpen(false);
            void handleScanResult(value);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { fetchReceiptTemplate, updateReceiptTemplate, type ReceiptTemplate } from '../lib/api';

const TEMPLATE_OPTIONS: Array<{ value: ReceiptTemplate; label: string; description: string }> = [
  {
    value: 'Minimal',
    label: 'Minimal',
    description:
      'Nama toko, barang, dan total saja — paling ringkas, cocok untuk printer thermal kecil.',
  },
  {
    value: 'Standard',
    label: 'Standard',
    description: 'Nama toko, alamat, No. WhatsApp Toko, barang, total, dan rincian pembayaran.',
  },
  {
    value: 'Detailed',
    label: 'Detailed',
    description:
      'Semua info Standard, ditambah logo toko dan pesan penutup — struk yang juga jadi promosi kecil.',
  },
];

/**
 * Minimal by design (spec: "keep it minimal for now — just the receipt
 * template selector, don't build a general settings framework yet") — one
 * setting, one screen, no tabs/sections that would only make sense once
 * there's a second thing to configure.
 */
export default function Settings() {
  const [current, setCurrent] = useState<ReceiptTemplate | null>(null);
  const [selected, setSelected] = useState<ReceiptTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReceiptTemplate()
      .then(({ template }) => {
        if (!cancelled) {
          setCurrent(template);
          setSelected(template);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(): Promise<void> {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await updateReceiptTemplate(selected);
      setCurrent(result.template);
      setMessage('Template struk disimpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2 className="section-label">Pengaturan</h2>
      <h3 className="section-label">Template Struk</h3>

      {loading && <p className="hint">Memuat…</p>}
      {error && <p className="error-box">{error}</p>}

      {!loading && (
        <>
          <div className="template-option-list">
            {TEMPLATE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={
                  selected === option.value
                    ? 'card template-option template-option--selected'
                    : 'card template-option'
                }
              >
                <input
                  type="radio"
                  name="receipt-template"
                  value={option.value}
                  checked={selected === option.value}
                  onChange={() => setSelected(option.value)}
                />
                <span>
                  <span className="menu-card-title">{option.label}</span>
                  <br />
                  <span className="hint">{option.description}</span>
                </span>
              </label>
            ))}
          </div>

          {message && <p className="message">{message}</p>}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !selected || selected === current}
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  fetchReceiptCustomization,
  fetchReceiptTemplate,
  fetchStoreProfile,
  updateReceiptCustomization,
  updateReceiptTemplate,
  updateStoreProfile,
  uploadStoreLogo,
  type ReceiptCustomization,
  type ReceiptTemplate,
  type StoreProfile,
} from '../lib/api';

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
    description: 'Nama toko, alamat, No. WA, barang, total, dan rincian pembayaran.',
  },
  {
    value: 'Detailed',
    label: 'Detailed',
    description:
      'Semua info Standard, ditambah logo toko dan pesan penutup — struk yang juga jadi promosi kecil.',
  },
];

/** ERPNext-hosted files (both /files/... public and /private/files/... private) are only reachable through ERPNext itself, proxied at /erp — a bare relative path resolves against this app's own origin instead and 404s. */
function resolveErpAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${window.location.origin}/erp${path.startsWith('/') ? path : `/${path}`}`;
}

export default function Settings() {
  const [current, setCurrent] = useState<ReceiptTemplate | null>(null);
  const [selected, setSelected] = useState<ReceiptTemplate | null>(null);
  const [printFormat, setPrintFormat] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [profile, setProfile] = useState<StoreProfile | null>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoBroken, setLogoBroken] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [customization, setCustomization] = useState<ReceiptCustomization | null>(null);
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [tagline, setTagline] = useState('');
  const [customizationLoading, setCustomizationLoading] = useState(true);
  const [customizationSaving, setCustomizationSaving] = useState(false);
  const [customizationError, setCustomizationError] = useState<string | null>(null);
  const [customizationMessage, setCustomizationMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReceiptTemplate()
      .then(({ template, printFormat: format }) => {
        if (!cancelled) {
          setCurrent(template);
          setSelected(template);
          setPrintFormat(format);
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

  useEffect(() => {
    let cancelled = false;
    fetchStoreProfile()
      .then((result) => {
        if (!cancelled) {
          setProfile(result);
          setPhone(result.phone);
          setAddress(result.address);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setProfileError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchReceiptCustomization()
      .then((result) => {
        if (!cancelled) {
          setCustomization(result);
          setHeaderText(result.headerText);
          setFooterText(result.footerText);
          setLogoUrl(result.logoUrl);
          setTagline(result.tagline);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setCustomizationError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setCustomizationLoading(false);
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
      setPrintFormat(result.printFormat);
      setMessage('Template struk disimpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProfile(): Promise<void> {
    setProfileSaving(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const result = await updateStoreProfile({ phone, address });
      setProfile(result);
      setProfileMessage('Profil toko disimpan.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleLogoSelected(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    setLogoError(null);
    setLogoBroken(false);
    try {
      const result = await uploadStoreLogo(file);
      setProfile(result);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogoUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSaveCustomization(): Promise<void> {
    setCustomizationSaving(true);
    setCustomizationError(null);
    setCustomizationMessage(null);
    try {
      const result = await updateReceiptCustomization({ headerText, footerText, logoUrl, tagline });
      setCustomization(result);
      setCustomizationMessage('Kustomisasi struk disimpan.');
    } catch (err) {
      setCustomizationError(err instanceof Error ? err.message : String(err));
    } finally {
      setCustomizationSaving(false);
    }
  }

  const profileChanged =
    profile != null && (phone !== profile.phone || address !== profile.address);

  const customizationChanged =
    customization != null &&
    (headerText !== customization.headerText ||
      footerText !== customization.footerText ||
      logoUrl !== customization.logoUrl ||
      tagline !== customization.tagline);

  return (
    <>
      <h2 className="section-label">Pengaturan</h2>

      <h3 className="section-label">Profil Toko</h3>
      {profileLoading && <p className="hint">Memuat…</p>}
      {profileError && <p className="error-box">{profileError}</p>}

      {!profileLoading && profile && (
        <form className="scan-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            Nama Toko
            <input value={profile.companyName} disabled />
            <span className="hint">
              Ganti nama toko harus dilakukan langsung di ERPNext (Setup &gt; Company) — nama ini
              juga jadi ID internal yang dipakai di seluruh sistem, jadi tidak bisa diubah dari
              sini.
            </span>
          </label>

          <label>
            No. WA Toko
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812…" />
          </label>

          <label>
            Alamat Toko (untuk struk)
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              placeholder="Alamat lengkap toko"
            />
          </label>

          {profileMessage && <p className="message">{profileMessage}</p>}
          <button
            type="button"
            onClick={() => void handleSaveProfile()}
            disabled={profileSaving || !profileChanged}
          >
            {profileSaving ? 'Menyimpan…' : 'Simpan Profil'}
          </button>

          <label>
            Logo Toko
            <div className="logo-upload-row">
              {profile.logoUrl && !logoBroken ? (
                <img
                  src={resolveErpAssetUrl(profile.logoUrl)}
                  alt="Logo toko"
                  className="logo-preview"
                  onError={() => setLogoBroken(true)}
                />
              ) : (
                <span className="hint">Belum ada logo</span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => void handleLogoSelected(e)}
                disabled={logoUploading}
              />
            </div>
            {logoUploading && <p className="hint">Mengunggah logo…</p>}
            {logoError && <p className="error-box">{logoError}</p>}
          </label>
        </form>
      )}

      <h3 className="section-label">Kustomisasi Struk</h3>
      {customizationLoading && <p className="hint">Memuat…</p>}
      {customizationError && <p className="error-box">{customizationError}</p>}

      {!customizationLoading && customization && (
        <form className="scan-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            Header Teks (di atas nama toko)
            <input
              value={headerText}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Mis. Toko Sembako Terpercaya"
              maxLength={200}
            />
          </label>

          <label>
            Tagline Toko (di bawah nama toko)
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Mis. Sembako & Kebutuhan Harian"
              maxLength={150}
            />
            <span className="hint">
              Beda dari Header Teks di atas (yang tampil sebelum nama toko) — ini tampil sebagai
              subjudul tepat di bawah nama toko.
            </span>
          </label>

          <label>
            Footer Teks (di bawah struk)
            <textarea
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              rows={2}
              placeholder='Kosongkan untuk pesan bawaan ("Terima kasih atas kunjungan Anda!")'
              maxLength={300}
            />
          </label>

          <label>
            Logo URL (untuk struk)
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
              maxLength={500}
            />
            <span className="hint">
              Harus alamat gambar lengkap (https://…) yang bisa diakses publik — beda dari
              &quot;Logo Toko&quot; di atas, yang hanya dipakai ERPNext sendiri. Kosongkan jika
              belum ada.
            </span>
          </label>

          {customizationMessage && <p className="message">{customizationMessage}</p>}
          <button
            type="button"
            onClick={() => void handleSaveCustomization()}
            disabled={customizationSaving || !customizationChanged}
          >
            {customizationSaving ? 'Menyimpan…' : 'Simpan Kustomisasi'}
          </button>
        </form>
      )}

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

          {printFormat && (
            <p className="hint">
              Header, footer, dan logo struk sudah bisa diatur di atas. Untuk mengubah tata letak
              atau susunan yang lebih detail, itu diatur langsung di ERPNext.{' '}
              <a
                href={`${window.location.origin}/erp/app/print-format/${encodeURIComponent(printFormat)}`}
                target="_blank"
                rel="noreferrer"
              >
                Edit tata letak struk di ERPNext →
              </a>
            </p>
          )}
        </>
      )}
    </>
  );
}

import { useState } from 'react';
import { IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { setServerUrl, testServerConnection } from '../lib/server-config';
import { STORE_NAME } from '../branding';

/**
 * First-run setup (Item 2C) — only ever shown when App.tsx finds no
 * usable server URL at all (see server-config.ts's doc comment: a
 * generic packaged app with no store-specific URL baked in). A normal
 * browser tab or a TWA wrapping a real https:// page never reaches this
 * screen — it already knows its own server from window.location.origin.
 */
export default function SetupWizard({ onConfigured }: { onConfigured: () => void }) {
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  async function handleTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    const ok = await testServerConnection(url);
    setTestResult(ok ? 'ok' : 'fail');
    setTesting(false);
  }

  function handleSave(): void {
    setServerUrl(url);
    onConfigured();
  }

  return (
    <main className="app setup-wizard">
      <h1>{STORE_NAME}</h1>
      <p className="hint">
        Aplikasi ini belum terhubung ke server toko manapun. Masukkan alamat server toko Anda untuk
        mulai — tanya pemilik toko atau teknisi yang memasang server jika belum tahu alamatnya.
      </p>

      <div className="scan-form">
        <label>
          URL Server
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTestResult(null);
            }}
            placeholder="https://tokoanda.duckdns.org"
            inputMode="url"
            autoFocus
          />
        </label>

        {testResult === 'ok' && (
          <p className="message">
            <IconCircleCheck size={18} style={{ color: 'var(--color-success)' }} /> Koneksi berhasil
            — server ditemukan.
          </p>
        )}
        {testResult === 'fail' && (
          <p className="error-box">
            <IconCircleX size={18} style={{ color: 'var(--color-danger)' }} /> Tidak bisa terhubung
            ke alamat ini. Periksa lagi alamatnya (harus diawali https://) dan koneksi internet
            Anda, lalu coba lagi.
          </p>
        )}

        <button
          type="button"
          className="button-secondary"
          onClick={() => void handleTest()}
          disabled={!url.trim() || testing}
        >
          {testing ? 'Menguji koneksi…' : 'Test Koneksi'}
        </button>

        <button
          type="button"
          className="button-primary"
          onClick={handleSave}
          disabled={!url.trim() || testResult !== 'ok'}
        >
          Simpan & Lanjutkan
        </button>
      </div>
    </main>
  );
}

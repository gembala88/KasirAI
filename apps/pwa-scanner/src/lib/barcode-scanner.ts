/**
 * Camera-based barcode scanning for the warehouse screens (spec §1.3 FR-7,
 * §14: "Camera-based scanning... stays reserved for warehouse/stock-opname
 * use, not the checkout counter" — Kasir keeps its USB/Bluetooth
 * keyboard-emulation text input, unchanged).
 *
 * Prefers the native `BarcodeDetector` API (Chrome/Edge on Android — no
 * extra JS decoding work per frame, lower battery/CPU cost) and falls back
 * to `@zxing/browser` where it isn't available (notably Safari/iOS, which
 * has never shipped BarcodeDetector).
 *
 * `@zxing/browser` (which bundles a full barcode decoder, ~450KB) is
 * dynamically imported only inside the fallback path — Kasir never opens
 * the camera scanner at all, and most Android Chrome users have native
 * BarcodeDetector support and so never load this dependency either.
 */

export interface ScannerControls {
  stop: () => void;
}

export function isNativeBarcodeDetectorSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export function cameraErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Izin kamera ditolak — aktifkan izin kamera di pengaturan browser untuk memindai barcode.';
  }
  if (name === 'NotFoundError') {
    return 'Kamera tidak ditemukan di perangkat ini.';
  }
  if (name === 'NotReadableError') {
    return 'Kamera sedang dipakai aplikasi lain.';
  }
  return `Gagal mengakses kamera: ${err instanceof Error ? err.message : String(err)}`;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

async function startNativeScan(
  video: HTMLVideoElement,
  onDetect: (value: string) => void,
  onError: (message: string) => void,
): Promise<ScannerControls> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (err) {
    onError(cameraErrorMessage(err));
    return { stop: () => {} };
  }
  video.srcObject = stream;
  await video.play();

  const BarcodeDetectorCtor = (
    window as unknown as {
      BarcodeDetector: new (opts: { formats: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  const detector = new BarcodeDetectorCtor({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
  });

  let stopped = false;
  let rafId = 0;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0 && barcodes[0]?.rawValue) {
        onDetect(barcodes[0].rawValue);
        return; // caller stops the stream once a value is reported
      }
    } catch {
      // A frame with no decodable barcode is normal, not an error.
    }
    rafId = requestAnimationFrame(() => void tick());
  }
  rafId = requestAnimationFrame(() => void tick());

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

async function startZXingScan(
  video: HTMLVideoElement,
  onDetect: (value: string) => void,
  onError: (message: string) => void,
): Promise<ScannerControls> {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatReader();
  try {
    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      video,
      (result) => {
        // The callback also fires with a NotFoundException on every frame
        // with no barcode present — that's the expected steady state while
        // scanning, not a real error, so only `result` matters here.
        if (result) {
          onDetect(result.getText());
        }
      },
    );
    return { stop: () => controls.stop() };
  } catch (err) {
    onError(cameraErrorMessage(err));
    return { stop: () => {} };
  }
}

/**
 * Starts scanning `video`, calling `onDetect` once with the first decoded
 * barcode's text (the caller is expected to call `.stop()` on the returned
 * controls once it has what it needs — this module doesn't stop itself
 * after one hit, since a caller might legitimately want continuous scans).
 */
export async function startBarcodeScan(
  video: HTMLVideoElement,
  onDetect: (value: string) => void,
  onError: (message: string) => void,
): Promise<ScannerControls> {
  return isNativeBarcodeDetectorSupported()
    ? startNativeScan(video, onDetect, onError)
    : startZXingScan(video, onDetect, onError);
}

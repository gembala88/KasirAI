import { useEffect, useRef, useState } from 'react';
import { startBarcodeScan, type ScannerControls } from '../lib/barcode-scanner';

/**
 * Full-screen camera overlay, shared by the warehouse screens and Kasir —
 * spec §14 originally reserved camera scanning for warehouse/stock-opname
 * only, but real live testing on a desktop PC (spec §13's actual checkout
 * hardware) showed Kasir had no way to use a webcam at all, only a
 * hardware barcode scanner or manual typing. Requests camera permission
 * on mount, stops the stream on unmount/close/successful detection —
 * never leaves the camera running in the background.
 */
export default function CameraScanner({
  onDetect,
  onClose,
}: {
  onDetect: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start(): Promise<void> {
      const video = videoRef.current;
      if (!video) return;
      const controls = await startBarcodeScan(
        video,
        (value) => {
          if (cancelled) return;
          controlsRef.current?.stop();
          onDetect(value);
        },
        (message) => {
          if (!cancelled) setError(message);
        },
      );
      if (cancelled) {
        controls.stop();
      } else {
        controlsRef.current = controls;
      }
    }

    void start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
  }, []);

  return (
    <div className="scanner-overlay" role="dialog" aria-label="Scan barcode dengan kamera">
      <div className="scanner-frame">
        <video ref={videoRef} className="scanner-video" muted playsInline />
        <div className="scanner-guide" />
      </div>
      {error && <p className="error-box scanner-error">{error}</p>}
      <button type="button" className="scanner-close" onClick={onClose}>
        Tutup
      </button>
    </div>
  );
}

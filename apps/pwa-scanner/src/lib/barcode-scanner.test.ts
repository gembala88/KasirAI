import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraErrorMessage, isNativeBarcodeDetectorSupported } from './barcode-scanner';

describe('isNativeBarcodeDetectorSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when BarcodeDetector exists on window', () => {
    vi.stubGlobal('window', { BarcodeDetector: class {} });
    expect(isNativeBarcodeDetectorSupported()).toBe(true);
  });

  it('is false when BarcodeDetector is absent (e.g. Safari/iOS)', () => {
    vi.stubGlobal('window', {});
    expect(isNativeBarcodeDetectorSupported()).toBe(false);
  });
});

describe('cameraErrorMessage — spec §14 camera scanning (warehouse only)', () => {
  it('gives a clear Indonesian message for a denied permission', () => {
    const err = new DOMException('denied', 'NotAllowedError');
    expect(cameraErrorMessage(err)).toMatch(/izin kamera ditolak/i);
  });

  it('gives a clear message when no camera exists on the device', () => {
    const err = new DOMException('none', 'NotFoundError');
    expect(cameraErrorMessage(err)).toMatch(/kamera tidak ditemukan/i);
  });

  it('gives a clear message when the camera is already in use', () => {
    const err = new DOMException('busy', 'NotReadableError');
    expect(cameraErrorMessage(err)).toMatch(/dipakai aplikasi lain/i);
  });

  it('falls back to a generic message for an unrecognized error', () => {
    expect(cameraErrorMessage(new Error('boom'))).toContain('boom');
  });
});

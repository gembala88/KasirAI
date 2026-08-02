import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAuth,
  getStoredAuth,
  notifyAuthRequired,
  setOnAuthRequired,
  storeAuth,
} from './auth';

// jsdom isn't configured for this project (no DOM-dependent components are
// unit tested), so localStorage is stubbed minimally here — just enough
// for these pure storage-logic tests.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
});

beforeEach(() => {
  store.clear();
  setOnAuthRequired(null);
});

describe('auth storage', () => {
  it('round-trips accessToken/refreshToken/user through storeAuth/getStoredAuth', () => {
    const auth = {
      accessToken: 'a.b.c',
      refreshToken: 'd.e.f',
      user: { email: 'owner@hermes.local', fullName: 'Owner', role: 'Owner' as const },
    };
    storeAuth(auth);
    expect(getStoredAuth()).toEqual(auth);
  });

  it('returns null when nothing is stored, or storage is corrupt', () => {
    expect(getStoredAuth()).toBeNull();
    store.set('hermes-dashboard-auth', 'not json');
    expect(getStoredAuth()).toBeNull();
  });

  it('clearAuth removes the stored session', () => {
    storeAuth({
      accessToken: 'x',
      refreshToken: 'y',
      user: { email: 'a@b.c', fullName: 'A', role: 'Cashier' },
    });
    clearAuth();
    expect(getStoredAuth()).toBeNull();
  });
});

describe('auth-required notification', () => {
  it('invokes the registered callback when notifyAuthRequired is called', () => {
    const callback = vi.fn();
    setOnAuthRequired(callback);
    notifyAuthRequired();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does nothing (no throw) when no callback is registered', () => {
    setOnAuthRequired(null);
    expect(() => notifyAuthRequired()).not.toThrow();
  });
});

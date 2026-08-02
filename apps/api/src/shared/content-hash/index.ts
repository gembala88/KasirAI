/**
 * Deterministic content hash (spec §15.2: "lets the server verify the
 * payload wasn't corrupted or altered between offline creation and
 * sync"). A checksum, not a tamper-proof signature — there's no signing
 * key, so this catches accidental corruption (a flaky IndexedDB write, a
 * truncated request body) rather than a malicious client, which is all
 * §15.2 asks for.
 *
 * Canonicalization (sorted object keys) must produce byte-identical
 * output to `apps/pwa-scanner/src/lib/hash.ts`'s copy of this same
 * function — the two apps have no shared package to import a single
 * implementation from, so this is intentionally duplicated, not
 * accidentally. If you change one, change the other.
 */
import { createHash } from 'node:crypto';

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeContentHash(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

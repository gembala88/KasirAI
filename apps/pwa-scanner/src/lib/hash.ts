/**
 * Deterministic content hash (spec §15.2) — must produce byte-identical
 * output to apps/api/src/shared/content-hash/index.ts's copy of this same
 * function. No shared package exists between these two apps to import a
 * single implementation from, so this is intentionally duplicated, not
 * accidentally. If you change one, change the other.
 */
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

export async function computeContentHash(payload: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(payload));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

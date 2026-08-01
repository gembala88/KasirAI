/**
 * Hermes' own database (spec §5): "Hermes' own database (small, PostgreSQL
 * or MariaDB) only stores what ERPNext has no concept of" — ai_action_audit
 * being the first such table (§10 Phase 4).
 *
 * Uses Node's built-in `node:sqlite` rather than standing up a separate
 * Postgres/MariaDB server: on the confirmed 2 vCPU / 2 GB RAM VPS (§13),
 * the container memory budget was already at ~1.71 GB after Phase 3's
 * Redis addition, and a real DB server needs ~128 MB minimum even tuned
 * (see infra/docker/docker-compose.yml's budget table) — leaving too
 * thin a margin. SQLite is a single file, no server process, effectively
 * zero memory overhead, and entirely adequate for what these tables
 * actually are: append-heavy audit/log data with modest read volume, not
 * high-concurrency transactional data (ERPNext remains the source of
 * truth for everything that is). `node:sqlite` is still experimental in
 * Node — acceptable here since nothing business-critical depends on it.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at apps/api/src/shared/database/index.ts (or the
// mirrored dist/ path after build) — three levels below apps/api either
// way, so this resolves to apps/api/data regardless of src vs. dist.
const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DATA_DIR = join(API_ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'hermes.sqlite');

let db: DatabaseSync | undefined;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_action_audit (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    validation TEXT NOT NULL,
    erpnext_reference TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ai_action_audit_status ON ai_action_audit(status);
`;

export function getDb(): DatabaseSync {
  if (!db) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new DatabaseSync(DB_PATH);
    db.exec(SCHEMA);
  }
  return db;
}

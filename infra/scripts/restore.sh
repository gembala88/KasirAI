#!/usr/bin/env bash
# Restore a Hermes ERPNext site from a backup created by backup.sh.
#
# Two modes:
#   1. Disaster recovery (default): restores onto the site named by
#      $SITE_NAME, overwriting its current database. Use this to actually
#      recover from real data loss.
#   2. Verification (--verify-only): restores onto a fresh, throwaway
#      site instead, so a backup can be proven usable without touching
#      the real site's data. The throwaway site is dropped afterward
#      either way — this mode exists to prove restorability, not to
#      leave a second site lying around.
#
# Usage:
#   SITE_NAME=... DB_ROOT_PASSWORD=... ADMIN_PASSWORD=... \
#     infra/scripts/restore.sh <backup-dir> [--verify-only]
#
# <backup-dir> is one of the timestamped directories backup.sh creates,
# e.g. /opt/hermes-backups/daily/20260803-040000
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../docker" && pwd)"
SITE_NAME="${SITE_NAME:-hermes.localhost}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:?set DB_ROOT_PASSWORD}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"
COMPOSE_FILES=(-f docker-compose.yml)
if [ -f "$COMPOSE_DIR/docker-compose.shared-vps-test.yml" ] && [ "${USE_SHARED_VPS_OVERRIDE:-1}" = "1" ]; then
  COMPOSE_FILES+=(-f docker-compose.shared-vps-test.yml)
fi

BACKUP_DIR="${1:?Usage: restore.sh <backup-dir> [--verify-only]}"
VERIFY_ONLY=false
[ "${2:-}" = "--verify-only" ] && VERIFY_ONLY=true

log() { echo "[$(date -Is)] $*"; }

[ -d "$BACKUP_DIR" ] || { log "ERROR: backup dir not found: $BACKUP_DIR"; exit 1; }

SQL_FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name '*-database.sql.gz' | head -1)
PRIVATE_FILES=$(find "$BACKUP_DIR" -maxdepth 1 -name '*-private-files.tar' | head -1)
PUBLIC_FILES=$(find "$BACKUP_DIR" -maxdepth 1 -name '*-files.tar' ! -name '*-private-files.tar' | head -1)

[ -n "$SQL_FILE" ] || { log "ERROR: no *-database.sql.gz found in $BACKUP_DIR"; exit 1; }
log "Using SQL dump: $(basename "$SQL_FILE")"

cd "$COMPOSE_DIR"

TARGET_SITE="$SITE_NAME"
if [ "$VERIFY_ONLY" = true ]; then
  TARGET_SITE="restore-verify-$(date +%s).localhost"
  log "Verify-only mode: restoring onto throwaway site $TARGET_SITE, not the real site"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend \
    bench new-site --mariadb-user-host-login-scope='%' --admin-password="$ADMIN_PASSWORD" \
      --db-root-username=root --db-root-password="$DB_ROOT_PASSWORD" "$TARGET_SITE"
fi

# Copy the backup files INTO the container so bench's own restore command
# (which expects local paths inside the container, not host paths) can
# find them.
WORKDIR="/tmp/restore-$TARGET_SITE"
docker compose "${COMPOSE_FILES[@]}" exec -T backend mkdir -p "$WORKDIR"
docker compose "${COMPOSE_FILES[@]}" cp "$SQL_FILE" "backend:$WORKDIR/database.sql.gz"
[ -n "$PRIVATE_FILES" ] && docker compose "${COMPOSE_FILES[@]}" cp "$PRIVATE_FILES" "backend:$WORKDIR/private-files.tar"
[ -n "$PUBLIC_FILES" ] && docker compose "${COMPOSE_FILES[@]}" cp "$PUBLIC_FILES" "backend:$WORKDIR/files.tar"

RESTORE_CMD="bench --site $TARGET_SITE restore $WORKDIR/database.sql.gz --mariadb-root-password $DB_ROOT_PASSWORD --mariadb-root-username root"
[ -n "$PRIVATE_FILES" ] && RESTORE_CMD="$RESTORE_CMD --with-private-files $WORKDIR/private-files.tar"
[ -n "$PUBLIC_FILES" ] && RESTORE_CMD="$RESTORE_CMD --with-public-files $WORKDIR/files.tar"

log "Running restore onto $TARGET_SITE..."
docker compose "${COMPOSE_FILES[@]}" exec -T backend bash -c "$RESTORE_CMD"
log "Restore command completed."

if [ "$VERIFY_ONLY" = true ]; then
  log "Verification data check: counting Sales Invoice records on the restored site..."
  docker compose "${COMPOSE_FILES[@]}" exec -T backend \
    bench --site "$TARGET_SITE" execute frappe.db.count --args "['Sales Invoice']"
  log "Tearing down throwaway site $TARGET_SITE"
  docker compose "${COMPOSE_FILES[@]}" exec -T backend \
    bench drop-site "$TARGET_SITE" --db-root-username root --db-root-password "$DB_ROOT_PASSWORD" --force
  docker compose "${COMPOSE_FILES[@]}" exec -T backend rm -rf "$WORKDIR"
  log "Verification complete — the backup file is genuinely restorable, not just present."
else
  log "Restored onto the real site $TARGET_SITE. Restart the app containers to pick up the restored data:"
  log "  docker compose ${COMPOSE_FILES[*]} restart backend queue scheduler"
fi

#!/usr/bin/env bash
# Real MariaDB + files backup for Hermes' ERPNext site (spec §1.3 FR-2's
# "scheduled job" precedent, applied to the actual database this time —
# not the separate product-list CSV export FR-2 also describes, which is
# a different, still-unbuilt feature, noted honestly rather than
# conflated with this one).
#
# Uses Frappe's own `bench backup`, not a hand-rolled mysqldump — bench's
# command is what correctly captures the site's encryption key alongside
# the DB dump; a DB-only backup without it can't decrypt encrypted
# fields on restore, which would make the backup file real but useless.
#
# Retention: daily/weekly/monthly tiers (spec §1.3 FR-2's "scheduled...
# daily" cadence, extended here to weekly/monthly per the Phase 9 ask).
# Every run always writes a daily backup; Sunday runs are also kept as
# that week's weekly backup; the 1st-of-month run is also kept as that
# month's monthly backup. Pruning only removes the *oldest excess*
# backups per tier, never touches other tiers.
#
# Usage: infra/scripts/backup.sh
# Intended to run via a systemd timer or cron — see infra/scripts/README.md
# (or RUNBOOK.md) for how this project wires that up.
set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../docker" && pwd)"
SITE_NAME="${SITE_NAME:-hermes.localhost}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/hermes-backups}"
RETENTION_DAILY="${RETENTION_DAILY:-7}"
RETENTION_WEEKLY="${RETENTION_WEEKLY:-4}"
RETENTION_MONTHLY="${RETENTION_MONTHLY:-6}"
COMPOSE_FILES=(-f docker-compose.yml)
if [ -f "$COMPOSE_DIR/docker-compose.shared-vps-test.yml" ] && [ "${USE_SHARED_VPS_OVERRIDE:-1}" = "1" ]; then
  COMPOSE_FILES+=(-f docker-compose.shared-vps-test.yml)
fi

log() { echo "[$(date -Is)] $*"; }

cd "$COMPOSE_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DAILY_DIR="$BACKUP_ROOT/daily/$TIMESTAMP"

log "Starting backup for site $SITE_NAME -> $DAILY_DIR"
mkdir -p "$DAILY_DIR"

docker compose "${COMPOSE_FILES[@]}" exec -T backend \
  bench --site "$SITE_NAME" backup --with-files

BACKUP_DIR_IN_CONTAINER="sites/$SITE_NAME/private/backups"
docker compose "${COMPOSE_FILES[@]}" cp "backend:/home/frappe/frappe-bench/$BACKUP_DIR_IN_CONTAINER/." "$DAILY_DIR/"

FILE_COUNT=$(find "$DAILY_DIR" -maxdepth 1 -type f | wc -l)
if [ "$FILE_COUNT" -eq 0 ]; then
  log "ERROR: no backup files copied out — treating as a failed backup"
  rmdir "$DAILY_DIR" 2>/dev/null || true
  exit 1
fi
log "Copied $FILE_COUNT backup file(s)"

DAY_OF_WEEK="$(date +%u)"   # 1 = Monday .. 7 = Sunday
DAY_OF_MONTH="$(date +%d)"

if [ "$DAY_OF_WEEK" = "7" ]; then
  WEEKLY_DIR="$BACKUP_ROOT/weekly/$TIMESTAMP"
  log "Sunday — also keeping this run as a weekly backup: $WEEKLY_DIR"
  mkdir -p "$WEEKLY_DIR"
  cp -a "$DAILY_DIR/." "$WEEKLY_DIR/"
fi

if [ "$DAY_OF_MONTH" = "01" ]; then
  MONTHLY_DIR="$BACKUP_ROOT/monthly/$TIMESTAMP"
  log "1st of the month — also keeping this run as a monthly backup: $MONTHLY_DIR"
  mkdir -p "$MONTHLY_DIR"
  cp -a "$DAILY_DIR/." "$MONTHLY_DIR/"
fi

prune_tier() {
  local tier_dir="$1"
  local keep="$2"
  [ -d "$tier_dir" ] || return 0
  local total
  total=$(find "$tier_dir" -mindepth 1 -maxdepth 1 -type d | wc -l)
  if [ "$total" -gt "$keep" ]; then
    local excess=$((total - keep))
    log "Pruning $excess old backup(s) from $tier_dir (keeping newest $keep)"
    find "$tier_dir" -mindepth 1 -maxdepth 1 -type d | sort | head -n "$excess" | xargs -r rm -rf
  fi
}

prune_tier "$BACKUP_ROOT/daily" "$RETENTION_DAILY"
prune_tier "$BACKUP_ROOT/weekly" "$RETENTION_WEEKLY"
prune_tier "$BACKUP_ROOT/monthly" "$RETENTION_MONTHLY"

log "Backup complete."

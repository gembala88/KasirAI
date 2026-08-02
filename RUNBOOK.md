# Hermes Operations Runbook

Written against the real Phase 9 smoke-test deployment on `43.128.68.124`
(a shared VPS, see README.md's Phase 9 section for why it's shared and
what that means for the numbers below). Re-verify paths/ports if this is
ever run against a different box.

## Architecture at a glance

```
Internet -> Nginx (host, :80/:443) -> dashboard   (:5175, 127.0.0.1 only)
                                    -> pwa-scanner (:5176, 127.0.0.1 only)
                                    -> api         (:3001, 127.0.0.1 only)
                                    -> erpnext frontend (:8080, currently 0.0.0.0 — see Security note below)

api, dashboard, pwa-scanner, and the whole ERPNext stack (backend, db,
queue, scheduler, websocket, frontend, redis-cache, redis-queue,
hermes-redis) all run in Docker Compose, one project, one network
(`hermes_network`), defined in infra/docker/docker-compose.yml
(+ docker-compose.shared-vps-test.yml override on this specific box).
```

**Security note:** `frontend` (ERPNext, :8080) and `hermes-redis` (:6380)
are currently published to `0.0.0.0`, not `127.0.0.1` — inherited from
the local-dev-oriented defaults in docker-compose.yml (`HTTP_PUBLISH_PORT`,
`HERMES_REDIS_PUBLISH_PORT`). On this specific deployment it doesn't
matter yet because the cloud provider's security group blocks external
access to non-80/443/22 ports anyway (see README's Phase 9 section) —
but before that firewall situation changes, rebind both to
`127.0.0.1:${PORT}:...` in the compose file, matching how `api`/
`dashboard`/`pwa-scanner` are already done, so ERPNext and Redis are
only reachable through Nginx like everything else.

## Restarting a service

```bash
cd /opt/hermes-platform/infra/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.shared-vps-test.yml"

# One service (safe, doesn't affect others):
$COMPOSE restart api
$COMPOSE restart backend queue scheduler   # ERPNext's own app-layer trio

# Everything:
$COMPOSE restart

# Nginx (host-level, not a container):
systemctl reload nginx   # config change, no downtime
systemctl restart nginx  # full restart
```

Rebuilding after a code change (not just a restart):
```bash
cd /opt/hermes-platform
git pull   # or re-transfer changed files if not using a git remote
cd infra/docker
$COMPOSE up -d --build api        # or dashboard / pwa-scanner
```

## Where to check logs

- **Application errors (Hermes API):** structured JSON via Pino —
  `docker compose ... logs -f api`, or `docker compose ... logs api --tail 200`.
  Every log line is one JSON object; pipe through `jq` for readability:
  `docker compose ... logs api --tail 200 | jq -r '.msg'`.
- **Sentry** (if `SENTRY_DSN` is set in `/opt/hermes-platform/.env` — it
  is NOT set on this smoke-test deployment, see the pre-launch checklist
  below): unhandled errors, process crashes, BullMQ job failures, the
  ERPNext circuit breaker opening, and AI Gateway exhaustion all report
  there automatically (apps/api/src/shared/observability/sentry.ts).
  Check the Sentry project dashboard directly, not VPS logs, once enabled.
- **ERPNext/Frappe:** `docker compose ... logs backend` (web requests),
  `logs queue` (background jobs), `logs scheduler` (cron-like Frappe jobs).
- **Nginx:** `/var/log/nginx/access.log` and `/var/log/nginx/error.log`
  (standard Ubuntu paths, not containerized).
- **Backup runs:** `journalctl -u hermes-backup.service` (see below).

## Backups

Automated: `hermes-backup.timer` (systemd, daily at 02:00 + up to 5 min
random delay) runs `infra/scripts/backup.sh`, which uses Frappe's own
`bench backup --with-files` (not a hand-rolled mysqldump — see the
script's own header comment for why that matters) and keeps
daily/weekly/monthly tiers under `/opt/hermes-backups`.

```bash
# Check the timer is alive and see when it last/next ran:
systemctl status hermes-backup.timer
systemctl list-timers hermes-backup.timer

# Check a specific run's log:
journalctl -u hermes-backup.service --since "1 day ago"

# Trigger one manually (exactly what the timer does automatically):
systemctl start hermes-backup.service
```

**Restoring** — see `infra/scripts/restore.sh`'s header comment for full
usage. Two modes:
```bash
# Verify a backup is usable WITHOUT touching the real site (restores onto
# a throwaway site, checks the data, tears the throwaway site down):
SITE_NAME=hermes.localhost DB_ROOT_PASSWORD=<from .env in infra/docker/.env> \
  ADMIN_PASSWORD=<same> \
  infra/scripts/restore.sh /opt/hermes-backups/daily/<timestamp> --verify-only

# Real disaster recovery — overwrites the actual site's data:
SITE_NAME=hermes.localhost DB_ROOT_PASSWORD=... ADMIN_PASSWORD=... \
  infra/scripts/restore.sh /opt/hermes-backups/daily/<timestamp>
# then:
docker compose ... restart backend queue scheduler
```

## Rolling back a bad deploy

Since there's no image registry/tag history yet (images are built
locally on the VPS via `--build`), rollback means reverting the source
and rebuilding — not swapping an image tag:

```bash
cd /opt/hermes-platform
git log --oneline -5              # find the last-known-good commit
git checkout <good-commit-sha>    # or git revert the bad commit
cd infra/docker
docker compose -f docker-compose.yml -f docker-compose.shared-vps-test.yml \
  up -d --build api dashboard pwa-scanner
```

If the bad deploy included an ERPNext-side schema change (a new Custom
Field, DocType, etc. via a seed script), rolling back the *code* doesn't
undo that — ERPNext data changes are forward-only in practice. Restore
from a pre-deploy backup instead if that's the actual problem, not just
a code rollback.

## Failure-mode playbook (spec §15's brief: power/internet/VPS down)

These describe what *should* happen given what's actually built — see
README.md's §15 section for what's genuinely implemented vs. simplified.

- **Cashier's own internet drops mid-checkout:** handled entirely
  client-side (spec §15.2) — the sale is written to the browser's local
  IndexedDB queue the instant "Konfirmasi Pembayaran" is pressed, *before*
  any network call, then synced automatically once connectivity returns
  (or via the "Sinkron Sekarang" button). No action needed here; this is
  what §15.2's offline queue exists for. If a sale sits in "Failed"/
  "Pending" for a long time, that's a sign the VPS itself (not just the
  cashier's local connection) may be unreachable — check the items below.
- **VPS loses power:** MariaDB's `innodb_flush_log_at_trx_commit=1`
  (explicitly set, not relying on the default — see
  infra/erpnext/mariadb/hermes-tuning.cnf) guarantees a committed
  transaction survives this. On power return, Docker's `restart_policy:
  on-failure` brings every container back up automatically; verify with
  `docker compose ... ps` that everything shows `Up`, and check
  `docker compose ... logs db` for a clean recovery (InnoDB crash
  recovery logs on its own startup, this is normal and expected, not an
  error to act on unless it fails to complete).
- **VPS itself is unreachable (network/hosting issue, not just the
  cashier's connection):** nothing to do from inside the box in this
  case — confirm from another network whether it's a DNS/routing issue
  upstream of the VPS or the VPS itself is down (hosting provider's own
  status page/console). The offline queue keeps the PWA usable for new
  sales during this, but nothing can sync until the VPS is reachable
  again — communicate that clearly to staff rather than letting failed
  syncs go unnoticed for days.
- **A sync lands in `Conflict` status (§15.2 — e.g. concurrent stock
  changes going negative):** check the dashboard's "Konflik Sinkron" tab
  (Owner/Manager only). This is deliberately *not* auto-resolved — read
  the reason shown, correct the underlying stock discrepancy in ERPNext
  directly, and note that the original queued action stays un-applied
  (by design) rather than being silently retried into a wrong state.

## VPS resource ceiling reminder

This box's real numbers (confirmed live, not assumed) are tighter than a
dedicated VPS would be — see README.md's Phase 9 section for the full
story. If things get slow or `docker stats` shows containers pinned at
their `mem_limit`, that is the expected trade-off of a shared box, not
necessarily a Hermes bug — but it's also the reason a dedicated VPS is
required before real go-live, not just recommended.

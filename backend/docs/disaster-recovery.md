# Disaster Recovery Runbook

_Last updated: 2026-07-16 — Phase PLATFORM STABILIZATION Part 4._

This runbook describes how to recover the Scholaris database after a
production incident — disk loss, accidental drop, corrupted schema,
ransomware. It assumes you have **operator-grade access** (shell on
the host, the database password, and the backup storage path).

For tenant-level recovery (a single school wants its data back from
yesterday) see the per-school export tooling under
`/platform/operations/exports/*`; this runbook is **whole-database**.

## 1. Pre-requisites

| Item | Where it lives |
| --- | --- |
| Latest backup artifact | `BACKUP_ROOT_DIR/<runId>.dump` (LocalDiskProvider) |
| `pg_restore` binary | Installed on the deployment image |
| Target Postgres host | Reachable from the operator workstation |
| Operator credentials | `DATABASE_URL` for the target host (NOT prod) |

**Critical rule.** The platform does not expose a restore-from-API
path. Restore is always run by hand against a **clean** database.
Restoring into a database with in-flight writes corrupts state.

## 2. Recovery flow

### 2.1 Identify the backup to restore

```sh
# List recent backup runs (id, status, completedAt, sha256).
psql "$DATABASE_URL" -c \
  'SELECT id, status, "completedAt", encode("sha256"::bytea, '"'"'hex'"'"') FROM "backup_runs" ORDER BY "completedAt" DESC LIMIT 10;'
```

Pick the most recent `SUCCEEDED` row whose `completedAt` predates the
incident. Note its `id` — that's the artifact filename.

### 2.2 Verify the artifact

```sh
# 1. Confirm the file is present and the sha256 matches.
ls -l "$BACKUP_ROOT_DIR/<runId>.dump"
sha256sum "$BACKUP_ROOT_DIR/<runId>.dump"
# 2. Compare with the value from backup_runs.sha256.
```

If the sha256 doesn't match, **stop**. The artifact has been
corrupted; pick the next-most-recent backup.

### 2.3 Prepare a clean target

```sh
# Create a fresh database — never restore on top of an existing one.
createdb "scholaris_restored"
```

If you must restore over the existing database, drop and recreate it:

```sh
dropdb "scholaris"
createdb "scholaris"
```

### 2.4 Restore

```sh
# Restore the artifact. Format=custom dumps support parallelism + index
# rebuild deferral; use --jobs to speed up large restores.
pg_restore \
  --dbname="scholaris_restored" \
  --jobs=4 \
  --verbose \
  --no-owner \
  --no-privileges \
  "$BACKUP_ROOT_DIR/<runId>.dump"
```

Watch for errors. `pg_restore` reports non-fatal warnings for missing
roles when `--no-owner` is set — those are expected. Hard failures
(FK violations, missing schema) mean the artifact is incompatible
with the current Postgres version; consider matching the source
version exactly.

### 2.5 Cut over

1. Confirm the restored DB hostname + name match
   `DATABASE_URL` on the application host.
2. Restart the Scholaris application container so the connection
   pool re-attaches to the restored database.
3. Run the post-restore verification — see
   [`post-restore-verification.md`](./post-restore-verification.md).

## 3. RPO + RTO

| Metric | Target | Reality |
| --- | --- | --- |
| Recovery Point Objective | ≤ 24h | Daily backup at 03:00 UTC |
| Recovery Time Objective  | ≤ 1h  | Single-region `pg_restore` |

The 24h RPO is determined by the daily cron schedule. Schools who need
tighter (e.g. 1h) RPO must run on-demand backups before risky
operations from the platform operations cockpit.

## 4. Common failure modes

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `pg_restore` exits 0 but app shows empty pages | Wrong target database | Re-check `DATABASE_URL` |
| Login fails post-restore | `tokensValidAfter` column was set | Force-logout-all from SUPER_ADMIN, then re-login |
| Backup status panel shows "stale" indefinitely | Cron paused or `BACKUP_AUTOSTART=false` | Restart `BackupService` cron; check env |
| Audit log gaps around incident time | Audit emits are soft-fail | Cross-check with application logs |

## 5. After the restore

- Capture a screenshot of the System Health → Backups card showing a
  fresh `lastSuccessAt` timestamp on the recovered system.
- Trigger an immediate on-demand backup from `/platform/operations`
  so the next 24h backup window is anchored to the restored state.
- File a post-mortem note in the operator log with the runId, the
  restore command, and the sha256 verified.

## 6. What NOT to do

- **Do not** restore from a backup taken AFTER the incident — that
  artifact may itself be corrupted.
- **Do not** restore into a live database. Always restore into a
  fresh one and cut over.
- **Do not** run restore in parallel with writes. Stop the
  application container first.
- **Do not** trust the audit log alone to confirm restoration. Use
  the integrity report (`/system/integrity-report`) as a second
  source of truth.

## 7. Escalation

If pre-flight verification fails on ALL recent artifacts, the
deployment has lost both production data + its backup chain. At
that point:

1. Page the platform on-call rotation.
2. Hold all write traffic — put the app in maintenance mode.
3. Contact the cloud storage provider for the disk-snapshot recovery
   path. Daily backups are the operational fallback, not the only
   one.

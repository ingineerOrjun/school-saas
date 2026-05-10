# Restore Runbook

This is the operator-facing recovery procedure. Read it once before
you ever need it; print it for your incident binder.

**Audience**: an operator with shell access to the deployment host
+ Postgres credentials. Not a developer.

**Goal**: restore a production database from a `BackupRun`-produced
artifact, in a way that's safe under live load and verifiable
afterwards.

---

## Pre-flight checklist

Before running ANY restore command, verify:

- [ ] You have a backup ready (find its id from `/platform/operations` → Backups card, or via `psql … -c "SELECT id, status, location FROM backup_runs WHERE status='SUCCEEDED' ORDER BY \"createdAt\" DESC LIMIT 5;"`)
- [ ] You're targeting the right DB (`echo $DATABASE_URL` → confirm host + db name)
- [ ] **The application is stopped** (or you've enabled maintenance mode for every tenant). Live writes during restore corrupt FK state and can leave the DB in a half-restored state.
- [ ] You have at least 2× the backup file size in free disk on the target host (pg_restore unpacks in flight)
- [ ] You've taken a fresh backup of the CURRENT state — restore is destructive

If you can't tick any of these, **STOP**. Get a developer.

---

## Procedure

### 1. Find the backup id

Open `/platform/operations` in the dashboard, scroll to the Backups
card. The most recent SUCCEEDED row is the default candidate. Note
the row id and the SHA-256 hash.

Alternative (no UI): `psql "$DATABASE_URL" -c "SELECT id, \"completedAt\", \"sizeBytes\", sha256, location FROM backup_runs WHERE status='SUCCEEDED' ORDER BY \"createdAt\" DESC LIMIT 5;"`

### 2. Get the restore command

In the dashboard, click the row → "Get restore command". This calls
`GET /platform/operations/backups/:id/restore-command` and returns
the exact `pg_restore` invocation + the SHA-256 to verify.

Or call the API directly:

```bash
curl -H "Authorization: Bearer $OPERATOR_TOKEN" \
  "$API_BASE/platform/operations/backups/<backup-id>/restore-command"
```

The response includes:
- `command` — the literal command to run
- `location` — the artifact path
- `sha256` — expected hash
- `notes` — operator-facing guidance

### 3. Verify the artifact

**Always** verify the SHA-256 BEFORE restoring. A mismatched hash
means the file was corrupted in transit (or tampered with).

```bash
sha256sum <location>
# Output: <hash>  <location>
# Compare to the SHA-256 from step 2.
```

If the hash doesn't match, **STOP** — restoring a corrupted dump
silently introduces FK violations. Fall back to the previous
SUCCEEDED backup.

### 4. Stop the application

```bash
# systemd
sudo systemctl stop scholaris

# docker compose
docker compose stop backend

# pm2
pm2 stop scholaris
```

Confirm no connections remain:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database();"
# Should show: 1 (just your psql session)
```

If other connections remain, identify and kill them — pgrestore will
deadlock on a busy DB.

### 5. Run the restore

Set DATABASE_URL once on the shell so the credentials never enter
your shell history:

```bash
export DATABASE_URL='postgres://user:pass@host:5432/dbname'
```

Then run the command from step 2:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$DATABASE_URL" \
  /backups/<backup-id>.dump
```

**What each flag does:**
- `--clean` — drops existing objects first. Without it, restore appends and you get duplicate-key errors.
- `--if-exists` — silences "object doesn't exist" errors during the drop pass. Safe.
- `--no-owner` — restores under the current user instead of the dump's original owner. Required when restoring to a different user.
- `--no-privileges` — skips GRANT statements. Privileges should be set by your deployment, not by the dump.

Expected output: a series of progress lines, one per table. The
process should complete in under a minute for typical school-sized
data (hundreds of MB).

If `pg_restore` exits non-zero, **DO NOT START THE APP**. Capture
the full output, escalate to a developer.

### 6. Apply migrations (always)

After ANY restore, sync the schema in case the dump was older than
the deployed code:

```bash
cd /opt/scholaris/backend
npx prisma migrate deploy
```

Expected output: "All migrations have been successfully applied."
or "No pending migrations to apply."

### 7. Smoke-verify

Before opening to traffic, sanity-check the data is there:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS schools FROM schools;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS users FROM users;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS students FROM students;"
psql "$DATABASE_URL" -c "SELECT MAX(\"createdAt\") AS latest_payment FROM payments;"
```

Compare to the numbers you'd expect from the backup window. If
counts are dramatically off, the restore landed on the wrong DB
or the wrong dump — **STOP**.

### 8. Start the application

```bash
sudo systemctl start scholaris
# or
docker compose start backend
# or
pm2 start scholaris
```

Tail the logs and watch for the startup diagnostics summary:

```
[Startup] Startup diagnostics OK — env=ok · database=ok · schema=ok(N critical columns present) · jobs.table=ok · ...
```

If `schema=warn` or `database=fail` appears, the restore left the DB
in an inconsistent state. **STOP** the app, escalate.

### 9. Post-restore verification

Open `/platform/operations` and confirm:
- [ ] Active schools count looks right
- [ ] Recent payments are present (filter by today's date)
- [ ] Notification queue is reasonable (<100 PENDING)
- [ ] No CRITICAL incidents broadcast since restore

Open `/platform/health`:
- [ ] DB probe healthy
- [ ] Subsystem grid all green/yellow (no red)

Open the school side as a SUPER_ADMIN impersonating a real tenant:
- [ ] Dashboard loads
- [ ] Students list loads
- [ ] Today's attendance is there (or empty if today's data wasn't backed up — that's expected)

---

## Rollback

If the restore caused problems and you need to revert to the
**previous** state:

1. The CURRENT-state backup you took in pre-flight step 0 is your
   rollback artifact. Find its backup id.
2. Repeat the procedure with that id as the source.
3. The same `pg_restore --clean` will drop the just-restored data
   and replace it with your CURRENT-state snapshot.

If you DIDN'T take a pre-restore backup (you skipped pre-flight):
contact a developer immediately. `pg_restore --clean` is destructive
and there's no in-DB undo.

---

## Recovery checklist (post-incident)

After any production restore, fill out:

- [ ] Date + time of restore
- [ ] Backup id used (source)
- [ ] Backup id of the pre-restore snapshot (for audit)
- [ ] What problem prompted the restore
- [ ] What the verification queries returned (counts)
- [ ] Whether `prisma migrate deploy` reported any pending migrations
- [ ] Whether the application started cleanly
- [ ] When traffic was reopened
- [ ] Operator name + signature

Store this as an audit record. Real customers will ask for proof
that restores have been tested.

---

## What this procedure does NOT cover

- **Per-tenant restore** — there's no way to restore a single school
  from a full backup with `pg_restore`. Per-tenant restore needs
  application-level export/import, which is a separate (future)
  feature.
- **Point-in-time recovery (PITR)** — needs WAL archiving, which
  isn't enabled in this deployment yet. The current backups are
  full snapshots; recovery resolution is "the time of the most
  recent successful backup."
- **Cross-region restore** — for now, backups + restores happen on
  the same host. Off-host backup shipping is a deployment-level
  concern (rsync to S3, etc.) outside this runbook.

If you need any of those, escalate to a developer + treat the
procedure as not yet field-validated.

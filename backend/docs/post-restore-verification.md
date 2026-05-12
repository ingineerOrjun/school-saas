# Post-Restore Verification Checklist

_Last updated: 2026-07-16 — Phase PLATFORM STABILIZATION Part 4._

Run through this checklist after every database restore — full
disaster recovery (see `disaster-recovery.md`) or a single-tenant
roll-back. The goal is to confirm that the restored database is
**operationally valid** before re-opening user traffic.

Every check below is **read-only**. Nothing here modifies data.

## Step 1 — Application smoke test (≤ 5 min)

Log in as the seed admin account (`admin@example.com` /
`Admin123!` in the default dev seed; the real password lives in your
secrets store). Verify:

- [ ] Login succeeds — no infinite spinner, no 500.
- [ ] Sidebar nav renders with the expected modules.
- [ ] `/dashboard` loads with non-empty counts (students, classes,
      sessions, exams).
- [ ] `/students` shows the roster with the expected row count.
- [ ] `/exams` lists at least one exam if any existed pre-incident.

A blank dashboard usually indicates either a restored-to-wrong-DB
situation or a cache fingerprint mismatch — neither is good, both
require investigation before re-opening traffic.

## Step 2 — System Health (Settings → System Health)

The admin-only page exposes the two server-side health surfaces in
one click. Confirm:

- [ ] **Backups card** — `Storage` matches the configured provider;
      `Last attempt status` is the expected (`SUCCEEDED` for the most
      recent run).
- [ ] **Data integrity card** — `Clean` chip is green, or the only
      findings are informational (e.g. `PROMOTION_MISSING_LINK` for
      legacy rows pre-dating the current schema).

Any **error**-severity finding here is a blocker. Common ones to
look for:

| Code | What it means | Action |
| --- | --- | --- |
| `STUDENT_DUPLICATE_REGNO` | The unique index was disabled during the dump | Re-apply migrations, then re-restore |
| `MULTIPLE_ACTIVE_SESSIONS` | Partial unique index was lost in the dump | Re-apply migrations |
| `NO_ACTIVE_SESSION` | Session table empty | Operator may need to re-import sessions |

## Step 3 — Tenant smoke test

Pick **one tenant** (a representative school) and verify:

- [ ] Their dashboard renders.
- [ ] Their student count matches the pre-incident number (or, if
      restoring from an older backup, makes sense for that date).
- [ ] At least one student detail page opens.
- [ ] At least one exam opens; if it had marks, they render.
- [ ] At least one payment receipt prints (cashier role).

This is the smallest end-to-end test that exercises the FK chain
(student → result → exam → session → school).

## Step 4 — Authentication state

- [ ] Force-logout-all has NOT inadvertently been triggered by
      the restore (would happen if `tokensValidAfter` columns
      contain post-restore timestamps).
- [ ] Re-login as a non-admin account works.
- [ ] Existing tokens issued before the restore are rejected (since
      JWT signing keys are environment-scoped — if the restore is
      a same-region cutover, tokens should still validate).

If a wide force-logout happened, communicate it to users; don't
silently log them out without a banner.

## Step 5 — Audit + activity trail

- [ ] `/audit/recent` (the school-side feed) shows entries up to
      the moment of the backup, with no impossible gaps.
- [ ] `/platform/audit` (SUPER_ADMIN) shows the same plus cross-
      tenant events.
- [ ] The PROMOTION_PREVIEWED / EXECUTED rows for the most recent
      year are intact (these are the highest-value audit rows).

## Step 6 — Backups + scheduler

- [ ] Trigger an immediate on-demand backup from
      `/platform/operations/backups/run`. Verify it `SUCCEEDED`.
- [ ] Confirm the scheduled cron (default 03:00 UTC daily) is still
      registered — `BackupService.runScheduled` should fire on the
      next cycle.
- [ ] If the restore was from a backup taken in a different
      timezone, double-check the next scheduled-run timestamp.

## Step 7 — Re-open traffic

Only after **every box above is checked**:

1. Lift maintenance mode (if you set one).
2. Post a one-line operator-log entry: restoration timestamp,
      backup runId restored, verification owner.
3. Watch the next 30 minutes of `/platform/operations` for any
      surge of 5xx, queue backlogs, or audit gaps. Hard-revert
      to maintenance if any appear.

## Failure escape hatches

If a checklist step fails:

1. **Stop**. Don't proceed to traffic.
2. Capture the failing screen + the integrity report JSON.
3. Decide whether to retry the restore from a different backup
   artifact, or restore-from-snapshot at the storage layer.
4. Document the failure in the post-mortem; expected-vs-actual
   matters for the next phase of operational hardening.

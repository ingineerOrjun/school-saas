# Operator Failure Scenarios

_Last updated: 2026-07-19 — Phase RELIABILITY-II Part 8._
_Audience: school admins + the engineers writing the UI copy they read._

This is the operator-facing catalogue of every high-risk failure the
platform can produce, the exact message they should see, and what
they should do next. Engineers writing new error paths must follow
this list. Operators reading this doc can understand what each
message means before it happens.

Every scenario reports:
- **What the operator sees** (the toast / banner / dialog copy).
- **What happened underneath** (the technical cause).
- **Why this happens** (the legitimate operator path that triggers it).
- **What to do next** (the concrete remediation).

---

## 1. "Student is archived. Restore it before editing."

- **What underneath**: HTTP 409 from a `PATCH /students/:id` against
  a row with `archivedAt` set.
- **Why**: Another admin (or this admin in a previous session)
  archived the student — typically because they transferred to a
  different school.
- **What to do**: Open the **Archived** tab on the Students page.
  Find the student. Click Restore. The PATCH retries automatically.

## 2. "This exam is locked. Marks cannot be edited until an admin unlocks it."

- **What underneath**: HTTP 423 LOCKED from any result-write path
  (single save, bulk save, grid save, publish).
- **Why**: An admin published the exam — locking it freezes the
  marksheet so it can be safely shared with parents.
- **What to do**: An admin opens the exam's lock toggle in Settings,
  unlocks it briefly, makes the correction, then locks again. Each
  lock/unlock is audited.

## 3. "No active academic session. Create or activate one before writing."

- **What underneath**: HTTP 409 from any write path that requires an
  active session (new exam, attendance, marks).
- **Why**: The previous session ended and a new one hasn't been
  promoted yet.
- **What to do**: Go to Settings → Sessions. Either create + activate
  the next session, or activate an existing draft session.

## 4. "Session ended on {date}. Promote to the next session before writing."

- **What underneath**: HTTP 409 from a write whose target session
  has `endDate < now()`.
- **Why**: The fiscal year ended; the operator is trying to backdate
  a write into a closed period.
- **What to do**: Run the promotion preview from Settings → Promotion.
  After the new session activates, retry the original write.

## 5. "{N} students cannot be promoted: {reasons}. Resolve blockers and re-run preview."

- **What underneath**: HTTP 422 from `POST /promotion/run` after
  preview surfaced blockers.
- **Why**: At least one student is archived, has unpublished marks,
  or maps to a class that doesn't exist in the next session.
- **What to do**: Open the preview report. For each blocker:
  - Archived → Restore.
  - Unpublished → Publish (or explicitly mark as Held Back).
  - Missing destination class → Create the class in the next session.

## 6. "That symbol number is already assigned to another student in this school."

- **What underneath**: HTTP 409 from create/update on a `students`
  row whose `symbolNumber` collides with an existing one in the same
  school.
- **Why**: Two operators (or one operator across browser tabs)
  assigned the same Symbol No. to different students.
- **What to do**: Pick a different symbol number. The system can't
  auto-resolve which student "owns" the number — the operator must
  decide.

## 7. "A registration number collided during commit. Please retry."

- **What underneath**: HTTP 500 surfaced from a bulk import; the
  registration-number service exhausted its retry budget on P2002.
- **Why**: Two simultaneous bulk imports tried to claim the same
  next-serial slot. Very rare on small schools; observable on large
  imports during peak admission season.
- **What to do**: Wait 5 seconds. Re-submit the failed batch. The
  retry budget will likely succeed on the second run.

## 8. "Cannot delete '{session name}' while it is the active session."

- **What underneath**: HTTP 409 from `DELETE /sessions/:id` against
  a row with `isActive: true`.
- **Why**: The operator tried to delete the current academic year.
- **What to do**: First activate a different session (Settings →
  Sessions → set another active). Then retry the delete.

## 9. "Cannot delete '{session}': it has {N} promotion history rows."

- **What underneath**: HTTP 409 from `DELETE /sessions/:id` against
  a session with linked `student_academic_records`.
- **Why**: Promotion history is anchored to its source session;
  deleting the session would orphan the audit trail.
- **What to do**: Don't delete the session. The data isn't large
  enough to be worth deleting. If absolutely necessary, archive the
  session via the operator-tier admin tool (see
  `disaster-recovery.md`).

## 10. "Retries exhausted. Please wait a moment and try again."

- **What underneath**: HTTP 500 from a `txWithRetry` callback that
  hit `maxAttempts` × P2034. Surfaces in the operator log; the
  audit feed records a `TRANSACTION_EXHAUSTED` row with the label.
- **Why**: Real database contention — two large operations
  (promotion + bulk import) ran simultaneously and serialization
  conflicts didn't resolve within 3 retries.
- **What to do**: Wait 10-30 seconds. The contention typically
  clears. If it repeats, the operator should report to platform
  operations — `RequestPressurePanel` + the tx-telemetry counters
  show which label is hot.

## 11. "Backup is stale (last successful: {hours} hours ago)."

- **What underneath**: System Health page banner; computed from
  `BackupStatusService.getHealth` when `isFresh` is false.
- **Why**: The scheduled cron failed, didn't run, or the
  `BACKUP_AUTOSTART=false` toggle is set.
- **What to do**:
  - Trigger an immediate on-demand backup from
    `/platform/operations/backups/run`.
  - Investigate why the scheduled run didn't fire (operator log on
    the host).
  - DO NOT proceed with risky operations (promotion, bulk archive)
    while the backup is stale.

## 12. "Integrity check found errors."

- **What underneath**: System Health → Data integrity card showing
  a red chip with non-zero `counts.errors`.
- **Why**: The most-likely cause is `MULTIPLE_ACTIVE_SESSIONS`
  (partial unique index failed) or `STUDENT_DUPLICATE_REGNO` (the
  unique index was disabled during a migration).
- **What to do**: Don't try to fix it from the UI. Take a fresh
  backup. Then escalate to platform operations — the schema
  invariant is broken and needs SUPER_ADMIN intervention.

## 13. "Sync failed. Will retry on next online window."

- **What underneath**: Frontend sync engine reports a non-success
  outcome. The toast surfaces from `StatusBadges.tsx FailedSyncBadge`.
- **Why**: A queued action failed to commit — typically a transient
  network problem or a server-side validation that surfaced late
  (e.g. archived student between save + sync).
- **What to do**: Open the sync queue, inspect the failure reason
  per row. Most reasons are operator-actionable (e.g. "Student is
  archived — Restore first" → restore, then retry sync).

## 14. "Slow down — too many requests."

- **What underneath**: HTTP 429 from the global throttler.
- **Why**: A loop fired (intentional or accidental), exceeding the
  per-user request budget for the current minute. Common cause:
  the user has multiple tabs polling the same endpoint.
- **What to do**: Close extra tabs. Wait 60 seconds. If it
  persists, the dev `RequestPressurePanel` shows which endpoint is
  hot.

## 15. "Your session has expired. Please log in again."

- **What underneath**: The session-watchdog detected the JWT `exp`
  claim passed; the api layer redirected to /login on the next 401.
- **Why**: The operator left the tab open longer than the JWT
  lifetime.
- **What to do**: Log in again. In-flight optimistic state may be
  lost — review the audit feed for the last few minutes to confirm.

---

## Patterns we forbid for failure copy

- **"Operation failed"** with no other context. Always say what
  operation, why, what to do.
- **Generic 500 with no remediation** for predictable error classes
  (P2034 → retry guidance; P2002 → which constraint; archived →
  restore prompt).
- **Silent retries that mask real contention**. Telemetry counters
  must move; the operator must be able to see retry-exhaustion in
  the audit log.
- **Inconsistent terminology**: archive, hidden, deactivate,
  removed — pick ONE. We use **archive** and **restore**, full stop.

## How to add a new failure scenario to this list

1. Add a numbered entry below the existing ones (don't renumber).
2. Use the same "what / why / what to do" shape.
3. Reference the exact error code (HTTP status + Prisma code if
   applicable).
4. If the message is a stable copy contract, update the
   `FAILURE_HANDLING_GUIDELINES.md` "remediation index" table.

## Reviewing UI copy against this list

Every PR that adds a new throw / error response / toast needs the
reviewer to verify the message exists in this list. If it doesn't,
either the message needs to change to match an existing entry, or
this list needs a new entry. No new failure surface ships without
operator-facing copy.

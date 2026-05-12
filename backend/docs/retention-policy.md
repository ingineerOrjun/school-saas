# Data Retention Policy

_Last updated: 2026-07-14 — Phase DATA LIFECYCLE Part 7._

This document defines what Scholaris does — and does NOT do — with each
kind of record after an operator presses "Delete," after a school
unsubscribes, and over time. The policy is shaped by three goals:

1. **No silent data loss.** Operator-initiated removal of a high-risk
   entity (a student, an exam) must be reversible. Hard-delete is
   reserved for genuinely throwaway state.
2. **Audit-ready.** Every state-changing action that the platform
   cares about is captured in `platform_audit_events`. Audit rows
   themselves are append-only; nothing in this system overwrites them.
3. **Cross-tenant safety.** Retention is per-school. A row that
   belongs to School A is never moved into a multi-tenant retention
   bucket; queries are tenant-scoped end-to-end.

## 1. Entity classification

| Entity | Risk | Delete behavior | Where the history lives |
| --- | --- | --- | --- |
| `Student` | **HIGH** | Soft archive (`archivedAt`) | `attendance`, `results`, `payments` rows survive |
| `Exam` | **HIGH** | Soft archive (`archivedAt`) | `results`, `result_ledger` rows survive |
| `Result` | medium | Versioned via `ResultLedger` history | Every change recorded; never hard-deleted |
| `Payment` | medium | Soft void (`voidedAt`) | `Payment.amount` stays for audit |
| `Attendance` | medium | Overwrites recorded in `attendance_audits` | Last-write-wins on the row, full history in audit |
| `Class` / `Section` | low | Hard delete IF empty | FK constraints prevent delete-with-rows |
| `User` (staff/teacher) | medium | Soft suspend (`suspendedAt`) | Account remains, JWT rejects |
| `Subject` (per-exam) | low | Hard delete | Cascade clears related result rows |
| `Notification` | low | Hard delete after read + 30 days | TTL job (future phase) |
| `PlatformAuditEvent` | n/a (append-only) | Never deleted | Source of truth for every action |

"HIGH" means: hard-delete would erase audit-relevant or
finance-relevant history that downstream parties (parents, principals,
auditors, future-you) need. These entities cannot be hard-deleted
through the public API. The `DELETE /students/:id` and
`DELETE /exams/:id` endpoints remain for back-compat but route through
the archive flow internally — see `StudentService.remove()` and
`ExamService.remove()`.

## 2. The archive model

For HIGH-risk entities (Student + Exam) the schema carries three new
columns:

- `archivedAt   DateTime?` — null when active, set when soft-deleted.
- `archivedById String?`   — the User who pressed Archive. FK SetNull
  so deactivating an admin doesn't bubble the constraint.
- `archiveReason String?`  — optional, 500-char free-text shown back
  in the audit trail + the row's `ArchivedBadge` tooltip.

Default-list behavior:

- Every service-layer list call filters `archivedAt: null` by default.
- An opt-in `archived: true | "all"` flag flips that.
- Two new endpoints per entity: `POST /:id/archive` and
  `POST /:id/restore`. Both are ADMIN-only and idempotent.

Edit behavior:

- `update()` rejects archived rows with **409 Conflict**.
- `ExamService.assertEditable()` rejects archived exams **before** it
  checks the lock flag, so every marks-write path stops on archived.

Audit emission (in `platform_audit_events`):

- `STUDENT_ARCHIVED`, `STUDENT_RESTORED`,
  `EXAM_ARCHIVED`, `EXAM_RESTORED`.
- Each row carries explicit `schoolId` so the school-side
  `/audit/recent` feed surfaces it.

## 3. Operator-visible promises

When an admin clicks Archive on a high-risk entity, we promise that:

1. The record stops showing in default rosters, pickers, dropdowns,
   and reports — but is reachable via the **Archived** tab.
2. Cascading rows (Result, Attendance, Payment) remain intact and
   queryable. Past receipts, marksheets, and attendance reports still
   render correctly.
3. The action is reversible at any time, by any ADMIN, via the
   **Restore** affordance. There is no automatic auto-purge.
4. The action is logged with the actor, timestamp, optional reason,
   and IP + user-agent.

When an admin clicks Restore, we promise that:

1. The record becomes visible + editable again immediately.
2. No data is lost or duplicated in the process.
3. The restore is logged with the actor and timestamp.

## 4. What we explicitly DON'T do (yet)

- **No retention timer.** Archived rows live indefinitely. We do not
  auto-purge after N days. A future phase may introduce a tenant-
  configurable purge window with a corresponding confirmation flow.
- **No bulk archive.** Each archive is single-row through the API.
  Bulk operations are a future phase and will reuse the same
  endpoint with stricter audit fanout.
- **No anonymization.** Archive hides; it does not redact. The
  archived row's PII is unchanged. A future "Right-to-be-forgotten"
  workflow will be a separate code path; see Part 8 of the DATA
  LIFECYCLE phase.

## 5. Subscription lifecycle (tenant-level)

When a school's subscription lapses:

- The tenant remains in the database. Login is blocked at the auth
  layer (`SchoolStatus.SUSPENDED`).
- After 90 days suspended, a manual SUPER_ADMIN action moves the
  tenant to `ARCHIVED` — its data stays in the database but every
  endpoint returns 410 GONE.
- Hard-delete of a tenant requires a written request + a manual
  SUPER_ADMIN dry-run + confirmation. Tracked outside the product UI.

This subscription-level retention is independent of the per-entity
archive model above; an active school's archived students still
follow the rules in §2-3, and a suspended school's active students
are read-only by virtue of the tenant status rather than the row
flags.

## 6. Backup + restore

- A nightly Postgres dump runs to encrypted offsite storage (managed
  outside this codebase). 30-day rolling window.
- Backups capture the FULL database including archived rows; restoring
  from a backup brings everything back, including any rows that were
  archived after that backup was taken.
- A school-level "Export my data" affordance is a future phase
  (Part 6 of DATA LIFECYCLE). Operators can already download
  exam-level + payment-level reports today.

## 7. Audit retention

`platform_audit_events` rows are **append-only**. There is no
delete path. They survive entity hard-deletes, tenant archives, and
schema migrations. The table is partitioned by month at the storage
layer (future phase) but the application sees a single logical table.

A future Phase 9 will add a tenant-facing audit export so school
admins can take their compliance history with them if they leave.

## 8. Operator handoff cheat-sheet

| Want to … | Do this | Notes |
| --- | --- | --- |
| Hide a student temporarily | Archive | Reversible. Logged. |
| Permanently delete a student | _Not supported._ | File a ticket. |
| Hide an exam after publication | Archive | Marks-edit auto-rejects. |
| Recover a deleted exam | Restore (Archived tab) | Reversible. |
| Trace who hid a record | Open `/audit/recent`, filter on `*_ARCHIVED` | Includes actor IP + user-agent. |
| Wipe a tenant entirely | SUPER_ADMIN dry-run | Written request required. |

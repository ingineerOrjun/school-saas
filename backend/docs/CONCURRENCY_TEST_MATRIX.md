# Concurrency Test Matrix

_Last updated: 2026-07-21 — Phase RELIABILITY-III Part 8._
_Audience: anyone reviewing or extending the integration suite._

The integration suite proves 19 concurrency invariants across 5
spec files. This is the master matrix — each row maps an invariant
to its enforcement point in the source code, the integration test
that proves it, and (where applicable) the unit-test fallback that
runs without Docker.

## Reading the matrix

- **Invariant** — the concrete property the platform promises.
- **Enforcement** — where the rule actually lives (schema index,
  service guard, or both).
- **Integration proof** — the `*.integration-spec.ts` case that
  exercises the race.
- **Unit fallback** — the unit test that covers the shape on a
  Docker-less host. Some rows have no unit fallback because the
  invariant only manifests under real concurrency.

## 1 — School identity

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| Unique `schoolCode` across tenants | Unique index `schoolCode` in `school` | `concurrency.integration-spec.ts` → `rejects parallel school creates with the same schoolCode` | — (P2002 mapping covered in `auth.service.spec.ts`) |
| Unique school `slug` | Unique index `slug` in `school` | — | — |

## 2 — Academic sessions

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| Exactly one ACTIVE session per school | Partial unique index `(schoolId)` WHERE `isActive = true` + `setActive` demote-first txn | `concurrency.integration-spec.ts` → `only one active session survives parallel activate` | — |
| Can't delete ACTIVE session | `AcademicSessionService.remove` 409 | — | covered indirectly in session.service.spec.ts |
| Can't delete session with promotion history | `AcademicSessionService.remove` 409 | — | — |

## 3 — Student identity

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| Unique `(schoolId, registrationNumber)` | Unique index | `concurrency.integration-spec.ts` → `rejects parallel student creation with the same registrationNumber` | — (P2002 mapping in student.service.spec.ts) |
| Unique `(schoolId, symbolNumber)` | Unique index | — | `student-archive.service.spec.ts` (translateUniqueViolation) |

## 4 — Archive lifecycle

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| Archived student excluded from default list | `StudentService.findAll` filter | `archive-lifecycle.integration-spec.ts` → `archived student disappears from default filter but is still readable by id` | `student-archive.service.spec.ts` → `findAll archived filter defaults` |
| Restore clears archive triplet | `StudentService.restore` | `archive-lifecycle.integration-spec.ts` → `restoring clears archive triplet` | `student-archive.service.spec.ts` → `restore clears archive triplet and emits STUDENT_RESTORED` |
| Archive vs restore race coherent | Single-row UPDATE atomicity | `archive-lifecycle.integration-spec.ts` → `parallel archive + restore: end state is deterministic` | — |
| Archived student rejects update with 409 | `StudentService.update` precheck | — | `student-archive.service.spec.ts` → `throws ConflictException with restore hint` |
| Archived student's payments survive | Schema FK on Payment.studentId is Cascade-DELETE only; archive is soft | `financial-race.integration-spec.ts` → `archiving a student preserves their payment receipts` | — |

## 5 — Promotion

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| Can't double-promote same student in same session | Unique index `(studentId, sessionId)` on `student_academic_records` | `promotion-race.integration-spec.ts` → `parallel promotion runs against the same student yield exactly one snapshot` | — |
| Preview is read-only | `PromotionPreviewService` design — no writes | `promotion-race.integration-spec.ts` → `preview-shaped read does not write any rows` | — |
| Archived students excluded from preview candidates | `archivedAt: null` filter | `promotion-race.integration-spec.ts` → `archived students are excluded from default promotion candidate list` | — |
| Deleted session: FK blocks orphan snapshot | FK constraint `student_academic_records.sessionId → academic_sessions.id` | `promotion-race.integration-spec.ts` → `promoting into a deleted session surfaces an FK error` | — |

## 6 — Marks lock + archive

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| Locked exam: in-process guard prevents marks-write | `ExamService.assertEditable` 423 | `marks-lock-race.integration-spec.ts` → `locked exam: in-process guard rejects bulk-save before the DB write` | unit tests on `assertEditable` |
| Archived exam: in-process guard prevents marks-write | `ExamService.assertEditable` 409 | `marks-lock-race.integration-spec.ts` → `archived exam: assertEditable equivalent rejects mark writes` | unit tests on `assertEditable` |
| Parallel lock + unlock yields coherent state | Single-row UPDATE atomicity | `marks-lock-race.integration-spec.ts` → `parallel lock + unlock yields one final state, no partial corruption` | — |
| Bulk write + lock toggle: no partial corruption | Per-row insert atomicity | `marks-lock-race.integration-spec.ts` → `bulk write + lock toggle: any written results pair with one consistent exam state` | — |

## 7 — Financial integrity

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| At most one refund per source payment | Unique index `refundOfPaymentId` | `financial-race.integration-spec.ts` → `rejects parallel refunds against the same source payment` | — |
| Receipts survive student archive | Soft-delete pattern; FK is Cascade only on hard-delete | `financial-race.integration-spec.ts` → `archiving a student preserves their payment receipts` | — |
| Receipts survive student restore | Same | `financial-race.integration-spec.ts` → `restoring a previously-archived student returns the payment history intact` | — |
| Status flip is deterministic | Single-row UPDATE atomicity | `financial-race.integration-spec.ts` → `parallel status flips end on a well-defined value, never partial` | — |

## 8 — Cross-cutting (txWithRetry)

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| P2034 retries automatically | `txWithRetry` | `concurrency.integration-spec.ts` → `txWithRetry telemetry counts attempts and retries under contention` | `tx-retry.spec.ts` |
| P2002 does NOT retry | `isTransientPrismaError` filter | — | `tx-retry.spec.ts` |
| Telemetry counters move under contention | `tx-telemetry.ts` + `tx-rolling-window.ts` | `concurrency.integration-spec.ts` | `tx-telemetry.spec.ts`, `tx-rolling-window.spec.ts` |
| Audit emit failure never rolls back the mutation | Service pattern — emit AFTER transaction | — | `auth.service.spec.ts` |

## 9 — Cross-tenant isolation

| Invariant | Enforcement | Integration proof | Unit fallback |
| --- | --- | --- | --- |
| Cross-tenant id returns 404, never 403 | `assert-school-scope.ts` | — | `student-archive.service.spec.ts` |
| Service queries always filter by `schoolId` | service layer | — | `integrity-check.service.spec.ts` → `passes schoolId into every query` |

## How to add a new invariant

1. Name it in plain English at the top of the relevant section.
2. Locate the enforcement point (index, service guard, or both).
3. Add a unit test if the invariant has any pure-logic component.
4. Add an integration test if the invariant only manifests under
   real concurrency or real FK behavior.
5. Update this matrix with the new row.

## Test counts by category

| Section | Integration cases |
| --- | --- |
| 1 — School identity | 1 |
| 2 — Academic sessions | 1 |
| 3 — Student identity | 1 |
| 4 — Archive lifecycle | 3 (+ 1 financial cross-link) |
| 5 — Promotion | 4 |
| 6 — Marks lock + archive | 4 |
| 7 — Financial integrity | 3 (+ 1 status-flip) |
| 8 — Cross-cutting (txWithRetry) | 1 |
| 9 — Cross-tenant isolation | 0 (unit-only) |
| **Total** | **19** |

Unit-test counts in `TESTING_GUIDELINES.md`. Combined: 213 unit
tests + 19 integration tests (gated on Docker).

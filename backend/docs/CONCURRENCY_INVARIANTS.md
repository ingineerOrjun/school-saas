# Concurrency Invariants

_Last updated: 2026-07-19 — Phase RELIABILITY-II Part 8._
_Audience: PR reviewers; the next contributor adding concurrency-sensitive code._

This is the list of invariants we promise across operator races.
For each invariant: the rule, where it's enforced, and (where
shipped) which integration test proves it.

## 1. Exactly one ACTIVE academic session per school

- **Rule**: A school has at most one row in `academic_sessions` with
  `isActive = true`. Multiple `setActive` calls executed in parallel
  must NOT produce two active rows.
- **Enforced by**:
  - Partial unique index `(schoolId) WHERE isActive = true` in the
    Prisma schema. The database is the source of truth.
  - `AcademicSessionService.setActive` wraps the demote + flip in
    `txWithRetry`, so a P2034 collision retries instead of leaking a
    500 to the operator.
  - `AcademicSessionService.create` (when `isActive: true`) follows
    the same demote-first pattern.
- **Proven by**: `concurrency.integration-spec.ts` →
  `only one active session survives parallel activate`.

## 2. Unique `schoolCode` across all tenants

- **Rule**: No two `schools` rows share the same `schoolCode`. The
  registration flow generates `SCH-NNNN` and retries on collision.
- **Enforced by**:
  - Unique index `schoolCode` in the Prisma schema.
  - `SchoolCodeService.withRetryOnCollision` retries on P2002 during
    the auto-generation path.
  - `AuthService.registerAdmin` wraps the inner write in
    `txWithRetry`.
- **Proven by**: `concurrency.integration-spec.ts` →
  `rejects parallel school creates with the same schoolCode`.

## 3. Unique registration number per school

- **Rule**: Within a school, no two `students` rows share the same
  non-null `registrationNumber`. Sequential serials are issued by
  `StudentRegistrationNumberService.acquireRegistrationNumber`,
  which retries on collision.
- **Enforced by**:
  - Unique index `(schoolId, registrationNumber)` in the Prisma schema.
  - `StudentService.create` calls the registration-number service
    inside its txWithRetry; on P2002 the service retries up to N
    times before surfacing the error.
- **Proven by**: `concurrency.integration-spec.ts` →
  `rejects parallel student creation with the same registrationNumber`.

## 4. Unique symbol number per school

- **Rule**: Within a school, no two `students` rows share the same
  non-null `symbolNumber`. Operators supply this field; collisions
  are surfaced as 409 with copy that names the conflicting student.
- **Enforced by**:
  - Unique index `(schoolId, symbolNumber)` in the Prisma schema.
  - `StudentService.translateUniqueViolation` maps P2002 → 409.
- **Proven by**: unit tests on `StudentService.translateUniqueViolation`;
  integration coverage deferred to RELIABILITY-III.

## 5. Archived students stay queryable but excluded by default

- **Rule**: `archivedAt: null` is the default filter on every list /
  picker / dropdown. Direct-by-id reads ALWAYS return the row so
  Restore + audit-trail flows work.
- **Enforced by**:
  - `StudentService.findAll` filter logic + the `qk.students` cache
    key tracking `archived` as a dimension.
  - The `archivedAt` column lives on the row; FK joins from
    `attendance` / `results` / `payments` are NOT cascade-delete,
    so historical rows survive an archive.
- **Proven by**: `archive-lifecycle.integration-spec.ts` →
  `archived student disappears from default filter but is still readable by id`.

## 6. Archive / restore round-trip is reversible + idempotent

- **Rule**: Restore clears the archive triplet exactly. Re-archiving
  an archived row is a no-op (no audit re-emit). Re-restoring a
  non-archived row is a no-op.
- **Enforced by**: `StudentService.archive` / `restore` short-circuit
  on the existing state inside `ensureInSchool`.
- **Proven by**:
  - Unit: `student-archive.service.spec.ts` (idempotency cases).
  - Integration: `archive-lifecycle.integration-spec.ts` →
    `restoring clears archive triplet`.

## 7. No partial-write corruption on archive ↔ restore race

- **Rule**: A simultaneous archive + restore on the same row commits
  one of {archived, not-archived}. The intermediate state of
  "archivedAt set but archiveReason null" must never persist after
  both writes complete.
- **Enforced by**: Each operation is a single-row UPDATE in Postgres,
  which is atomic per statement. The schema doesn't permit a half-
  applied row.
- **Proven by**: `archive-lifecycle.integration-spec.ts` →
  `parallel archive + restore: end state is deterministic`.

## 8. Archived rows reject mutations with 409

- **Rule**: `update()` on an archived student / exam returns 409
  Conflict with copy that says "Restore before editing" — never a
  silent partial update.
- **Enforced by**: `StudentService.update` checks `existing.archivedAt`
  before calling `prisma.student.update`. Same in
  `ExamService.update` + `ExamService.assertEditable`.
- **Proven by**: `student-archive.service.spec.ts` →
  `throws ConflictException with restore hint`.

## 9. Locked exams reject every marks-write path

- **Rule**: `assertEditable` is called by every Result write path
  (single-save, bulk-save, grid-save, publish). A locked exam
  surfaces 423 LOCKED with the lockedAt timestamp.
- **Enforced by**: `ExamService.assertEditable` is the single
  chokepoint. Bypassing it requires writing a new path that
  doesn't call it — caught by code review.
- **Proven by**: unit tests on `ExamService.assertEditable`;
  integration coverage deferred to RELIABILITY-III.

## 10. txWithRetry never silently swallows non-transient errors

- **Rule**: P2002 (unique violation), P2025 (not found), validation
  exceptions, and unclassified errors all fall through unchanged.
  The helper retries ONLY P2034 and serialization-message-matching
  unknown-request errors.
- **Enforced by**: `isTransientPrismaError` predicate in
  `tx-retry.ts`.
- **Proven by**:
  - Unit: `tx-retry.spec.ts` — multiple "does NOT retry on …" cases.
  - Integration: `concurrency.integration-spec.ts` →
    `txWithRetry telemetry counts attempts and retries under contention`.

## 11. Telemetry is process-local + reset across restarts

- **Rule**: `tx-telemetry.ts` counters are not persisted. They
  represent "what's happening right now," not history. Restart
  clears them.
- **Enforced by**: counters are plain `Map<>` instances in module
  scope.
- **Proven by**: `tx-telemetry.spec.ts` reset behaviour in
  `beforeEach`.

## 12. Audit emits never block a successful mutation

- **Rule**: Audit logging is best-effort. A failure to record a
  `PlatformAuditEvent` row must NOT roll back the underlying write.
- **Enforced by**: `PlatformAuditService.record` is a try/catch
  with no rethrow; it logs internally + returns null.
- **Proven by**: `auth.service.spec.ts` exercises the audit
  swallow-on-error path.

## 13. Cross-tenant access always returns 404, never 403

- **Rule**: A student / exam / payment ID from school B queried by a
  user in school A returns 404 Not Found — never 403. This prevents
  UUID enumeration across tenants.
- **Enforced by**: `common/multi-tenant/assert-school-scope.ts`
  unconditionally throws `NotFoundException`.
- **Proven by**: `student-archive.service.spec.ts` →
  `throws NotFoundException for cross-tenant id`.

## How to prove a new invariant

1. **Name it.** One sentence in this doc.
2. **Find the enforcement point.** A unique index, a service-layer
   check, or both.
3. **Write a unit test for the predicate.** Validates the in-process
   guard.
4. **Write an integration test for the race.** Validates the database
   actually enforces it under real concurrent writes.

If you can't write the integration test (no Docker), capture the
invariant + the unit-test reference and flag it as
"integration-deferred" in the PR. The next contributor with Docker
runs `npm run test:integration` and confirms.

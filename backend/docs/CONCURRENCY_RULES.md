# Concurrency Rules

_Last updated: 2026-07-18 — Phase RELIABILITY Part 8._
_Audience: backend engineers writing or reviewing multi-write code._

This is what we do — and what we don't — to keep concurrent operator
behavior safe in this codebase. Every rule references a concrete file.

## 1. The retry helper is the default

Use `common/db/tx-retry.ts` for **every** callback-form transaction
that does more than one write. Examples in the repo:

- `promotion.service.ts` — `promote-students`
- `academic-session.service.ts` — `create-session`, `activate-session`
- `teaching-assignment.service.ts` — `save-teaching-assignment`
- `notifications/notification.service.ts` — `enqueue-notification`
- `auth.service.ts` — `register-admin`
- `productization/import.service.ts` — `commit-import`

Pattern:

```ts
import { txWithRetry } from '../common/db/tx-retry';

await txWithRetry(
  this.prisma,
  async (tx) => {
    // … multi-step work …
  },
  { label: 'descriptive-stable-label', slowMs: 1500 },
);
```

Rules:

- **`label` is mandatory.** Use a stable, kebab-cased identifier
  (`promote-students`, not `'tx#3'`). Telemetry + slow-tx warnings
  group on this.
- **`slowMs` defaults to 1500.** Override only when the operation is
  legitimately slow (e.g. `commit-import` uses 5000).
- **Don't catch P2034 yourself.** The helper retries it. Catching it
  defeats the helper.
- **Do catch P2002 / business errors INSIDE the callback** if you
  want graceful recovery — see `teaching-assignment.service.ts` for
  the pattern.

## 2. Array-form transactions are NOT migrated automatically

`prisma.$transaction([a, b, c])` (array form) is a different beast
from the callback form. The retry helper only wraps the callback
form. Migrating array-form to callback-form is a **behavior change**
(callback form runs sequentially; array form may parallelize):
review per call site before flipping.

Today's array-form call sites that are intentionally NOT migrated:

- `student.service.ts:bulkCreate` — array form; multi-row import.
  Migration deferred to a follow-up phase that also adds chunking.
- `attendance.service.ts:markAttendanceBulk` — array form; same.
- `result.service.ts` × 3 (publish, bulk-save, grid-save) — array
  form; high-volume marks writes.
- `fees.service.ts:issueRefund` — array form; rare, low risk.
- Read-only paginated `$transaction([findMany, count])` calls in
  `platform-audit.service.ts`, `fees.service.ts`, `session.service.ts`
  — these are read pairs; retry is not useful.

See `STABILIZATION_DEFERRED.md` for the full migration roadmap.

## 3. Where retry is NOT enough — uniqueness contracts

When the schema enforces uniqueness via a partial unique index
(e.g. exactly one active `AcademicSession` per school), retry alone
won't help — two concurrent writes collapse to **one winner** and
**one loser**. The loser must be returned as a clean 409, not a 500.

Pattern in this codebase:

- `academic-session.service.ts` — partial unique index `(schoolId)
  WHERE isActive = true`. The `create` and `setActive` methods both
  catch `P2002` and rethrow as `ConflictException` with copy that
  names the active session.
- `student-registration-number.service.ts` — sequential serial per
  school. The `withRetryOnCollision` wrapper retries up to N times
  before surfacing the error to the caller.

## 4. Never trust frontend-supplied `schoolId`

Every controller derives `schoolId` from the authenticated user:

```ts
@Post()
@Roles(Role.ADMIN)
create(
  @Body() dto: CreateStudentDto,
  @CurrentUser() user: AuthenticatedUser,
) {
  return this.students.create(dto, user.schoolId);
}
```

If a DTO carries a `schoolId` field, ignore it. The dev-warning
helper at `common/multi-tenant/assert-mutable.ts` →
`devWarnIfMismatchedSchoolId` flags this in dev. Production silently
ignores body-supplied schoolId.

## 5. The "snapshot once, mutate many" pattern

When a multi-write transaction needs to derive a key (registration
number, slug, schoolCode) and that key has its own uniqueness
constraint, **generate the key BEFORE entering the transaction** so
a P2002 doesn't half-apply. Reference: `auth.service.ts:registerAdmin`
calls `schoolCodes.withRetryOnCollision` outside the inner
`txWithRetry`.

## 6. Audit emits go OUTSIDE the transaction

The audit row should be the **last** operation in the request flow,
not part of the transaction. Reasons:

- Audit writes can soft-fail (the `PlatformAuditService.record`
  swallows errors). Wrapping them inside the transaction would
  silently roll back the underlying mutation on an audit failure —
  which is the opposite of what we want.
- The audit row needs the **final** state to snapshot; that's only
  knowable after the transaction commits.

Reference: `student.service.ts:archive` runs the `prisma.student
.update` and then calls `this.audit.record` afterwards.

## 7. Idempotency markers

For flag-flip operations (lock / unlock / archive / restore /
publish), check the current state **inside** the transaction and
no-op if already at the target state. Don't re-emit audit either —
operators see a duplicate event that didn't happen.

Reference: `student.service.ts:archive` short-circuits when
`existing.archivedAt` is already set.

## 8. The cross-tenant 404 invariant

A row that belongs to school B but was queried by a user in school A
must return **404 Not Found**, not 403. This prevents UUID enumeration
attacks across tenants. Reference: `common/multi-tenant/assert-school-
scope.ts` always throws `NotFoundException`, never `ForbiddenException`.

## 9. Things we forbid

- **Background mutations that aren't audited.** The job-queue
  workers emit audit rows for every mutating job. New workers must
  follow suit.
- **Catch-and-swallow on Prisma errors.** Every Prisma error must
  either be mapped to a 4xx via `http-exception.filter.ts` or
  rethrown — never swallowed.
- **`prisma.$queryRawUnsafe` without `schoolId` parameter binding.**
  The integrity-check service is the one allowed exception (it
  passes `schoolId` as a bound parameter).
- **Unbounded retries.** The helper caps at 3 attempts. Don't
  override past 5; you're masking a real contention issue.
- **`async () => Promise.all([…])` inside a `$transaction` callback
  with concurrent writes against the same table.** Prisma's
  transaction client serializes, but using `Promise.all` invites
  future-you to assume parallelism.

## 10. PR review checklist for concurrency-sensitive changes

Before merging anything that touches multi-write state:

- [ ] Callback-form `$transaction` is wrapped via `txWithRetry`.
- [ ] The `label` is stable and meaningful.
- [ ] No frontend-supplied `schoolId` is trusted.
- [ ] Audit emit happens AFTER the transaction.
- [ ] Idempotency check is at the top of the operation.
- [ ] At least one concurrency-relevant test is added or referenced.
- [ ] If a uniqueness constraint can fire P2002, the handler maps
      it to 409 with copy that tells the operator what to do.

Tick every box, or write down why one doesn't apply.

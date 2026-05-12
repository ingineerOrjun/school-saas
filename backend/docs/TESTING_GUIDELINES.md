# Testing Guidelines

_Last updated: 2026-07-18 — Phase RELIABILITY Part 8._
_Audience: anyone adding or reviewing tests in this codebase._

These are the rules we follow in this repo. They are not generic best
practices — every rule references a real file you can open.

## 1. Test categories we actually use

We use **Jest** end-to-end. We have three categories of tests today:

1. **Unit tests** (`*.spec.ts` co-located with the file under test) —
   shape-mock the dependencies, assert behavior. Examples:
   `tx-retry.spec.ts`, `student-archive.service.spec.ts`,
   `integrity-check.service.spec.ts`.

2. **Integration-light tests** — wire a real NestJS module with a
   mocked PrismaService. Used where the test wants to exercise
   guards/decorators alongside service logic. Example:
   `auth.service.spec.ts`.

3. **Contract tests for helpers** — same shape as unit tests but the
   target is a pure function (`amountInWords`, retry helpers).
   Example: `common/money/amount-in-words.spec.ts`.

We do **NOT** use:

- Brittle snapshot tests on UI components.
- Real-DB integration tests in this repo. (We've considered a
  `*.integration.spec.ts` opt-in suite; see `STABILIZATION_DEFERRED.md`.)

## 2. What "meaningful assertions" looks like here

Bad:

```ts
expect(result).toBeDefined();
```

Good (from `student-archive.service.spec.ts`):

```ts
expect(prisma.student.update).toHaveBeenCalledWith(
  expect.objectContaining({
    where: { id: 'student-1' },
    data: expect.objectContaining({
      archivedById: actor.userId,
      archiveReason: 'Transferred',
      archivedAt: expect.any(Date),
    }),
  }),
);
```

Rules:

- Assert against the **shape of the side effect** (DB call, audit
  emit, response body) — not against `result is truthy`.
- Use `expect.objectContaining` for partial matches so unrelated
  schema growth doesn't break the test.
- Use `expect.any(Date)` for timestamps you don't want to freeze; use
  a fixed Date for timestamps you do.

## 3. Service unit tests — recommended skeleton

Use `tx-retry.spec.ts` and `student-archive.service.spec.ts` as
templates. The pattern:

```ts
interface MockPrisma {
  student: { findFirst: jest.Mock; update: jest.Mock };
}

function makeMockPrisma(): MockPrisma {
  return { student: { findFirst: jest.fn(), update: jest.fn() } };
}

function makeService(prisma: MockPrisma) {
  const audit = { record: jest.fn().mockResolvedValue('audit-row-id') };
  const svc = new StudentService(
    prisma as unknown as PrismaService,
    {} as StudentRegistrationNumberService,
    audit as unknown as PlatformAuditService,
  );
  return { svc, audit };
}
```

Rules:

- One `makeMockPrisma()` per test file. Define only the shape you
  need. Adding properties later is cheap.
- Service is constructed inside each test (or via `makeService()`)
  so mocks don't leak between cases.
- `audit.record` returns a stub id rather than `undefined` so callers
  that `await this.audit.record(...)` don't fail on unwrapping.

## 4. Tenant isolation tests are non-optional

Every service test that touches a multi-tenant entity (Student, Exam,
Attendance, Result, Payment, AcademicSession) needs at least one case
that asserts the `schoolId` filter survives all the way to the
PrismaService call. Example pattern from
`integrity-check.service.spec.ts`:

```ts
it('passes schoolId into every query', async () => {
  await svc.checkSchool('school-isolated');
  for (const call of prisma.$queryRawUnsafe.mock.calls) {
    expect(call[1]).toBe('school-isolated');
  }
  for (const [args] of prisma.exam.count.mock.calls) {
    expect(args.where.schoolId).toBe('school-isolated');
  }
});
```

If a service has 12 query methods, **at least one** of them needs
this assertion. The rest are protected by code review.

## 5. Audit emission tests are non-optional

Every endpoint that emits a `PlatformAuditAction.*` row needs a test
that verifies:

- The audit `action` matches what the spec calls for.
- The `schoolId` is set explicitly (not implicit via actor).
- The `before` + `after` snapshots are present and JSON-serializable.
- The actor descriptor carries `userId` + `email`.

Example from `student-archive.service.spec.ts`:

```ts
expect(audit.record).toHaveBeenCalledTimes(1);
const auditCall = audit.record.mock.calls[0][0];
expect(auditCall.action).toBe(PlatformAuditAction.STUDENT_ARCHIVED);
expect(auditCall.schoolId).toBe('school-1');
expect(auditCall.actor.userId).toBe(actor.userId);
expect(auditCall.target.type).toBe('Student');
```

Audit emits are how operators reconstruct "what happened" after an
incident. A missed emit is invisible until the incident lands.

## 6. Idempotency tests for archive / restore / lock / unlock

Every "stamp a flag and remember who did it" action needs at minimum
two tests:

1. First call mutates + emits audit.
2. Second call on the same state is a no-op — no row mutation, no
   second audit emit.

Reference: `student-archive.service.spec.ts` has both for archive
and restore. Mirror that shape for any future flag-state action.

## 7. Concurrency claims need real concurrency tests

If a comment or a docstring says "this is atomic" or "race-safe"
or "won't double-write," add a test that fires the operation in
parallel and asserts the invariant.

For services using `txWithRetry`, the contract test already covers
the retry path. For services with their own concurrency claims
(`acquireRegistrationNumber`, `setActive`), each needs a parallel-
fire test.

This is a category we have **gaps** in today — see the deferred-items
report. Adding the missing ones is one of the next-phase priorities.

## 8. Pitfalls to avoid

- **Re-using `findFirst.mockResolvedValueOnce` across multiple
  assertions in the same test.** The second assertion consumes a
  new mock value, and if you only set one, the second call returns
  `undefined`, triggering an unrelated NotFoundException. Either set
  the same mock twice or use `mockResolvedValue` (no `Once`).
- **Asserting on `console.log` output.** Use Jest's `expect(spy)`
  pattern on the actual logger, not stdout.
- **Date-dependent assertions without freezing time.** Use
  `jest.useFakeTimers()` or compare with `expect.any(Date)`.
- **Hardcoding `'admin@school.test'` in three places.** Define a
  shared `actor` constant at the top of the file.

## 9. Adding a new test file

1. Co-locate it next to the source file (`student.service.ts` →
   `student-something.service.spec.ts`).
2. Top-of-file comment block: what's tested, what's NOT tested,
   why. The reader should not have to read 200 lines to understand
   the contract.
3. Use `describe` blocks per method (not per scenario). Nest scenario
   `it()`s inside.
4. Run only your file while iterating:
   ```sh
   npx jest --testPathPatterns="my-new-thing"
   ```
   (Note the `Patterns` plural — Jest deprecated the singular form.)

## 10. The 158 → 195 baseline

Phase RELIABILITY Part 2 added 37 new tests:

| File | Tests | Covers |
| --- | --- | --- |
| `tx-retry.spec.ts` | 16 | Retry semantics, hook contract, error classification |
| `integrity-check.service.spec.ts` | 9 | Clean baseline, duplicate detection, active-session sanity |
| `student-archive.service.spec.ts` | 12 | Archive/restore idempotency, audit emit, ConflictException copy |

Running the full suite should now report **195 passing**. Drops
below that number are regressions and block merge.

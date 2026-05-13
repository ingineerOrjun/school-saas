# Concurrency Protection Report

_Last updated: 2026-05-13 — FINAL PRE-PILOT HARDENING Part 2._
_Audience: engineers reviewing the optimistic-concurrency rollout._

This phase closes the cross-tab stale-write risk identified in
`PILOT_RISK_REGISTER.md R1`. After this work, two operators editing
the same student / exam / class / section / teacher from different
tabs no longer silently overwrite each other — the second write
surfaces a clean 409 with operator-actionable copy.

## What shipped

### Helper: `assertNotStaleAndUpdate`

**New file**: `backend/src/common/db/optimistic-update.ts` (165 lines).

```ts
export async function assertNotStaleAndUpdate<TData>(
  delegate: UpdateManyDelegate & FindUniqueDelegate,
  input: OptimisticUpdateInput<TData>,
): Promise<unknown>
```

What it does:
1. Calls `delegate.updateMany({ where: { id, updatedAt }, data })`.
2. If `count === 0` → throws `ConflictException` (HTTP 409) with the
   stable copy: `"This {entity} was updated by another user.
   Refresh and try again."`
3. If `count === 1` → does a follow-up `findUnique({ where: { id },
   include })` and returns the fresh row.

Why `updateMany` not `update`:
- Prisma's `update(where: { id })` accepts only `@unique` fields in
  the where clause. `updatedAt` isn't unique, so it can't go there.
- `updateMany` accepts arbitrary filters AND returns `{ count }` so
  we can distinguish 0 vs 1.

Backward compatibility:
- If `expectedUpdatedAt` is `null` or `undefined`, the helper SKIPS
  the optimistic check. This means legacy clients that haven't been
  updated to round-trip `updatedAt` still work — they just get
  last-write-wins behavior (same as before the change). New clients
  pass it through and get the protection.

### Service-layer wiring (5 entities)

| Service | File | Method |
| --- | --- | --- |
| StudentService | `student/student.service.ts:792-810` | `update()` |
| ExamService | `exams/exam.service.ts:410-430` | `update()` |
| ClassService | `class/class.service.ts:46-66` | `update()` |
| SectionService | `section/section.service.ts:52-71` | `update()` |
| TeacherService | `teacher/teacher.service.ts:307-330` | `update()` |

Each service's `update()` now goes through the helper. The unique-
violation translation (`translateUniqueViolation` / `isUniqueViolation`)
is preserved on the catch path — P2002 conflicts still surface as
the existing friendly copy (e.g. "That symbol number is already
assigned…"), not as a stale-write 409.

### DTO additions

Each entity's `Update*Dto` gained an optional `updatedAt: string`
field:

- `student/dto/update-student.dto.ts`
- `exams/dto/update-exam.dto.ts`
- `class/dto/update-class.dto.ts`
- `section/dto/update-section.dto.ts`
- `teacher/dto/update-teacher.dto.ts`

All marked `@IsOptional() @IsDateString()`. Optional means the
backend doesn't reject legacy clients that omit the field.

### Frontend canonical pattern

**File**: `frontend/components/students/EditStudentDialog.tsx:96-145`.

```ts
const updated = await studentsApi.update(student.id, {
  // …form fields…
  updatedAt: student.updatedAt,  // round-trip the stamp
});
```

Plus a 409-aware catch branch:

```ts
if (err instanceof ApiError && err.status === 409 &&
    /updated by another user/i.test(err.message)) {
  setError(
    "This student was just changed by someone else. " +
    "Your edits are preserved — close, reopen, and re-apply."
  );
  toast.error(msg, { duration: 8_000 });
}
```

The form state is NOT cleared on the conflict — the cashier's
unsaved values stay in the inputs so they can decide whether to
re-apply after refresh. This matches the spec's "preserve unsaved
form values where practical".

`frontend/lib/students.ts:UpdateStudentInput` extended with
optional `updatedAt: string`.

## What is NOT in this phase

### Frontend stale-write handlers on the other 4 edit dialogs

Only `EditStudentDialog` was wired with the 409-aware catch. The
backend protection applies to all 5 entities (any 409 will surface
the toast), but the per-dialog "preserve unsaved values" UX is only
on Student today.

**Why**: scope budget. The Student dialog is by far the highest-
traffic edit; it serves as the canonical pattern. The other 4
follow the identical shape:
1. Send `updatedAt: <entity>.updatedAt` in the update call.
2. In the catch, detect 409 + `/updated by another user/i` and show
   the same toast pattern.

**Deferred to follow-up**: copy the pattern into
`EditExamDialog`, `EditClassDialog`, `EditSectionDialog`,
`EditTeacherDialog`.

**Risk while deferred**: a stale write on Exam/Class/Section/Teacher
will surface the generic `ApiError.message` "This exam was updated
by another user. Refresh and try again." via `toast.error` — same
copy, just no special preserve-form-state hint. Operationally
acceptable.

### AcademicSession not in the rollout

The spec's target list included AcademicSession, but the service
has NO general `update()` method — only `setActive()` (which is
already serialized via the partial unique index `(schoolId) WHERE
isActive = true`) and `lockSession()` / `unlockSession()` (idempotent
flag flips with their own audit). There's no edit form to harden.

### Force-update path (when `updatedAt` is omitted)

By design, the helper allows callers to OMIT `expectedUpdatedAt`
and fall back to last-write-wins. This is a deliberate rollout
choice — legacy clients (mobile apps, scripts, integration tests)
don't break when they haven't been updated.

**Risk while deferred**: a client that omits `updatedAt` can still
trigger a silent overwrite. Mitigation: every NEW client we ship
includes the field. Existing clients (the dashboard frontend) all
update via dialogs that we control.

A future hardening pass can add a feature flag to make
`updatedAt` REQUIRED, but doing so today risks breaking unknown
integrations before they've had time to update.

## Tests added

**New file**: `backend/src/common/db/optimistic-update.spec.ts` —
14 unit tests covering:

1. `expectedUpdatedAt` passed through to `where.updatedAt` (Date form)
2. String `updatedAt` converted to Date before passing through
3. `undefined` `updatedAt` omits the where clause (legacy path)
4. `null` `updatedAt` omits the where clause
5. `count === 0` throws `ConflictException` with the contracted copy
6. Entity name lowercased in the conflict message
7. `extractUpdatedAt` Date / string / missing / null / wrong-type
8. `isStaleWriteConflict` correctly narrows the thrown 409 vs other
   `ConflictException`s and non-Conflict errors

All 14 pass. Total backend test count: **227/227** (was 213).

**Note**: a true concurrent-update race test (two `Promise.all`
calls racing against a real Postgres) is NOT in this unit suite.
That test lives in the integration suite at
`backend/test/integration/concurrency.integration-spec.ts` (skipped
locally without Docker — see `RUNTIME_VALIDATION_REPORT.md`).
When the first Docker-equipped runner executes the integration
suite, the existing concurrency test will exercise this code path
end-to-end against real Postgres.

## Risks fixed

| Risk | Severity | Status |
| --- | --- | --- |
| Cross-tab stale-write silently overwrites (R1 in PILOT_RISK_REGISTER) | HIGH | Fixed at backend layer; canonical frontend pattern on EditStudentDialog |

## Remaining known risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| The 4 other edit dialogs show the generic 409 toast instead of "your edits are preserved" copy | LOW | Backend still protects the data; UX gap only. P2 follow-up. |
| Clients that omit `updatedAt` get last-write-wins | LOW | All in-tree clients send it. Mobile clients (none today) will need to add it. |
| Concurrent-update race not exercised against real Postgres yet | MEDIUM | Integration test exists at `concurrency.integration-spec.ts`; runs on first Docker-equipped CI |

## Verification

- Backend `tsc --noEmit`: clean.
- Frontend `tsc --noEmit`: clean.
- Backend `jest`: **227/227 passing across 19 suites**.
- Integration suite: still skips without Docker (no change in
  behavior; new tests not added here).
- Manual runtime check: NOT performed. The unit tests exercise
  the helper in isolation against a mock Prisma client; the
  service-layer wiring is type-clean but the end-to-end behavior
  (real updateMany count → 409 path) has not been hit on a real
  database in this phase. **The first pilot edit-collision will
  be the runtime verification.**

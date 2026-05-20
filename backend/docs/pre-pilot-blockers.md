# Pre-pilot blockers

Items that don't block dev/staging today but MUST be resolved before
the first real school onboards. Each entry has:

- **What's broken / missing** — the user-facing or operator-facing
  symptom.
- **Why it's deferred** — what made it acceptable to ship the
  current state, and what makes the deferral safe-for-dev.
- **Acceptance criteria** — concrete signals that the item is closed.
- **Touch points** — files / sessions to look at when picking the
  item up.

## Open

### `Class.level` integer column on the backend

**What's broken / missing.** The frontend determines a class's CDC
eligibility (classes 1-5) by parsing the free-text `Class.name`
field. The parser is a small regex (`/(\d{1,2})/`) in
`frontend/lib/class-level.ts`. It correctly handles the common naming
conventions today:

- `"Class 4"` → 4 ✓
- `"Class 4B"` → 4 ✓ (post-regex-relaxation in Deviation 002 follow-up)
- `"Grade 5"` → 5 ✓
- `"Class 4 — Section A"` → 4 ✓
- `"5अ"` (Devanagari section letter) → 5 ✓

But it has known limits:

- Roman-numeral class names (`"Class IV"`) → `null` (excluded)
- Purely descriptive names (`"Nursery"`, `"KG Upper"`, `"ECE"`) → `null`
- Pathological multi-digit names (`"Class 123"`) → `12` (greedy 2-digit
  match), which the downstream `isCdcEligibleClassLevel` correctly
  treats as ineligible — so no user-facing wrong answer, but the
  parser's behavior is non-obvious in code review.

**Why it's deferred.** The conservative pipeline (null → excluded)
fails closed: a misparsed class never sneaks into the CDC scope as
eligible. Schools using the standard `"Class N"` or `"Class NX"`
naming convention work fine today. Pre-pilot user research will
catch any naming convention we haven't seen yet.

**Acceptance criteria for closing this item.**

1. A `Class.level` `Int` column on the `Class` Prisma model, populated
   from a one-off migration that runs `extractClassLevel(name)` on
   every row + leaves admins a one-tap "fix" affordance in the
   class-edit UI for the `null` cases.
2. The CDC eligibility pipeline in
   `frontend/app/(dashboard)/student-evaluation/page.tsx` +
   `[classSubjectId]/page.tsx` +
   `[classSubjectId]/units/[unitNumber]/outcomes/[outcomeId]/page.tsx`
   reads `a.class?.level` directly instead of calling
   `extractClassLevel(a.class?.name)`.
3. The `frontend/lib/class-level.ts` helpers + their tests stay in
   place as a fallback / legacy-data tool, but no longer on the
   primary read path.

**Touch points.**

- `frontend/lib/class-level.ts` — the parser
- `frontend/lib/__tests__/class-level.test.ts` — pinned behavior
- `backend/prisma/schema.prisma` — needs the new `level Int?` column
- `backend/src/class/` — needs a controller + migration for the
  one-off populate + admin fix UI
- Session reference: Deviation 002 follow-up (regex relaxation), and
  the original 6c-pre report that flagged this.

---

### Teacher delete is still a HARD delete of the underlying User

**What's broken / missing.** `DELETE /teachers/:id` in
`backend/src/teacher/teacher.controller.ts` calls
`TeacherService.remove()`, which resolves the Teacher's `userId` and
then executes `prisma.user.delete({ where: { id: teacher.userId } })`
— a hard delete. The cascade removes the Teacher profile, sessions,
notifications, and any related rows whose FK is `onDelete: Cascade`.
Audit-trail FKs (Subject.createdById, Result.createdById, etc.) are
`onDelete: SetNull`, so historical authorship survives as anonymous
rather than being preserved against the deleted user's id.

This pre-dates Session 6c.1's User soft-delete feature and violates
the new locked design decision: "Soft delete only. No hard deletion
endpoint exists."

**Why it's deferred.** Routing the teacher delete through the new
`UserService.softDelete()` path needs a careful look at:

- The active-teaching-assignment refusal (already in the user
  soft-delete) is the natural gate, but the existing teacher delete
  has its own callers and tests that assume hard-delete semantics.
- The "orphan TEACHER user" cleanup behaviour documented in
  `UserService.list` was added because the OLD `TeacherService.remove`
  deleted Teacher rows without their User; we want to confirm the
  cleanup filter isn't fighting the new path.
- Frontend callers may rely on the immediate disappearance of the
  teacher from listings — soft-delete needs the deletedAt filter
  (which Session 6c.1 added to UserService.list, but not yet to
  TeacherService.findAll).

Deferring keeps Session 6c.1 scope tight and lets the follow-up land
with its own test pass + frontend reconciliation.

**Acceptance criteria for closing this item.**

1. `TeacherService.remove()` calls `UserService.softDelete()` (or the
   same primitive) instead of `prisma.user.delete`. The active-
   assignment refusal applies; the audit emit is `USER_DEACTIVATED`.
2. `TeacherService.findAll` / `findOne` filter out soft-deleted
   teachers by joining `user.deletedAt: null`.
3. Frontend teacher listing + teacher picker confirmed to handle the
   delayed disappearance (soft-delete vs hard-delete) gracefully.
4. The teacher controller's existing tests are updated to reflect
   the new contract (a delete now requires zero active assignments;
   the user row stays in the DB with `deletedAt` set).

**Touch points.**

- `backend/src/teacher/teacher.service.ts:336-366` — the `remove()`
  method
- `backend/src/teacher/teacher.controller.ts` — `@Delete(':id')`
  decorator + HTTP status
- `backend/src/user/user.service.ts` — `softDelete()` to share
- `frontend/app/(dashboard)/teachers/` — listing + picker reconciliation
- Session reference: 6c.1 audit report flagged this; user opted to
  document rather than fold into the same session.

**Priority:** HIGH — must close before the first pilot to satisfy the
locked design decision "soft delete only."

---

## Closed

_(none yet — this file was created during the regex-relaxation
follow-up to Deviation 002. Items move down here when they ship.)_

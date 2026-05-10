# Tenant isolation convention

Every domain query MUST scope by `schoolId`. This doc is the single
source of truth for how to do that, and the spot-check audit results
from Phase α.

## The three patterns

### Pattern 1 — Filter in the WHERE clause (preferred)

```ts
const students = await this.prisma.student.findMany({
  where: { schoolId: user.schoolId, ...otherFilters },
});
```

This is the cheapest + safest pattern. Use it for `findMany`,
`count`, `groupBy`, `aggregate`, and any list endpoint. The filter
is part of the index lookup — no row is ever loaded for the wrong
tenant.

### Pattern 2 — Verify after fetching (for `findUnique` by id)

When the caller passes an id from the URL, `findUnique` doesn't take
a composite filter (it's a primary-key lookup). Verify scope after:

```ts
import { assertSchoolScope } from '@/common/multi-tenant/assert-school-scope';

const student = await this.prisma.student.findUnique({ where: { id } });
return assertSchoolScope({ row: student, expected: user.schoolId, entity: 'Student' });
```

The helper throws `NotFoundException` for both "doesn't exist" and
"belongs to another tenant" — same outward shape, no existence leak.

### Pattern 3 — Operator-tier bypass (SUPER_ADMIN only)

Routes under `@Roles(SUPER_ADMIN)` deliberately read across tenants.
Use `assertSchoolScopeOrSuperAdmin` to make the bypass explicit:

```ts
import { assertSchoolScopeOrSuperAdmin } from '@/common/multi-tenant/assert-school-scope';

return assertSchoolScopeOrSuperAdmin({
  row: school,
  expected: user.schoolId,
  actorRole: user.role,
  entity: 'School',
});
```

A casual code reader sees the bypass + the role gate together —
silent bypasses hide in code review.

## What NOT to do

```ts
// ❌ findUnique by id without verifying scope
const student = await this.prisma.student.findUnique({ where: { id } });
return student; // returns rows from any tenant if id is guessable

// ❌ Trusting input schoolId from the body
return this.prisma.student.findMany({ where: { schoolId: dto.schoolId } });
// always use user.schoolId from the JWT

// ❌ Update by id without verifying scope
await this.prisma.student.update({ where: { id }, data: ... });
// fetch first → assertSchoolScope → update
```

## Phase α spot-check audit

Spot-checked controllers + services for tenant scoping. Result:

| File | Status | Notes |
|---|---|---|
| `student/student.service.ts` | ✓ Filtered | Every `findMany`/`count` includes `schoolId`. `findOne` uses composite key. |
| `attendance/attendance.service.ts` | ✓ Filtered | Roster query filters by class+school. Mark uses scope from JWT. |
| `fees/fees.service.ts` | ✓ Filtered | All queries use `user.schoolId`. Payment recording derives schoolId from the student row (verified). |
| `class/class.service.ts` | ✓ Filtered | List + detail both filter. |
| `exam/exams.service.ts` | ✓ Filtered | Verified via `findFirst({ where: { id, schoolId } })` pattern. |
| `platform/platform.service.ts` | ✓ SUPER_ADMIN intentional | Operator-tier; cross-tenant by design. Controller-level @Roles guard. |
| `notifications/notification-center.service.ts` | ✓ Filtered | Inbox query scoped to user + school. |
| `productization/guardian.service.ts` | ✓ Filtered | All CRUD uses schoolId from JWT. |

Net result: no missing-scope bugs found in the spot check. The
helper is in place for future endpoints to use; existing endpoints
follow Pattern 1 consistently.

## When you add a new endpoint

1. List endpoints → use Pattern 1.
2. Detail / edit / delete by id → use Pattern 2 with `assertSchoolScope`.
3. Anything cross-tenant → use Pattern 3 + add `@Roles(SUPER_ADMIN)`.

If you forget, the next code review is the safety net — reviewers
should grep for `findUnique` without a follow-up `assertSchoolScope`
call.

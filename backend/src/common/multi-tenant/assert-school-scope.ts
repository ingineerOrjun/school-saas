import { ForbiddenException, NotFoundException } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Tenant isolation runtime helper — Phase α.
//
// Convention check + safety net for "did you remember to filter by
// schoolId?". The single biggest production-grade risk in a multi-
// tenant SaaS is a query that forgets to scope. This helper makes
// the scope explicit at the call site so a missing filter is loud,
// not silent.
//
// Usage pattern:
//
//   // After fetching a row by id, BEFORE returning or mutating:
//   const student = await this.prisma.student.findUnique({ where: { id } });
//   assertSchoolScope({ row: student, expected: user.schoolId });
//   //  ^ throws NotFoundException if row is null OR cross-tenant
//
// Behaviour:
//   • row null/undefined         → NotFoundException (the row doesn't
//                                   exist OR isn't visible to this
//                                   tenant — same outward shape so we
//                                   don't leak existence)
//   • row.schoolId !== expected  → NotFoundException (same reason)
//   • row.schoolId === expected  → returns the typed row unchanged
//
// Why NotFoundException, not ForbiddenException:
//   Returning 403 leaks "this id exists in some tenant." Returning
//   404 means an attacker probing UUIDs can't tell whether a row
//   simply doesn't exist or belongs to another school.
//
// Why a helper instead of repository pattern:
//   Each service owns its own queries. Forcing a repository pattern
//   would be a much bigger refactor. The helper is a one-line
//   addition AFTER any findUnique that doesn't include schoolId
//   in its where clause — most existing call sites already filter,
//   but this catches the ones that don't.
//
// SUPER_ADMIN exception:
//   Operator-tier endpoints (under @Roles(SUPER_ADMIN)) by design
//   read across tenants. Use `assertSchoolScopeOrSuperAdmin` for
//   those — keeps the explicit waiver visible at the call site
//   instead of a silent bypass.
// ---------------------------------------------------------------------------

interface RowWithSchoolId {
  schoolId: string;
}

export interface AssertSchoolScopeInput<T extends RowWithSchoolId> {
  row: T | null | undefined;
  expected: string;
  /** Optional human label for clearer 404 messages ("Student not found"). */
  entity?: string;
}

/**
 * Asserts that `row` exists AND belongs to the expected tenant.
 * Returns the row narrowed to non-null on success. Throws
 * `NotFoundException` otherwise — never reveals cross-tenant existence.
 */
export function assertSchoolScope<T extends RowWithSchoolId>(
  input: AssertSchoolScopeInput<T>,
): T {
  if (!input.row) {
    throw new NotFoundException(`${input.entity ?? 'Resource'} not found.`);
  }
  if (input.row.schoolId !== input.expected) {
    throw new NotFoundException(`${input.entity ?? 'Resource'} not found.`);
  }
  return input.row;
}

/**
 * Same as `assertSchoolScope` but allows SUPER_ADMIN callers to
 * bypass the tenant check. Use ONLY on endpoints that must support
 * cross-tenant operator reads/writes (e.g. `/platform/schools/:id/...`).
 *
 * The bypass is EXPLICIT at the call site so a casual reader can
 * see why this query is allowed to cross tenants.
 */
export function assertSchoolScopeOrSuperAdmin<T extends RowWithSchoolId>(input: {
  row: T | null | undefined;
  expected: string;
  actorRole: string;
  entity?: string;
}): T {
  if (!input.row) {
    throw new NotFoundException(`${input.entity ?? 'Resource'} not found.`);
  }
  if (input.actorRole === 'SUPER_ADMIN') {
    return input.row;
  }
  if (input.row.schoolId !== input.expected) {
    throw new NotFoundException(`${input.entity ?? 'Resource'} not found.`);
  }
  return input.row;
}

/**
 * Defensive variant for write operations where the caller has
 * already loaded the row + wants to confirm scope before a mutation.
 * Same semantics as `assertSchoolScope` but returns void (the caller
 * already has the row).
 *
 * Used for "I just fetched this, now I'm about to update — confirm
 * I'm allowed" flows in services that prefer explicit-step style.
 */
export function requireSameSchool(
  rowSchoolId: string,
  expected: string,
  entity = 'Resource',
): void {
  if (rowSchoolId !== expected) {
    // ForbiddenException here (not 404) because the caller
    // demonstrated they CAN see the row by fetching it — at this
    // point the existence is already disclosed and the appropriate
    // error is "you're not allowed to mutate this." This variant
    // is for INTERNAL use where the row wasn't user-supplied; if
    // the row id came from the URL, use assertSchoolScope instead.
    throw new ForbiddenException(`Cross-tenant ${entity} access denied.`);
  }
}

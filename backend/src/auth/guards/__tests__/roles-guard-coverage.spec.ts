import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from '../roles.guard';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';

import { ClassController } from '../../../class/class.controller';
import { SectionController } from '../../../section/section.controller';
import { TeacherController } from '../../../teacher/teacher.controller';
import type { AuthenticatedUser } from '../../jwt.strategy';

// ============================================================================
// RolesGuard coverage against the controllers fixed in
// Session 6c-audit Phase 2 (Class / Section / Teacher).
//
// Why "static" tests instead of e2e:
//
//   The Phase 1 audit found that these controllers had the right
//   decorator chain at first glance (JwtAuthGuard + sometimes
//   RolesGuard) but were missing @Roles metadata. The bug was a
//   *decorator surface* bug, not a runtime logic bug — RolesGuard
//   itself worked fine. So the regression test that matters is:
//   "does the real controller class carry the right @Roles
//   metadata, and does RolesGuard reject TEACHER when it queries
//   that metadata?"
//
//   This test reaches directly into the controller class with
//   @nestjs/core's Reflector — the exact path RolesGuard uses at
//   runtime. No HTTP, no DI graph, no service mocking. If a future
//   refactor strips @Roles off the class, this test fails.
//
// Each case asserts both outcomes:
//   • TEACHER role → ForbiddenException (the audit fix)
//   • ADMIN role   → no throw            (we didn't lock out admins)
// ============================================================================

function buildContext(
  user: AuthenticatedUser,
  handler: (...args: unknown[]) => unknown,
  controllerClass: new (...args: never[]) => unknown,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => handler,
    getClass: () => controllerClass,
  } as never;
}

function makeUser(role: Role): AuthenticatedUser {
  return {
    id: 'u-1',
    email: 'someone@school.test',
    role,
    schoolId: 'school-a',
  };
}

function buildGuard(): RolesGuard {
  // Real Reflector instance — it walks `Reflect.getMetadata` against
  // the actual class + method, which is exactly what Nest does in
  // production.
  const reflector = new Reflector();
  return new RolesGuard(reflector);
}

describe('RolesGuard coverage — Session 6c-audit Phase 2', () => {
  const guard = buildGuard();

  describe('ClassController — class-level @Roles(ADMIN)', () => {
    it('POST /classes → TEACHER gets ForbiddenException', () => {
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        ClassController.prototype.create,
        ClassController,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('PATCH /classes/:id → TEACHER gets ForbiddenException', () => {
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        ClassController.prototype.update,
        ClassController,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('DELETE /classes/:id → TEACHER gets ForbiddenException', () => {
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        ClassController.prototype.remove,
        ClassController,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('ADMIN passes the write gates (sanity check — admins still work)', () => {
      const ctx = buildContext(
        makeUser(Role.ADMIN),
        ClassController.prototype.create,
        ClassController,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('GET /classes → TEACHER passes (method-level @Roles override widens to TEACHER)', () => {
      // Without the per-method override, the class-level @Roles(ADMIN)
      // would reject TEACHER and break the attendance/marks pickers.
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        ClassController.prototype.findAll,
        ClassController,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('SectionController — class-level @Roles(ADMIN)', () => {
    it('POST /sections → TEACHER gets ForbiddenException', () => {
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        SectionController.prototype.create,
        SectionController,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('DELETE /sections/:id → TEACHER gets ForbiddenException', () => {
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        SectionController.prototype.remove,
        SectionController,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('GET /sections → TEACHER passes (method-level override)', () => {
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        SectionController.prototype.findAll,
        SectionController,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('TeacherController — class-level @Roles(ADMIN)', () => {
    it('PATCH /teachers/:id → TEACHER gets ForbiddenException', () => {
      // The original Phase 1 finding — pre-fix, a TEACHER could
      // PATCH any teacher's name / userId in their school.
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        TeacherController.prototype.update,
        TeacherController,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('GET /teachers → TEACHER gets ForbiddenException (admin-only list)', () => {
      // Unlike classes/sections, the teachers list is not a picker —
      // it's the admin's faculty management page. No per-method
      // widen; TEACHER inherits the class-level ADMIN gate.
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        TeacherController.prototype.findAll,
        TeacherController,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('GET /teachers/:id/assignment-summary → STAFF passes (per-method widen to ADMIN + STAFF)', () => {
      const ctx = buildContext(
        makeUser(Role.STAFF),
        TeacherController.prototype.assignmentSummary,
        TeacherController,
      );
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('DELETE /teachers/:id → TEACHER gets ForbiddenException (the Session 6c.3 fix is still in force)', () => {
      const ctx = buildContext(
        makeUser(Role.TEACHER),
        TeacherController.prototype.remove,
        TeacherController,
      );
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('Sanity: the metadata is actually attached', () => {
    // Defensive cross-check — if a future refactor strips the @Roles
    // decorator, the throw-tests above would still fail, but the
    // failure message would be cryptic ("expected throw, got true").
    // These two assertions surface the root cause directly: the
    // metadata is missing.
    it('ClassController has class-level @Roles metadata', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, ClassController) as
        | Role[]
        | undefined;
      expect(roles).toEqual([Role.ADMIN]);
    });

    it('SectionController has class-level @Roles metadata', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, SectionController) as
        | Role[]
        | undefined;
      expect(roles).toEqual([Role.ADMIN]);
    });

    it('TeacherController has class-level @Roles metadata', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, TeacherController) as
        | Role[]
        | undefined;
      expect(roles).toEqual([Role.ADMIN]);
    });
  });
});

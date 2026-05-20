import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../jwt.strategy';

/**
 * RolesGuard enforces role-based access control via the @Roles() decorator.
 *
 * IMPORTANT — FAIL-OPEN BEHAVIOR:
 * This guard FAILS OPEN when no @Roles() metadata is present on the
 * route or its class. That is, `@UseGuards(JwtAuthGuard, RolesGuard)`
 * WITHOUT a corresponding `@Roles(...)` decorator is effectively JWT-
 * only — any authenticated user passes through.
 *
 * This design enables composition: adding the guard becomes a no-op
 * when no constraint is declared, so it's safe to attach globally or
 * at a class level without forcing every method to opt out. The
 * trade-off is that a reader scanning the decorator chain can
 * incorrectly infer "fully role-gated" when in fact the route has no
 * role restriction at all.
 *
 * To gate a route by role:
 *
 *     @UseGuards(JwtAuthGuard, RolesGuard)
 *     @Roles(Role.ADMIN)   // <-- REQUIRED for the guard to enforce
 *     @Post('users')
 *     create(...) { ... }
 *
 * Or attach @Roles at class level to gate every method by default,
 * with per-method overrides for exceptions (see UserController,
 * FeesController, PlatformController for the pattern).
 *
 * Stack order matters: this guard must run AFTER `JwtAuthGuard`, which
 * is what attaches `req.user`. Always pair the two in `@UseGuards()`.
 *
 * Audit history: the Phase 1 security audit (2026-05-19) found 8
 * routes across ClassController + SectionController + TeacherController
 * that had `@UseGuards(JwtAuthGuard)` (sometimes with RolesGuard
 * stacked) but no @Roles metadata. They were silently JWT-only,
 * meaning any logged-in TEACHER could mutate tenant data. Phase 2
 * added the missing @Roles. Adding the guard without @Roles is the
 * recurring "looks protected but isn't" gotcha — keep this docstring
 * in mind when reviewing new write controllers.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Both handler and class metadata are checked so a class-level
    // `@Roles(Role.ADMIN)` can be overridden per-method when needed.
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      // No constraint declared — fall through.
      return true;
    }

    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) {
      // JwtAuthGuard should have populated req.user; if not, fail closed.
      throw new ForbiddenException('Authentication required.');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException(
        `This action is restricted to ${required.join(' / ')}.`,
      );
    }
    return true;
  }
}

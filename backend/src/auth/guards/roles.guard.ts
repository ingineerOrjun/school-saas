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
 * Allow the request through only when `req.user.role` is one of the
 * roles declared by `@Roles(...)` on the handler or controller.
 *
 * Stack order matters: this guard must run AFTER `JwtAuthGuard`, which
 * is what attaches `req.user`. Always pair the two in `@UseGuards()`:
 *
 *     @UseGuards(JwtAuthGuard, RolesGuard)
 *     @Roles(Role.ADMIN)
 *
 * Handlers without `@Roles(...)` metadata are unaffected — the guard
 * silently allows them, so it's safe to apply globally if desired.
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

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * Convenience param decorator for the authenticated user attached by
 * `JwtAuthGuard`. Usage:
 *
 *   @Get() me(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * Only valid on routes protected by `JwtAuthGuard` — otherwise `req.user` is
 * undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);

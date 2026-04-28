import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Apply with `@UseGuards(JwtAuthGuard)` on any controller route that requires
 * an authenticated user. The decoded user is available as `req.user` and
 * typed as `AuthenticatedUser` from `jwt.strategy.ts`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

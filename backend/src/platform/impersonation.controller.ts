import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ImpersonationService } from './impersonation.service';

// ---------------------------------------------------------------------------
// ImpersonationController — split out from PlatformController because
// of the role-gate asymmetry between START and END:
//
//   START — only SUPER_ADMINs can begin impersonation. The standard
//           class-level @Roles(SUPER_ADMIN) on PlatformController
//           would handle this, but…
//
//   END — the calling token's effective role IS the impersonated
//         target's role (e.g. ADMIN/STAFF/TEACHER). A class-level
//         @Roles(SUPER_ADMIN) would lock the user OUT of ending
//         their own impersonation, which is exactly the wrong
//         outcome.
//
// Solution: this controller has no class-level @Roles. START gets
// it method-level; END is open to any authenticated user, with a
// service-side check that the token actually carries an
// impersonation sentinel.
//
// Path layout: BOTH endpoints sit under /platform/impersonate/* so
// the URL prefix matches the rest of the platform layer's surface.
// `end` is declared BEFORE `:userId` so the literal-route match
// wins over the parametric one (Nest matches in declaration order).
// ---------------------------------------------------------------------------

@Controller('platform/impersonate')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImpersonationController {
  constructor(private readonly impersonation: ImpersonationService) {}

  /**
   * End the current impersonation session and receive a fresh
   * SUPER_ADMIN token. No @Roles — the caller is currently
   * authenticated AS the impersonated target, not as a SUPER_ADMIN.
   * The service verifies an impersonation sentinel is present.
   *
   * Declared first so `/platform/impersonate/end` is matched as a
   * literal route, not as `/platform/impersonate/:userId` with
   * `userId="end"` (which would 400 on the UUID parse anyway, but
   * relying on that is brittle).
   */
  @Post('end')
  @HttpCode(HttpStatus.OK)
  async end(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    if (!user.impersonatedBy || !user.impersonationStartedAt) {
      throw new BadRequestException(
        'You are not currently impersonating anyone.',
      );
    }
    return this.impersonation.end({
      impersonatedTargetId: user.id,
      impersonatedBy: user.impersonatedBy,
      impersonationStartedAt: user.impersonationStartedAt,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Start impersonating a school user. SUPER_ADMIN-only. The
   * service rejects:
   *   • another SUPER_ADMIN as the target
   *   • the actor themselves as the target
   *   • a target inside a SUSPENDED / EXPIRED school
   *   • starting from an already-impersonated session
   */
  @Post(':userId')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN)
  async start(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.impersonation.start({
      actor: {
        userId: actor.id,
        email: actor.email,
        role: actor.role,
        // Defence in depth: even though the controller-level role
        // gate accepts only SUPER_ADMIN, an impersonated SUPER_ADMIN
        // session shouldn't be able to start a NEW impersonation
        // (nesting). The service rejects this; we surface the flag
        // so it can.
        isAlreadyImpersonating: !!actor.impersonatedBy,
      },
      targetUserId: userId,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}

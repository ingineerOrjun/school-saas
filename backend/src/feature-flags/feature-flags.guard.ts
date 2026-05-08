import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { FEATURE_BY_KEY, FeatureKeyValue } from './feature-catalog';
import { FeatureFlagsService } from './feature-flags.service';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator';

// ---------------------------------------------------------------------------
// FeatureFlagsGuard — runtime enforcement of `@RequireFeature(...)`.
//
// Stack order (matters):
//   @UseGuards(JwtAuthGuard, RolesGuard, FeatureFlagsGuard)
//
// Why last:
//   We need `req.user` populated (JwtAuthGuard does that), and we
//   want to fail-fast on role mismatches before paying the
//   feature-resolution lookup. RolesGuard runs without DB I/O, so
//   it cheaply rejects the obvious cases.
//
// SUPER_ADMIN bypass:
//   Platform owners are NOT bound by any school's feature flags —
//   they need to be able to look at anything. This is also the
//   safety valve for the impersonation flow: a SUPER_ADMIN
//   inspecting a school whose plan has SMS disabled should still be
//   able to navigate the SMS settings page (which would otherwise
//   404 + frustrate the operator).
//
//   During impersonation though, `req.user.role` is the IMPERSONATED
//   user's role (not SUPER_ADMIN), so the flag actually applies —
//   that's correct: impersonation is "see what the school admin
//   sees", and the school admin sees flags too.
// ---------------------------------------------------------------------------

@Injectable()
export class FeatureFlagsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly features: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      FeatureKeyValue | null | undefined
    >(REQUIRE_FEATURE_KEY, [context.getHandler(), context.getClass()]);

    if (!required) return true; // No `@RequireFeature(...)` declared.

    const req = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('Authentication required.');
    }

    // SUPER_ADMIN bypass — platform owners aren't tenant-scoped.
    // Note: during impersonation, `user.role` is the impersonated
    // target's role, NOT SUPER_ADMIN. The flag still applies,
    // matching what the school's own admin would see.
    if (user.role === Role.SUPER_ADMIN) return true;

    const enabled = await this.features.isEnabled(user.schoolId, required);
    if (!enabled) {
      const def = FEATURE_BY_KEY.get(required);
      const label = def?.label ?? required;
      throw new ForbiddenException(
        `The "${label}" feature is not enabled for your school. Contact your administrator to upgrade your plan.`,
      );
    }
    return true;
  }
}

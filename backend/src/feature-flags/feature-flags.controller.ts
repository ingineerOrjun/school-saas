import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { PrismaService } from '../database/prisma.service';
import { FeatureFlagsService } from './feature-flags.service';

// ---------------------------------------------------------------------------
// FeatureFlagsController — school-side read endpoint.
//
// Exposes one route: `GET /me/features` → the resolved feature map
// for the calling user's school + tenant-status flags (maintenance
// mode, etc.) The frontend reads this to hide nav entries, gate
// page-level access, and render the maintenance-mode banner.
//
// SUPER_ADMIN gets a special-cased "all features on" payload —
// matches the guard's bypass behaviour and keeps the platform UI
// from accidentally hiding anything.
//
// Open to every authenticated user (any role). The feature MAP is
// not sensitive — it's effectively the school's plan signature,
// and any user already knows what their school can/can't do
// because the UI exposes it.
// ---------------------------------------------------------------------------

@Controller('me')
@UseGuards(JwtAuthGuard)
export class FeatureFlagsController {
  constructor(
    private readonly features: FeatureFlagsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('features')
  async getMyFeatures(@CurrentUser() user: AuthenticatedUser) {
    if (user.role === 'SUPER_ADMIN') {
      // SUPER_ADMINs aren't tenant-bound. Hand back every catalog
      // entry as enabled — matches the guard's bypass.
      const catalog = this.features.getCatalog();
      const allOn: Record<string, boolean> = {};
      for (const c of catalog) allOn[c.key] = true;
      return {
        features: allOn,
        catalog,
        tenant: { maintenanceMode: false },
      };
    }

    const [set, school] = await Promise.all([
      this.features.resolveForSchool(user.schoolId),
      this.prisma.school.findUnique({
        where: { id: user.schoolId },
        select: { maintenanceMode: true },
      }),
    ]);
    return {
      features: set.features,
      catalog: this.features.getCatalog(),
      tenant: {
        // Phase 17 — drives the school-side maintenance banner.
        // Defaults to false when the tenant row vanished mid-flight
        // (the auth strategy would already have rejected the request,
        // but we don't want a missing-row crash to surface as a 5xx
        // here).
        maintenanceMode: school?.maintenanceMode ?? false,
      },
    };
  }
}

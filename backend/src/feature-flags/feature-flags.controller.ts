import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { FeatureFlagsService } from './feature-flags.service';

// ---------------------------------------------------------------------------
// FeatureFlagsController — school-side read endpoint.
//
// Exposes one route: `GET /me/features` → the resolved feature map
// for the calling user's school. The frontend reads this to hide
// nav entries for disabled features and to short-circuit
// page-level access checks.
//
// SUPER_ADMIN gets a special-cased "all features on" payload —
// matches the guard's bypass behaviour and keeps the platform UI
// from accidentally hiding anything.
//
// Open to every authenticated user (any role). The feature MAP is
// not sensitive — it's effectively the school's plan signature,
// and any user already knows what their school can/can't do
// because the UI exposes it. The OVERRIDES key returned here is
// scrubbed for non-SUPER_ADMIN consumers (they don't need to know
// how the mix was layered, just the resolved state).
// ---------------------------------------------------------------------------

@Controller('me')
@UseGuards(JwtAuthGuard)
export class FeatureFlagsController {
  constructor(private readonly features: FeatureFlagsService) {}

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
      };
    }

    const set = await this.features.resolveForSchool(user.schoolId);
    return {
      features: set.features,
      catalog: this.features.getCatalog(),
    };
  }
}

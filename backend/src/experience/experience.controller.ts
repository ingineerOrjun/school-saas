import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { GlobalSearchService } from './global-search.service';

// ---------------------------------------------------------------------------
// ExperienceController — Phase 24.
//
// School-side polish endpoints. Mounted at /me/* alongside the
// existing tenant surface. JwtAuthGuard at controller level — every
// route requires an authenticated user.
//
// Why a separate controller (not on PlatformController):
//   These routes are TENANT-scoped, not platform-scoped. The ops
//   cockpit + super-admin surface stays under /platform/*; this
//   surface targets the school-facing UX (command palette, quick
//   actions). Keeping them apart keeps the throttle buckets +
//   permission gates simple.
// ---------------------------------------------------------------------------

@Controller('me')
@UseGuards(JwtAuthGuard)
export class ExperienceController {
  constructor(private readonly search: GlobalSearchService) {}

  /**
   * Unified search across the user's tenant. Returns grouped hits
   * (students/teachers/guardians/payments/exams/classes) with
   * weighted ranking. Empty / short queries return an empty
   * shape — the frontend renders quick-actions instead.
   *
   * Query: ?q=<text>
   *
   * Bounded at ~50 rows per call (PER_GROUP_LIMIT × 6 groups).
   * Operator throttle bucket applies; the UI debounces typing
   * (~150ms) so we never see 1-keystroke-per-call traffic.
   */
  @Get('search')
  async globalSearch(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
  ) {
    return this.search.search({
      schoolId: user.schoolId,
      role: user.role,
      q: q ?? '',
    });
  }
}

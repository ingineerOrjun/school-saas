import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * GET /dashboard/summary
   *
   * Single-call aggregate for the dashboard UI. Scoped to the caller's
   * school via JWT — no query params needed.
   */
  @Get('summary')
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.getSummary(user.schoolId);
  }
}

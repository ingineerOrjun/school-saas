import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * GET /dashboard/summary
   *
   * School-wide aggregate for the ADMIN dashboard. Scoped to the
   * caller's school via JWT — no query params needed. Teachers may
   * still hit this (it doesn't expose anything they shouldn't see),
   * but the admin UI is the only thing that consumes the full payload.
   */
  @Get('summary')
  getSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.getSummary(user.schoolId);
  }

  /**
   * GET /dashboard/teacher-summary
   *
   * Teacher-scoped dashboard data: their assigned class/section, today's
   * attendance state, 30-day class %, pending tasks, and a capped roster.
   * TEACHER-only — admins use /dashboard/summary instead.
   */
  @Get('teacher-summary')
  @UseGuards(RolesGuard)
  @Roles(Role.TEACHER)
  getTeacherSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.getTeacherSummary(user);
  }
}

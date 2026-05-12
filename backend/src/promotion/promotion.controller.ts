import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { FeatureKey } from '../feature-flags/feature-catalog';
import { FeatureFlagsGuard } from '../feature-flags/feature-flags.guard';
import { RequireFeature } from '../feature-flags/require-feature.decorator';
import { RunPromotionDto } from './dto/run-promotion.dto';
import { PromotionService } from './promotion.service';
import { PromotionPreviewService } from './promotion-preview.service';

/**
 * Promotion endpoints. Admin-only — promoting an entire school is a
 * year-defining operation and should never be triggered by anyone
 * else. The history reads are also admin-only for now (parents'
 * access to their own child's history is a separate UX iteration).
 *
 * Phase 5: gated behind the `promotion` feature flag (on by default).
 * Platform owners can disable to hide the entire feature for tenants
 * that don't run the formal academic-year cycle.
 */
@Controller('promotion')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureFlagsGuard)
@RequireFeature(FeatureKey.Promotion)
export class PromotionController {
  constructor(
    private readonly promotion: PromotionService,
    private readonly preview: PromotionPreviewService,
  ) {}

  /**
   * Phase ACADEMIC TRANSITION SAFETY Part 1 — dry-run promotion
   * validator. Same payload shape as `/promotion/run`, but instead
   * of executing it returns a `PromotionValidationResult` describing
   * every blocker + warning the planned run would hit.
   *
   * Always returns 200 OK with the report — payload-level problems
   * are surfaced inside `result.blockers`, not via HTTP errors, so
   * the UI can render the full picture in one round-trip.
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  previewRun(
    @Body() dto: RunPromotionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.preview.preview(dto, user.schoolId, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Atomically: snapshot every entry into StudentAcademicRecord,
   * roll PROMOTED students forward, demote the current session, and
   * create the next session as active+unlocked.
   *
   * Preconditions:
   *   • Active session exists.
   *   • Active session is LOCKED.
   *   • PromotionPreviewService.preview() reports `canRun: true`.
   *
   * Returns a `{ fromSession, toSession, counts }` summary.
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  run(
    @Body() dto: RunPromotionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.promotion.run(dto, user.schoolId, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('students/:studentId/history')
  @Roles(Role.ADMIN)
  history(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.promotion.listForStudent(studentId, user.schoolId);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
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
  constructor(private readonly promotion: PromotionService) {}

  /**
   * Atomically: snapshot every entry into StudentAcademicRecord,
   * roll PROMOTED students forward, demote the current session, and
   * create the next session as active+unlocked.
   *
   * Preconditions:
   *   • Active session exists.
   *   • Active session is LOCKED.
   *
   * Returns a `{ fromSession, toSession, counts }` summary.
   */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  run(
    @Body() dto: RunPromotionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.promotion.run(dto, user.schoolId);
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

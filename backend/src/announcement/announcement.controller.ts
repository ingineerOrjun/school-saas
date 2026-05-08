import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { AnnouncementService } from './announcement.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

/**
 * Role rules:
 *   • READ (GET)            — any authenticated user (teachers + admins).
 *   • WRITE (POST / DELETE) — ADMIN only via `@Roles(Role.ADMIN)`.
 *
 * Phase 5: gated behind the `announcements` feature flag. The flag
 * is on by default for every school (legacy schools keep working
 * unchanged) but the platform owner can disable it per-tenant.
 * SUPER_ADMIN bypasses the gate, so platform inspections still see
 * everything.
 *
 * RolesGuard is attached at the controller level so individual routes
 * just opt-in to the admin restriction by adding `@Roles(...)`.
 */
@Controller('announcements')
@UseGuards(JwtAuthGuard, RolesGuard, FeatureFlagsGuard)
@RequireFeature(FeatureKey.Announcements)
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.announcements.list(user.schoolId, sessionId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcements.create(dto, user.schoolId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcements.remove(id, user.schoolId);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AnnouncementService } from './announcement.service';
import { DeploymentService } from './deployment.service';
import { CreateSupportNoteDto, PublishAnnouncementDto } from './dto/dto';
import { OnboardingService } from './onboarding.service';
import { SupportNoteService } from './support-note.service';

// ---------------------------------------------------------------------------
// Platform-tier productization endpoints. SUPER_ADMIN-only,
// `platform` throttle bucket. Mounted under /platform.
// ---------------------------------------------------------------------------

@Controller('platform')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Throttle({ platform: { limit: 300, ttl: 60_000 } })
export class PlatformProductizationController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly supportNotes: SupportNoteService,
    private readonly announcements: AnnouncementService,
    private readonly deployment: DeploymentService,
  ) {}

  // ---------- Onboarding (operator drilldown) ----------

  @Get('schools/:id/onboarding')
  getSchoolOnboarding(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.getStatus(id);
  }

  @Post('schools/:id/onboarding/reset')
  @HttpCode(HttpStatus.OK)
  resetSchoolOnboarding(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.reset(id);
  }

  // ---------- Support notes ----------

  @Get('schools/:id/support-notes')
  listSupportNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.supportNotes.list(
      id,
      limit ? Math.min(200, parseInt(limit, 10)) : undefined,
    );
  }

  @Post('schools/:id/support-notes')
  @HttpCode(HttpStatus.CREATED)
  createSupportNote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupportNoteDto,
  ) {
    return this.supportNotes.create({
      schoolId: id,
      authorId: user.id,
      body: dto.body,
      tone: dto.tone ?? null,
    });
  }

  // ---------- Platform announcements ----------

  @Get('announcements')
  listAnnouncements() {
    return this.announcements.listAll();
  }

  @Post('announcements')
  @HttpCode(HttpStatus.CREATED)
  publishAnnouncement(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PublishAnnouncementDto,
  ) {
    return this.announcements.publish({
      title: dto.title,
      body: dto.body,
      tone: dto.tone,
      audience: dto.audience,
      targetSchoolIds: dto.targetSchoolIds,
      linkUrl: dto.linkUrl,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      publishedById: user.id,
    });
  }

  @Post('announcements/:id/retire')
  @HttpCode(HttpStatus.OK)
  retireAnnouncement(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.retire(id);
  }

  // ---------- Deployment / upgrade safety / adoption ----------

  @Get('deployment')
  getDeployment() {
    return this.deployment.getInfo();
  }

  @Get('deployment/upgrade-safety')
  getUpgradeSafety() {
    return this.deployment.getUpgradeSafetyReport();
  }

  @Get('deployment/adoption')
  getAdoption() {
    return this.deployment.getAdoptionMetrics();
  }
}

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationSeverity, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { NotificationCenterService } from './notification-center.service';

// ---------------------------------------------------------------------------
// NotificationCenterController — Phase 14.
//
// Mounted under /platform/notifications (vs /me/notifications which
// is school-side). Every route is SUPER_ADMIN-gated — same posture
// as the rest of the platform surface.
//
// Routes:
//   GET   /platform/notifications              — list with filters
//   GET   /platform/notifications/unread-count — bell badge
//   GET   /platform/notifications/:id          — detail + deliveries
//   PATCH /platform/notifications/:id/read     — mark read
//   PATCH /platform/notifications/:id/unread   — mark unread
//
// Filter params:
//   severity   — comma-separated list (INFO,WARNING,...)
//   unread     — "true" to filter to unread only
//   schoolId   — drilldown to one tenant
//   page, pageSize — standard pagination
// ---------------------------------------------------------------------------

@Controller('platform/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class NotificationCenterController {
  constructor(private readonly center: NotificationCenterService) {}

  @Get()
  list(
    @Query('severity') severity?: string,
    @Query('unread') unread?: string,
    @Query('schoolId') schoolId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const severities = parseSeverities(severity);
    return this.center.list({
      severity: severities.length > 0 ? severities : undefined,
      unreadOnly: unread === 'true',
      schoolId: schoolId || undefined,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('unread-count')
  async unreadCount() {
    const count = await this.center.unreadCount();
    return { count };
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.center.get(id);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.center.markRead(id);
  }

  @Patch(':id/unread')
  @HttpCode(HttpStatus.OK)
  markUnread(@Param('id', ParseUUIDPipe) id: string) {
    return this.center.markUnread(id);
  }
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  'INFO',
  'SUCCESS',
  'WARNING',
  'ERROR',
  'CRITICAL',
]);

function parseSeverities(raw: string | undefined): NotificationSeverity[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is NotificationSeverity => VALID_SEVERITIES.has(s));
}

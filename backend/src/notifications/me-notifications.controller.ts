import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NotificationSeverity } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { NotificationCenterService } from './notification-center.service';

// ---------------------------------------------------------------------------
// MeNotificationsController — Phase 20 school-side inbox API.
//
// Mounted at `/notifications` (vs `/platform/notifications` which is
// SUPER_ADMIN-tier). Every route applies the school-side access
// filter via NotificationCenterService.*ForSchoolUser() — a user can
// only see notifications addressed to them or school-wide for their
// tenant.
//
// Routes:
//   GET    /notifications                — list with filters
//   GET    /notifications/unread-count   — bell badge counter
//   GET    /notifications/:id            — detail (404 if not accessible)
//   PATCH  /notifications/:id/read       — mark read
//   PATCH  /notifications/:id/unread     — mark unread
//   POST   /notifications/mark-all-read  — flip every unread to read
//
// Security:
//   • Every method takes `user.id` + `user.schoolId` from the JWT
//     and passes them to the service. The service builds the where
//     clause; controllers never construct queries directly.
//   • A 404 on /:id can mean "not exists" OR "exists but not yours."
//     Both surface as the same shape to avoid leaking row IDs.
//   • SUPER_ADMIN doesn't get special treatment here — they have
//     /platform/notifications for the cross-tenant view. If a
//     SUPER_ADMIN happens to call /notifications, they see whatever
//     their User row's schoolId points to (typically the platform
//     placeholder), which is correct: this surface is school-side.
//
// Filter params (query string):
//   ?severity=INFO,WARNING        comma-separated subset
//   ?unread=true                  unread-only
//   ?page=1&pageSize=25           pagination
// ---------------------------------------------------------------------------

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  'INFO',
  'SUCCESS',
  'WARNING',
  'ERROR',
  'CRITICAL',
]);

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class MeNotificationsController {
  constructor(private readonly center: NotificationCenterService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('severity') severity?: string,
    @Query('unread') unread?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.center.listForSchoolUser(
      { userId: user.id, schoolId: user.schoolId },
      {
        severity: parseSeverities(severity),
        unreadOnly: unread === 'true',
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      },
    );
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    const count = await this.center.unreadCountForSchoolUser({
      userId: user.id,
      schoolId: user.schoolId,
    });
    return { count };
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.center.getForSchoolUser(
      { userId: user.id, schoolId: user.schoolId },
      id,
    );
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.center.markReadForSchoolUser(
      { userId: user.id, schoolId: user.schoolId },
      id,
    );
  }

  @Patch(':id/unread')
  @HttpCode(HttpStatus.OK)
  markUnread(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.center.markUnreadForSchoolUser(
      { userId: user.id, schoolId: user.schoolId },
      id,
    );
  }

  /**
   * Bulk "Mark all read" affordance. Flips every unread notification
   * the user has access to. Returns the count flipped so the UI can
   * show "marked N as read."
   */
  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.center.markAllReadForSchoolUser({
      userId: user.id,
      schoolId: user.schoolId,
    });
  }
}

function parseSeverities(raw: string | undefined): NotificationSeverity[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is NotificationSeverity => VALID_SEVERITIES.has(s));
}

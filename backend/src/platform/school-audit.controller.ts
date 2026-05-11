import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PlatformAuditAction, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { PlatformAuditService } from './platform-audit.service';

// ============================================================================
// SchoolAuditController — tenant-scoped read-only audit feed.
//
// Mounted at `/audit/recent` (outside `/platform`) and gated by
// `@Roles(ADMIN, STAFF)`. School-side panels (RecentActivityPanel,
// entity-history sections) hit this endpoint to render the
// chronological tape of what's been changing inside the school.
//
// Server-side guarantees:
//   • The `schoolId` filter is locked to `user.schoolId` — clients
//     CANNOT escape their tenant.
//   • The query method ignores `actorUserId` so school admins
//     can't probe "who did what" beyond the visible label / role
//     denormalized on the row.
//
// Why not just extend PlatformController.listAudit:
//   PlatformController is `@Roles(SUPER_ADMIN)` at the class level
//   — flipping that for one route would invert the safety. A
//   separate controller with its own role gate is the simpler shape.
// ============================================================================

@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchoolAuditController {
  constructor(private readonly audit: PlatformAuditService) {}

  /**
   * Paginated tenant-scoped audit feed.
   *
   * Filters (all optional):
   *   • `action`     — exact match against PlatformAuditAction
   *   • `targetType` — e.g. "Exam", "Attendance", "School"
   *   • `targetId`   — narrow to one entity (used by entity-history
   *                    sections on the marksheet / payment / student
   *                    pages)
   *   • `q`          — free-text across actor email + target label
   *   • `fromDate` / `toDate` — YYYY-MM-DD
   *   • `page` / `pageSize`  — defaults: 1 / 20
   */
  @Get('recent')
  @Roles(Role.ADMIN, Role.STAFF)
  listRecent(
    @CurrentUser() user: AuthenticatedUser,
    @Query('action') action?: PlatformAuditAction,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('q') q?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.listForSchool(user.schoolId, {
      action,
      targetType,
      targetId,
      q,
      fromDate,
      toDate,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}

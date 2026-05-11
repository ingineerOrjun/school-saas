import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TeacherScopeService } from '../common/auth/teacher-scope.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AttendanceService } from './attendance.service';
import { GetAttendanceQueryDto } from './dto/get-attendance.dto';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { ReportQueryDto } from './dto/report-query.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly scope: TeacherScopeService,
  ) {}

  @Get()
  async findRoster(
    @Query() query: GetAttendanceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    // Optional override — when omitted, the service applies the
    // strict-default rule (active session, or NULL legacy fallback).
    @Query('sessionId') sessionId?: string,
  ) {
    // Teacher scope check — passes through both ids so the service
    // can apply section-bound vs class-bound rules.
    await this.scope.assertClassAccess(user, {
      classId: query.classId,
      sectionId: query.sectionId,
    });
    return this.attendance.getRoster(
      query.date,
      { sectionId: query.sectionId, classId: query.classId },
      user.schoolId,
      sessionId,
    );
  }

  @Post('mark')
  @HttpCode(HttpStatus.OK)
  async mark(
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
    /**
     * Optional optimistic-concurrency token sent by the offline sync
     * engine. When the queued payload was created, the client cached
     * the roster's `version` (max(student.updatedAt)). If the live
     * value has moved past that, someone edited the underlying data
     * while this client was offline — the service throws 409 so the
     * frontend can flag the queue item as a conflict instead of
     * silently overwriting fresher data.
     *
     * Header rather than body so it doesn't pollute the DTO across
     * every feature that wants conflict detection — same X-Last-
     * Known-Version contract works for marks, exams, fees, etc.
     * Omitted by online callers (no offline cache to compare to).
     */
    @Headers('x-last-known-version') lastKnownVersion?: string,
    /**
     * Per-device identifier set by the frontend on every authed
     * request (`api.ts`) and on every offline-queue item
     * (`offline-queue.ts`). Logged with the write so multi-device
     * audit trails ("Attendance updated from Device-abc12345") work
     * out of the box — even when the queue drained on a different
     * device than the one that originally captured the toggle.
     */
    @Headers('x-device-id') deviceId?: string,
    @Req() req?: ExpressRequest,
  ) {
    // Past-date guard: teachers can only mark attendance for TODAY (or
    // forward). Editing yesterday's roster is reserved for admins so
    // ledgers don't get silently rewritten weeks after the fact.
    // String comparison is timezone-safe — both sides are local-day
    // YYYY-MM-DD; the lexicographic order matches the calendar order.
    if (user.role === Role.TEACHER && dto.date < todayLocalISO()) {
      throw new ForbiddenException(
        'Past attendance can only be edited by admin',
      );
    }
    // Marking is the write path — every studentId in the payload must
    // belong to the teacher's class (admins skip the check).
    await this.scope.assertStudentsInScope(
      user,
      dto.entries.map((e) => e.studentId),
    );
    return this.attendance.mark(dto, user.schoolId, lastKnownVersion, deviceId, {
      // Actor context — service emits ATTENDANCE_BULK_OVERWRITE when
      // entries.length crosses the bulk threshold. Single toggles
      // stay below the line and don't audit.
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req?.ip ?? null,
      userAgent: req?.headers['user-agent'] ?? null,
    });
  }

  @Get('report')
  async getReport(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Query('sessionId') sessionId?: string,
  ) {
    if (query.studentId) {
      await this.scope.assertStudentsInScope(user, [query.studentId]);
    } else {
      await this.scope.assertClassAccess(user, {
        classId: query.classId,
        sectionId: query.sectionId,
      });
    }
    return this.attendance.getReport(query, user.schoolId, sessionId);
  }

  /**
   * Daily attendance trend series for dashboard charts. Same scope
   * options as `report` but returns per-day buckets instead of an
   * aggregate. Empty/null `sectionId` + `classId` → school-wide
   * trend (admin dashboards).
   *
   * Scope check policy:
   *   • School-wide is admin / staff territory — TEACHER role gets
   *     403 from `assertClassAccess` since they can't act on data
   *     outside their assigned classes.
   *   • Scoped requests pass through `assertClassAccess` so a
   *     TEACHER hitting their own class still works.
   */
  @Get('trend')
  async getTrend(
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('sectionId') sectionId?: string,
    @Query('classId') classId?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    // School-wide (no scope) is admin/staff only — teachers must
    // narrow to a class/section they're assigned to. We forward
    // null when neither id is set; assertClassAccess accepts that
    // shape and 403s teachers.
    await this.scope.assertClassAccess(user, {
      classId: classId ?? null,
      sectionId: sectionId ?? null,
    });
    return this.attendance.getTrend(
      { fromDate, toDate, sectionId, classId },
      user.schoolId,
      sessionId,
    );
  }
}

/**
 * Today as `YYYY-MM-DD` in the SERVER's local timezone. Matches the
 * format the frontend sends in `dto.date` so a string compare answers
 * "is this date in the past?" without timezone juggling.
 */
function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

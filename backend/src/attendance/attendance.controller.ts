import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
    );
  }

  @Post('mark')
  @HttpCode(HttpStatus.OK)
  async mark(
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
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
    return this.attendance.mark(dto, user.schoolId);
  }

  @Get('report')
  async getReport(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (query.studentId) {
      await this.scope.assertStudentsInScope(user, [query.studentId]);
    } else {
      await this.scope.assertClassAccess(user, {
        classId: query.classId,
        sectionId: query.sectionId,
      });
    }
    return this.attendance.getReport(query, user.schoolId);
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

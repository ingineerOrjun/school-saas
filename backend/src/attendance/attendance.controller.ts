import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AttendanceService } from './attendance.service';
import { GetAttendanceQueryDto } from './dto/get-attendance.dto';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { ReportQueryDto } from './dto/report-query.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  findRoster(
    @Query() query: GetAttendanceQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.getRoster(
      query.date,
      { sectionId: query.sectionId, classId: query.classId },
      user.schoolId,
    );
  }

  @Post('mark')
  @HttpCode(HttpStatus.OK)
  mark(
    @Body() dto: MarkAttendanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.mark(dto, user.schoolId);
  }

  @Get('report')
  getReport(
    @Query() query: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.getReport(query, user.schoolId);
  }
}

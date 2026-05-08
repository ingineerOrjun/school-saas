import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { BulkCreateStudentsDto } from './dto/bulk-create-students.dto';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentService } from './student.service';

/** UUID regex for lightweight query-param validation. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Role rules:
 *   • READS (GET) — any authenticated user (teachers need to see their roster).
 *   • WRITES (POST/PATCH/DELETE) — ADMIN only via `@Roles(Role.ADMIN)`.
 */
@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentController {
  constructor(private readonly students: StudentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.create(dto, user.schoolId);
  }

  /**
   * Bulk import. Returns a `{ successCount, failed[] }` summary so the
   * UI can show partial-success outcomes without rolling everything
   * back when only some rows are invalid.
   */
  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  bulkCreate(
    @Body() dto: BulkCreateStudentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.bulkCreate(dto, user.schoolId);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('classId') classId?: string,
    @Query('unassigned') unassigned?: string,
  ) {
    // `?unassigned=1` trumps `?classId=` — it means "students with no
    // class at all". Otherwise require a valid UUID if classId is given.
    if (unassigned === '1' || unassigned === 'true') {
      return this.students.findAll(user.schoolId, { classId: null });
    }
    if (classId !== undefined) {
      if (!UUID_RE.test(classId)) {
        throw new BadRequestException('classId must be a UUID.');
      }
      return this.students.findAll(user.schoolId, { classId });
    }
    return this.students.findAll(user.schoolId);
  }

  /**
   * Cashier-workspace typeahead. Matches `q` against name, symbol no,
   * phone, parent name. Empty query → most-recent students (used as
   * the "no input yet" dropdown state). Capped at `limit` (default 10,
   * max 50) on the server.
   *
   * Defined BEFORE the parametric `:id` route — Nest matches in
   * declaration order, and `/students/search` would otherwise be
   * captured by `:id` and 400 on the UUID parse.
   */
  @Get('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.students.search(
      user.schoolId,
      q ?? '',
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  /**
   * Aggregated student analytics for the Analytics Center. ADMIN-only —
   * the per-class roster size could leak admissions data principals
   * don't want lower-tier staff seeing.
   *
   * Like `/search`, must come BEFORE the parametric `:id` route for
   * the same Nest declaration-order reason.
   */
  @Get('analytics')
  @Roles(Role.ADMIN)
  getAnalytics(@CurrentUser() user: AuthenticatedUser) {
    return this.students.getAnalytics(user.schoolId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.findOne(id, user.schoolId);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.update(id, dto, user.schoolId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.remove(id, user.schoolId);
  }
}

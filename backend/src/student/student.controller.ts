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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ArchiveStudentDto } from './dto/archive-student.dto';
import { BulkCreateStudentsDto } from './dto/bulk-create-students.dto';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentService } from './student.service';

/** UUID regex for lightweight query-param validation. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the actor descriptor the StudentService uses for audit
 * emission. Captures the JWT-derived identity plus the requesting
 * IP / user-agent for the audit row.
 */
function actorFromRequest(
  user: AuthenticatedUser,
  req: ExpressRequest,
) {
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/**
 * Role rules:
 *   • READS (GET) — any authenticated user (teachers need to see their roster).
 *   • WRITES (POST/PATCH/DELETE) — ADMIN only via `@Roles(Role.ADMIN)`.
 *   • ARCHIVE / RESTORE — ADMIN only. Mirrors the hard-delete role
 *     because archive replaces hard-delete for high-risk entities.
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
    @Query('archived') archived?: string,
  ) {
    // Phase DATA LIFECYCLE Part 1: `?archived=` driver for the
    // students-page tab. Values:
    //   • '1' / 'true'  → ONLY archived rows (the "Archived" tab)
    //   • 'all'         → both active + archived (admin reconcile)
    //   • anything else → default (non-archived only)
    const archivedFilter: boolean | 'all' | undefined =
      archived === '1' || archived === 'true'
        ? true
        : archived === 'all'
          ? 'all'
          : undefined;

    // `?unassigned=1` trumps `?classId=` — it means "students with no
    // class at all". Otherwise require a valid UUID if classId is given.
    if (unassigned === '1' || unassigned === 'true') {
      return this.students.findAll(user.schoolId, {
        classId: null,
        archived: archivedFilter,
      });
    }
    if (classId !== undefined) {
      if (!UUID_RE.test(classId)) {
        throw new BadRequestException('classId must be a UUID.');
      }
      return this.students.findAll(user.schoolId, {
        classId,
        archived: archivedFilter,
      });
    }
    return this.students.findAll(user.schoolId, { archived: archivedFilter });
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
    @Req() req: ExpressRequest,
  ) {
    // Phase DATA LIFECYCLE Part 1: DELETE is preserved for back-compat
    // but is now a soft-delete. The service routes it through
    // `archive()` so the audit trail + cascading FKs are preserved.
    return this.students.remove(id, user.schoolId, actorFromRequest(user, req));
  }

  /**
   * Soft-archive a student. ADMIN-only. Idempotent (no-op when already
   * archived). Emits STUDENT_ARCHIVED with the optional reason so the
   * audit trail shows who hid the record and why.
   */
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveStudentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.students.archive(
      id,
      user.schoolId,
      actorFromRequest(user, req),
      dto.reason ?? null,
    );
  }

  /**
   * Restore a previously archived student. ADMIN-only. Idempotent.
   * Emits STUDENT_RESTORED.
   */
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.students.restore(
      id,
      user.schoolId,
      actorFromRequest(user, req),
    );
  }
}

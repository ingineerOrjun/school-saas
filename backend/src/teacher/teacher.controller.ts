import {
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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CreateTeacherWithUserDto } from './dto/create-teacher-with-user.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { TeacherService } from './teacher.service';

/**
 * Teacher CRUD. All writes are ADMIN-only via class-level
 * `@Roles(Role.ADMIN)`. Reads inherit the same default — there's no
 * legitimate "list teachers" surface for non-admins in this app
 * (the teacher dashboard surfaces a teacher's own profile through
 * `/teachers/me/assignments`, not the list).
 *
 * Per-method @Roles override the class default where appropriate:
 *   • assignment-summary widens to ADMIN + STAFF (read-only summary).
 *   • DELETE widens to SUPER_ADMIN + ADMIN (Session 6c.3 — platform
 *     operators can soft-delete teachers cross-tenant).
 *
 * The bare `POST /teachers` route was removed in Session 6c-audit
 * Phase 2 — every teacher must be created via /create-with-user so
 * they get a linked User account. The deprecated handler had no
 * frontend callers and was a `BadRequestException` dead end.
 */
@Controller('teachers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class TeacherController {
  constructor(private readonly teachers: TeacherService) {}

  /**
   * One-step provisioning endpoint used by the Add Teacher dialog.
   * Creates a User (role=TEACHER) and a Teacher row in the same
   * transaction so the new teacher can log in immediately. Inherits
   * the class-level @Roles(Role.ADMIN) gate — non-admin tokens get
   * a 403 from RolesGuard.
   */
  @Post('create-with-user')
  @HttpCode(HttpStatus.CREATED)
  createWithUser(
    @Body() dto: CreateTeacherWithUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teachers.createWithUser(dto, user.schoolId);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.teachers.findAll(user.schoolId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teachers.findOne(id, user.schoolId);
  }

  /**
   * Compact assignment counts (`total / classes / sections / subjects`)
   * for one teacher. Used by the admin UI to render "3 Classes · 5
   * Subjects" without pulling the full row payload. Same counts are
   * embedded in the list/findOne responses; this endpoint is here for
   * any caller that wants ONLY the summary.
   */
  @Get(':id/assignment-summary')
  @Roles(Role.ADMIN, Role.STAFF)
  assignmentSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teachers.getAssignmentSummary(id, user.schoolId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teachers.update(id, dto, user.schoolId);
  }

  /**
   * Session 6c.3 — soft-delete a teacher's User row.
   *
   * Same URL + status code as before (DELETE /teachers/:id → 204), but
   * the behaviour shifted from hard-delete (cascading the User row +
   * Teacher row + assignments) to soft-delete (stamps `deletedAt` on
   * the User; Teacher + assignments stay so historical joins resolve).
   *
   * Role gate: previously the route inherited only `JwtAuthGuard` from
   * the class — meaning any authenticated user (including a TEACHER)
   * could hit it with a teacher id in their school. The new
   * `@Roles(SUPER_ADMIN, ADMIN)` decorator closes that hole at the
   * route layer; the service-level `softDelete` authorization
   * (SUPER_ADMIN anywhere, ADMIN same-school) is a second line of
   * defense behind it.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.teachers.remove(id, user.schoolId, {
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}

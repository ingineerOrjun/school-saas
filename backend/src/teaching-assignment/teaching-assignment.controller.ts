import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { BulkTeachingAssignmentsDto } from './dto/bulk-teaching-assignments.dto';
import { CreateTeachingAssignmentDto } from './dto/create-teaching-assignment.dto';
import { TeachingAssignmentService } from './teaching-assignment.service';

/**
 * Teaching-assignment endpoints. Routes are split across two prefixes
 * to keep URLs intuitive:
 *
 *   • GET    /teachers/me/assignments                → teacher: list MY rows
 *   • POST   /teachers/:teacherId/assignments       → admin: add row
 *   • POST   /teachers/:teacherId/assignments/bulk  → admin: reconcile diff
 *   • GET    /teachers/:teacherId/assignments       → admin: list rows
 *   • DELETE /teaching-assignments/:id               → admin: remove row
 *
 * ⚠️ ROUTE ORDER MATTERS. The literal `/teachers/me/assignments` MUST
 * be registered before any `/teachers/:teacherId/...` parametric
 * route. Express matches in declaration order, so if the parametric
 * route comes first, a request for `/teachers/me/assignments` matches
 * `/teachers/:teacherId/assignments` with `teacherId="me"`. That
 * route is admin-only — the RolesGuard rejects the teacher with
 * "This action is restricted to ADMIN" before ParseUUIDPipe gets a
 * chance to reject "me" as not-a-UUID. Hence the literal-first
 * ordering below.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeachingAssignmentController {
  private readonly logger = new Logger(TeachingAssignmentController.name);

  constructor(
    private readonly assignments: TeachingAssignmentService,
  ) {}

  // ---------- Teacher: my own assignments ----------
  // Declared FIRST so it wins over the parametric admin routes below
  // when the path is `/teachers/me/assignments`. See class-level
  // comment for the route-ordering rationale.

  /**
   * "What am I assigned to?" — used by the teacher dashboard to list
   * classes + subjects, and by the attendance/exam pages to filter
   * their dropdowns. TEACHER role only; admins have other ways to
   * inspect this (the per-teacher list endpoint below).
   */
  @Get('teachers/me/assignments')
  @Roles(Role.TEACHER)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    // Diagnostic stamp at the entry point: every successful pass past
    // the RolesGuard logs the authenticated identity. Pair this with
    // the deeper [listForUser] log in the service to triage "I assigned
    // them but nothing showed up" tickets — the controller log proves
    // the request authenticated as TEACHER, the service log proves the
    // userId resolved to the right Teacher row.
    this.logger.log(
      `[listMine] userId=${user.id} role=${user.role} schoolId=${user.schoolId}`,
    );
    return this.assignments.listForUser(user.id, user.schoolId);
  }

  // ---------- Admin: per-teacher CRUD ----------

  @Post('teachers/:teacherId/assignments')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN)
  create(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Body() dto: CreateTeachingAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.create(teacherId, dto, user.schoolId);
  }

  /**
   * Bulk reconcile — the grid UI sends the diff between the rendered
   * checkbox state and what was on the server when the dialog opened.
   * Single transaction; idempotent (safe to retry the same payload).
   * Returns the teacher's full assignment list after the change so
   * the client doesn't need a follow-up GET.
   */
  @Post('teachers/:teacherId/assignments/bulk')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  bulk(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @Body() dto: BulkTeachingAssignmentsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.bulk(teacherId, dto, user.schoolId);
  }

  @Get('teachers/:teacherId/assignments')
  @Roles(Role.ADMIN)
  list(
    @Param('teacherId', ParseUUIDPipe) teacherId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.listForTeacher(teacherId, user.schoolId);
  }

  @Delete('teaching-assignments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assignments.remove(id, user.schoolId);
  }
}

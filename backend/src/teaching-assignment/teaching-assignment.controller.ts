import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { CreateTeachingAssignmentDto } from './dto/create-teaching-assignment.dto';
import { TeachingAssignmentService } from './teaching-assignment.service';

/**
 * Teaching-assignment endpoints. Routes are split across two prefixes
 * to keep URLs intuitive:
 *
 *   • POST   /teachers/:teacherId/assignments  → admin: add row
 *   • GET    /teachers/:teacherId/assignments  → admin: list rows
 *   • DELETE /teaching-assignments/:id          → admin: remove row
 *   • GET    /teachers/me/assignments           → teacher: list MY rows
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeachingAssignmentController {
  constructor(
    private readonly assignments: TeachingAssignmentService,
  ) {}

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

  // ---------- Teacher: my own assignments ----------

  /**
   * "What am I assigned to?" — used by the teacher dashboard to list
   * classes + subjects, and by the attendance/exam pages to filter
   * their dropdowns. TEACHER role only; admins have other ways to
   * inspect this (the per-teacher list endpoint above).
   */
  @Get('teachers/me/assignments')
  @Roles(Role.TEACHER)
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.assignments.listForUser(user.id, user.schoolId);
  }
}

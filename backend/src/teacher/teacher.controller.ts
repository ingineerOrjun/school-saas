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
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { CreateTeacherWithUserDto } from './dto/create-teacher-with-user.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { TeacherService } from './teacher.service';

@Controller('teachers')
@UseGuards(JwtAuthGuard)
export class TeacherController {
  constructor(private readonly teachers: TeacherService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateTeacherDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teachers.create(dto, user.schoolId);
  }

  /**
   * One-step provisioning endpoint used by the Add Teacher dialog.
   * Creates a User (role=TEACHER) and a Teacher row in the same
   * transaction so the new teacher can log in immediately.
   * Admin-only — non-admin tokens get a 403 from RolesGuard.
   */
  @Post('create-with-user')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
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
  @UseGuards(RolesGuard)
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teachers.remove(id, user.schoolId);
  }
}

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
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CreateSectionDto } from './dto/create-section.dto';
import { ListSectionsQueryDto } from './dto/list-sections.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { SectionService } from './section.service';

/**
 * Section CRUD. Same shape as ClassController — writes are ADMIN-
 * only via the class-level @Roles(Role.ADMIN); the GET widens to
 * ADMIN + STAFF + TEACHER because section pickers populate the
 * same attendance / marks / exams surfaces TEACHER uses every day.
 *
 * Session 6c-audit Phase 2 fix: previously the class-level guards
 * stopped at JwtAuthGuard with no @Roles, so TEACHER could create,
 * rename, and DELETE sections in the school. The fail-open behavior
 * of RolesGuard made the missing @Roles invisible at a quick read.
 */
@Controller('sections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SectionController {
  constructor(private readonly sections: SectionService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateSectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sections.create(dto, user.schoolId);
  }

  /**
   * List sections (filtered to one class via the required `classId`
   * query param). Widens the class-level @Roles(ADMIN) gate to
   * ADMIN + STAFF + TEACHER so the attendance / marks-entry / bulk
   * exams pickers keep working for non-admin roles.
   */
  @Get()
  @Roles(Role.ADMIN, Role.STAFF, Role.TEACHER)
  findAll(
    @Query() query: ListSectionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sections.findByClass(query.classId, user.schoolId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sections.update(id, dto, user.schoolId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sections.remove(id, user.schoolId);
  }
}

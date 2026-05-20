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
import { ClassService } from './class.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

/**
 * Class CRUD. Writes (POST/PATCH/DELETE) are ADMIN-only via the
 * class-level `@Roles(Role.ADMIN)`. Reads (GET) widen to TEACHER +
 * STAFF via the per-method override because the classes list
 * populates pickers on /attendance, /exams/marks, /exams/bulk, the
 * student-list filter, etc. — every authenticated role with a
 * legitimate reason to be in the app needs that list.
 *
 * Session 6c-audit Phase 2 fix: prior to this change, the class-
 * level guards stopped at `@UseGuards(JwtAuthGuard)` with NO @Roles
 * anywhere — meaning any logged-in user (including TEACHER) could
 * delete classes. RolesGuard fails open when no @Roles metadata is
 * declared, so the previous decorator chain looked protected but
 * wasn't.
 */
@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ClassController {
  constructor(private readonly classes: ClassService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateClassDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.classes.create(dto, user.schoolId);
  }

  /**
   * List every class in the caller's tenant. Widens the class-level
   * @Roles(ADMIN) gate to ADMIN + STAFF + TEACHER — teachers need
   * the dropdown content on attendance, marks-entry, and the bulk
   * exams page.
   */
  @Get()
  @Roles(Role.ADMIN, Role.STAFF, Role.TEACHER)
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.classes.findAll(user.schoolId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.classes.update(id, dto, user.schoolId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.classes.remove(id, user.schoolId);
  }
}

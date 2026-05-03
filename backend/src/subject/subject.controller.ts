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
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { SubjectService } from './subject.service';

/**
 * Subject CRUD. Read access is open to any authenticated user (teachers
 * need the catalog to populate their assignment dropdowns); writes are
 * admin-only — same convention as the other config-surface endpoints.
 */
@Controller('subjects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubjectController {
  constructor(private readonly subjects: SubjectService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.subjects.findAll(user.schoolId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateSubjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subjects.create(dto, user.schoolId);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subjects.update(id, dto, user.schoolId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subjects.remove(id, user.schoolId);
  }
}

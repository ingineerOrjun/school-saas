import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { SchoolService } from './school.service';

/**
 * School profile endpoints. Reading is open to any authenticated user
 * in the tenant (any logged-in user can see their school's name).
 * Writes are admin-only — RolesGuard reads `@Roles(Role.ADMIN)` on the
 * PATCH handler and rejects non-admins with 403.
 */
@Controller('school')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchoolController {
  constructor(private readonly school: SchoolService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.school.get(user.schoolId);
  }

  @Patch()
  @Roles(Role.ADMIN)
  update(
    @Body() dto: UpdateSchoolDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.school.update(user.schoolId, dto);
  }
}

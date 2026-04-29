import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UserService } from './user.service';

/**
 * Admin-only user management. Both endpoints require ADMIN role —
 * teachers and other roles get a 403 from RolesGuard.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.users.list(user.schoolId);
  }

  @Patch(':id/role')
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Pass the actor's id so the service can enforce the self-role
    // guard ("you cannot change your own role").
    return this.users.updateRole(id, dto, user.schoolId, user.id);
  }
}

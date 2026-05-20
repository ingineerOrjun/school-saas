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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UserService } from './user.service';

/**
 * Admin-only user management. Both list + role-update endpoints
 * require ADMIN role — teachers and other roles get a 403 from
 * RolesGuard. The DELETE endpoint widens to allow SUPER_ADMIN as
 * well via a method-level @Roles override (school ADMINs delete
 * within their tenant; SUPER_ADMINs delete anywhere).
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

  /**
   * Session 6c.1 — soft-delete a user. Returns the updated row with
   * `deletedAt` set so the client can reflect the state transition
   * without a follow-up GET.
   *
   * Authorization layers:
   *   • RolesGuard (here) restricts the route to SUPER_ADMIN + ADMIN.
   *   • The service then enforces the cross-tenant rule: school ADMINs
   *     can only delete users in their own school; SUPER_ADMIN is
   *     unrestricted.
   *
   * 200 OK on success (not 204) — the response carries the new state.
   *
   * Errors:
   *   • 404 — user not found
   *   • 409 — already deactivated, or has active teaching assignments
   *   • 403 — actor cannot delete this target (cross-school admin, or
   *           self-deletion)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  softDelete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.users.softDelete(id, {
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}

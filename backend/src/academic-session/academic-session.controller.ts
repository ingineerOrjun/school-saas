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
import { AcademicSessionService } from './academic-session.service';
import { CreateAcademicSessionDto } from './dto/create-academic-session.dto';

/**
 * Academic-session endpoints. Read access is open to any authenticated
 * user (the session selector and dashboard need to know what's
 * available); writes are admin-only — same convention as the school
 * profile and user-management endpoints.
 */
@Controller('academic-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AcademicSessionController {
  constructor(private readonly sessions: AcademicSessionService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.list(user.schoolId);
  }

  /**
   * The school's currently-active session, or `null`. Lets the
   * frontend default the session selector without scanning the full
   * list itself.
   */
  @Get('active')
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.sessions.getActive(user.schoolId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateAcademicSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.create(dto, user.schoolId);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.setActive(id, user.schoolId);
  }

  /**
   * Lock the named session — every attendance/result/exam write
   * targeting it (or, for the active session, in general) starts
   * returning 400 with "session is locked". Lock is the precondition
   * for running promotion.
   */
  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  lock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.setLocked(id, user.schoolId, true);
  }

  /** Reverse of `lock`. Idempotent. */
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  unlock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.setLocked(id, user.schoolId, false);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sessions.remove(id, user.schoolId);
  }
}

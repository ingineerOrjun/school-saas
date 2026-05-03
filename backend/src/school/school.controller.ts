import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
 * in the tenant. Writes (name, logo upload, logo clear) are admin-only —
 * RolesGuard reads `@Roles(Role.ADMIN)` and rejects non-admins with 403.
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

  /**
   * Upload (or replace) the school logo. Field name is `file` to match
   * standard form conventions and what the frontend FormData sends.
   * The 2 MB limit is enforced both here (via Multer's `limits`) and
   * defensively in the service.
   */
  @Post('logo')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.school.setLogo(user.schoolId, file);
  }

  @Delete('logo')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  clearLogo(@CurrentUser() user: AuthenticatedUser) {
    return this.school.clearLogo(user.schoolId);
  }
}

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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CreateSectionDto } from './dto/create-section.dto';
import { ListSectionsQueryDto } from './dto/list-sections.dto';
import { UpdateSectionDto } from './dto/update-section.dto';
import { SectionService } from './section.service';

@Controller('sections')
@UseGuards(JwtAuthGuard)
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

  @Get()
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

import {
  BadRequestException,
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
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { StudentService } from './student.service';

/** UUID regex for lightweight query-param validation. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('students')
@UseGuards(JwtAuthGuard)
export class StudentController {
  constructor(private readonly students: StudentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.create(dto, user.schoolId);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('classId') classId?: string,
    @Query('unassigned') unassigned?: string,
  ) {
    // `?unassigned=1` trumps `?classId=` — it means "students with no
    // class at all". Otherwise require a valid UUID if classId is given.
    if (unassigned === '1' || unassigned === 'true') {
      return this.students.findAll(user.schoolId, { classId: null });
    }
    if (classId !== undefined) {
      if (!UUID_RE.test(classId)) {
        throw new BadRequestException('classId must be a UUID.');
      }
      return this.students.findAll(user.schoolId, { classId });
    }
    return this.students.findAll(user.schoolId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.findOne(id, user.schoolId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.update(id, dto, user.schoolId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.students.remove(id, user.schoolId);
  }
}

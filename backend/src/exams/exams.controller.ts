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
import { CreateExamDto } from './dto/create-exam.dto';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { QueryLedgerDto } from './dto/query-ledger.dto';
import { QueryResultsDto } from './dto/query-results.dto';
import { SaveResultsDto } from './dto/save-results.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { ExamService } from './exam.service';
import { ResultService } from './result.service';
import { SubjectService } from './subject.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ExamsController {
  constructor(
    private readonly exams: ExamService,
    private readonly subjects: SubjectService,
    private readonly results: ResultService,
  ) {}

  // ---------- Exam CRUD ----------

  @Post('exams')
  @HttpCode(HttpStatus.CREATED)
  createExam(
    @Body() dto: CreateExamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.exams.create(dto, user.schoolId);
  }

  @Get('exams')
  listExams(@CurrentUser() user: AuthenticatedUser) {
    return this.exams.findAll(user.schoolId);
  }

  @Patch('exams/:id')
  updateExam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.exams.update(id, dto, user.schoolId);
  }

  @Delete('exams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.exams.remove(id, user.schoolId);
  }

  // ---------- Subject management under an exam ----------

  @Post('exams/:id/subjects')
  @HttpCode(HttpStatus.CREATED)
  addSubject(
    @Param('id', ParseUUIDPipe) examId: string,
    @Body() dto: CreateSubjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subjects.create(examId, dto, user.schoolId);
  }

  @Delete('exam-subjects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSubject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subjects.remove(id, user.schoolId);
  }

  // ---------- Results ----------

  @Post('results/save')
  @HttpCode(HttpStatus.OK)
  saveResults(
    @Body() dto: SaveResultsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.save(dto, user.schoolId);
  }

  @Get('results')
  getReport(
    @Query() query: QueryResultsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.getStudentReport(
      query.examId,
      query.studentId,
      user.schoolId,
    );
  }

  /**
   * Class-wide grade ledger — one row per student in the class, one
   * column per subject in the exam. Drives the printable result sheet
   * at `/results/ledger`.
   */
  @Get('results/ledger')
  getClassLedger(
    @Query() query: QueryLedgerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.getClassLedger(
      query.examId,
      query.classId,
      user.schoolId,
    );
  }

  // ---------- Printable marksheet ----------

  @Get('reports/marksheet/:examId/:studentId')
  getMarksheet(
    @Param('examId', ParseUUIDPipe) examId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.results.getMarksheet(examId, studentId, user.schoolId);
  }
}

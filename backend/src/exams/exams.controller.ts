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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TeacherScopeService } from '../common/auth/teacher-scope.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ArchiveExamDto } from './dto/archive-exam.dto';
import { BulkSaveResultsDto } from './dto/bulk-save-results.dto';
import { CreateExamDto } from './dto/create-exam.dto';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { GridSaveResultsDto } from './dto/grid-save-results.dto';
import { QueryLedgerDto } from './dto/query-ledger.dto';
import { QueryResultsDto } from './dto/query-results.dto';
import { SaveResultsDto } from './dto/save-results.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { ExamService } from './exam.service';
import { ResultService } from './result.service';
import { SubjectService } from './subject.service';

/**
 * Role rules:
 *   • Exam CRUD + exam-subject CRUD → ADMIN + STAFF.
 *   • Save results (single + bulk) → ADMIN + STAFF + TEACHER.
 *     - ADMIN/STAFF have school-wide scope (no class restriction).
 *     - TEACHER restricted to students in their assigned class — the
 *       ownership check happens inside `assertResultsEntryAccess` /
 *       `assertBulkMarksAccess`.
 *   • Reads (list / report / marksheet / ledger) → any auth user;
 *     teacher-class scoping is applied per-request where applicable.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamsController {
  constructor(
    private readonly exams: ExamService,
    private readonly subjects: SubjectService,
    private readonly results: ResultService,
    private readonly scope: TeacherScopeService,
  ) {}

  // ---------- Exam CRUD ----------

  @Post('exams')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN, Role.STAFF)
  createExam(
    @Body() dto: CreateExamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.exams.create(dto, user.schoolId, user.id);
  }

  @Get('exams')
  listExams(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sessionId') sessionId?: string,
    @Query('archived') archived?: string,
  ) {
    // Optional ?sessionId filter — when omitted, every exam in the
    // school comes back. Backward-compatible with callers that
    // haven't adopted the session selector yet.
    //
    // Phase DATA LIFECYCLE Part 1: `?archived=` driver for the exams-
    // page tab. '1' / 'true' → only archived; 'all' → both; else
    // active-only default.
    const archivedFilter: boolean | 'all' | undefined =
      archived === '1' || archived === 'true'
        ? true
        : archived === 'all'
          ? 'all'
          : undefined;
    return this.exams.findAll(user.schoolId, sessionId, archivedFilter);
  }

  /**
   * Per-exam analytics for the Analytics Center. Public (any
   * authenticated user) — same rationale as the existing GET /exams
   * route. The aggregated payload doesn't expose anything you can't
   * already see by walking the per-student marksheet.
   */
  @Get('exams/:id/analytics')
  getAnalytics(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.exams.getAnalytics(id, user.schoolId);
  }

  @Patch('exams/:id')
  @Roles(Role.ADMIN, Role.STAFF)
  updateExam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.exams.update(id, dto, user.schoolId, user.id);
  }

  @Delete('exams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.STAFF)
  removeExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    // Phase DATA LIFECYCLE Part 1: DELETE is preserved for back-compat
    // but routes through `archiveExam()` so result history isn't lost.
    return this.exams.remove(id, user.schoolId, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Soft-archive an exam. ADMIN-only — same scope as the underlying
   * delete. Idempotent. Emits EXAM_ARCHIVED with the optional reason.
   */
  @Post('exams/:id/archive')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  archiveExam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveExamDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.exams.archiveExam(
      id,
      user.schoolId,
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
      dto.reason ?? null,
    );
  }

  /**
   * Restore a previously archived exam. ADMIN-only. Idempotent. Emits
   * EXAM_RESTORED.
   */
  @Post('exams/:id/restore')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  restoreExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.exams.restoreExam(id, user.schoolId, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Publication lock — ADMIN-only. After this lands, every Result
   * write path rejects with HTTP 423 LOCKED until /unlock fires.
   * Idempotent (no-op when already locked). Emits MARKS_LOCKED to
   * the platform audit stream with the actor + examId for the trail.
   */
  @Patch('exams/:id/lock')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  lockExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.exams.lockExam(id, user.schoolId, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Publication unlock — ADMIN-only. Re-enables marks edits.
   * Idempotent. Emits MARKS_UNLOCKED with the actor + examId.
   */
  @Patch('exams/:id/unlock')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  unlockExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.exams.unlockExam(id, user.schoolId, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Phase ACADEMIC TRANSITION SAFETY Part 4 — publish marks. ADMIN-
   * only. Idempotent. After this lands, parent-facing marksheets
   * show the exam as Published (icon + tooltip).
   *
   * Orthogonal to lock: a published exam can still be unlocked for
   * a correction; relock when done. The audit trail captures every
   * toggle separately.
   */
  @Patch('exams/:id/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  publishExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.exams.publishExam(id, user.schoolId, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Phase ACADEMIC TRANSITION SAFETY Part 4 — unpublish marks
   * (rollback to Draft). ADMIN-only. Idempotent. Rejects locked
   * exams with 409 — unlock first if a correction is needed.
   */
  @Patch('exams/:id/unpublish')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN)
  unpublishExam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: ExpressRequest,
  ) {
    return this.exams.unpublishExam(id, user.schoolId, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  // ---------- Subject management under an exam ----------

  @Post('exams/:id/subjects')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.ADMIN, Role.STAFF)
  addSubject(
    @Param('id', ParseUUIDPipe) examId: string,
    @Body() dto: CreateSubjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subjects.create(examId, dto, user.schoolId);
  }

  @Delete('exam-subjects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.STAFF)
  removeSubject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subjects.remove(id, user.schoolId);
  }

  // ---------- Results ----------

  @Post('results/save')
  @HttpCode(HttpStatus.OK)
  async saveResults(
    @Body() dto: SaveResultsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Strict marks-entry enforcement: the teacher must own a
    // TeachingAssignment that matches BOTH the student's class+section
    // AND every subject they're trying to grade. The check is batched
    // — one round-trip's worth of validation per save call regardless
    // of how many entries are in the payload. Admins bypass.
    //
    // The guard 403s with "You are not assigned to this subject/class"
    // when any entry's subject isn't in the teacher's allowed set.
    await this.scope.assertResultsEntryAccess(user, {
      studentId: dto.studentId,
      examSubjectIds: dto.entries.map((e) => e.subjectId),
    });
    return this.results.save(dto, user.schoolId, user.id);
  }

  /**
   * Bulk marks entry — one subject, many students, one transaction.
   *
   * The legacy `POST /results/save` (per-student) endpoint above is
   * still mounted and unchanged: this is purely additive. The two
   * coexist because they serve different teacher workflows — one
   * student deeply (with the full GPA preview) vs. a whole class
   * shallowly (one subject column at a time).
   *
   * Authorization is the LOOSER bulk rule: a class-bound assignment
   * (assignment.sectionId IS NULL) authorizes any section of the
   * class. See `assertBulkMarksAccess` for the full rule.
   */
  @Post('results/bulk-save')
  @HttpCode(HttpStatus.OK)
  async bulkSaveResults(
    @Body() dto: BulkSaveResultsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.scope.assertBulkMarksAccess(user, {
      classId: dto.classId,
      sectionId: dto.sectionId ?? null,
      examSubjectId: dto.subjectId,
    });
    return this.results.bulkSave(dto, user.schoolId, user.id);
  }

  /**
   * Grid roster — single-call payload that hydrates the
   * `/exams/marks-entry` grid: exam + class + section + subject
   * metadata, the full student roster, and each student's existing
   * result for the (exam, subject). Same scope rule + authorization
   * as `bulk-save` so admins/staff/teachers can only fetch rosters
   * they're allowed to grade.
   */
  @Get('results/grid-roster')
  async getGridRoster(
    @Query('examId', ParseUUIDPipe) examId: string,
    @Query('classId', ParseUUIDPipe) classId: string,
    @Query('subjectId', ParseUUIDPipe) subjectId: string,
    @Query('sectionId') sectionId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const normalizedSectionId = sectionId && sectionId.length > 0 ? sectionId : null;
    await this.scope.assertBulkMarksAccess(user, {
      classId,
      sectionId: normalizedSectionId,
      examSubjectId: subjectId,
    });
    return this.results.getGridRoster(
      { examId, classId, sectionId: normalizedSectionId, subjectId },
      user.schoolId,
    );
  }

  /**
   * Grid save — fast bulk path used by `/exams/marks-entry`. Same
   * scope rule as `bulk-save` (a class-bound assignment authorizes
   * any section). Coexists with `bulk-save` and the per-student
   * `save` — this is purely additive, not a replacement.
   */
  @Post('results/grid-save')
  @HttpCode(HttpStatus.OK)
  async gridSaveResults(
    @Body() dto: GridSaveResultsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.scope.assertBulkMarksAccess(user, {
      classId: dto.classId,
      sectionId: dto.sectionId ?? null,
      examSubjectId: dto.subjectId,
    });
    return this.results.gridSave(dto, user.schoolId, user.id);
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

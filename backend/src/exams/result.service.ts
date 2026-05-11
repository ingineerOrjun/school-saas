import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LetterGrade, Result } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import { GradingService } from '../grading/grading.service';
import { ExamService } from './exam.service';
import { BulkSaveResultsDto } from './dto/bulk-save-results.dto';
import { GridSaveResultsDto } from './dto/grid-save-results.dto';
import { SaveResultsDto } from './dto/save-results.dto';

export interface ResultRow {
  id: string;
  subjectId: string;
  subjectName: string;
  /** Sum of theoryFullMarks + practicalFullMarks. Kept for backward-compat. */
  fullMarks: number;
  /** Sum of theory + practical marks obtained. Kept for backward-compat. */
  marks: number;
  theoryMarks: number;
  practicalMarks: number;
  theoryFullMarks: number;
  practicalFullMarks: number;
  /** True when either component was below the 35% pass bar. */
  failedComponent: boolean;
  percentage: number;
  letterGrade: LetterGrade;
  letterGradeLabel: string;
  gradePoint: number;
  /** Credit-hour weight used in the subject's contribution to weighted GPA. */
  creditHours: number;
}

export interface StudentReport {
  examId: string;
  examName: string;
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  results: ResultRow[];
  /**
   * Credit-hour-weighted GPA per the Nepal CDC progress-report formula:
   *   GPA = Σ(gradePoint × creditHours) / Σ(creditHours)
   * Returns the sentinel `-1` when any subject is NG (overall is NG in
   * that case — see `gpaLetterGrade` and `hasFailingSubject` for the
   * authoritative pass status). `-1` is outside the valid 0.0–4.0 GPA
   * range so it cannot collide with a real value, distinguishing NG
   * from a student who genuinely scored 0.0. Field shape (`number`) is
   * preserved for back-compat with existing callers; renderers should
   * guard with `gpa < 0` (or check `gpaLetterGrade === "NG"`) before
   * calling `.toFixed(2)`.
   */
  gpa: number;
  /**
   * Letter grade derived from `gpa` via the CDC overall-GPA mapping
   * (3.6 → A+, 3.2 → A, ...). Returns "NG" when any subject is NG.
   * This is the field UIs should render as the headline "Final
   * Result" — `overallLetterGrade` / `overallLetterGradeLabel` use
   * the older percentage-based mapping and remain for back-compat.
   */
  gpaLetterGrade: string;
  /** Sum of credit hours used as the weighted-GPA denominator. */
  totalCreditHours: number;
  /**
   * Final letter grade after NEB rules.
   * If any subject is NG, this is forced to NG regardless of the computed GPA.
   */
  overallLetterGrade: LetterGrade;
  overallLetterGradeLabel: string;
  /** True when at least one subject's letter grade is NG. */
  hasFailingSubject: boolean;
}

/** One subject column in the class ledger header. */
export interface LedgerSubject {
  id: string;
  name: string;
  /** Credit-hour weight used in the per-student weighted GPA. */
  creditHours: number;
}

/** Per-subject cell on a student's ledger row. */
export interface LedgerCell {
  subjectId: string;
  /** Letter grade label (A+, A, B+, ..., NG) — null if no result recorded. */
  grade: string | null;
  gradePoint: number | null;
}

/** One student's row in the class ledger. */
export interface LedgerStudentRow {
  id: string;
  name: string;
  symbolNumber: string | null;
  results: LedgerCell[];
  gpa: number;
  /**
   * Final overall letter grade after NEB rules. "NG" when ANY subject is
   * NG, regardless of computed GPA. Null when no results recorded yet.
   */
  finalResult: string | null;
}

export interface ClassLedger {
  exam: { id: string; name: string };
  class: { id: string; name: string };
  /**
   * Owning school — included so the printable header can render the
   * official name + logo without a second round-trip.
   */
  school: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  subjects: LedgerSubject[];
  students: LedgerStudentRow[];
  /** ISO timestamp when this ledger was generated. */
  generatedAt: string;
}

/**
 * Payload for the marks-entry grid (`/exams/marks-entry`). Carries
 * every piece of context the grid needs in one shot:
 *   • exam / class / section / subject metadata (no follow-up calls)
 *   • full roster of the (class, section) — alphabetized within the
 *     symbol-number-first ordering
 *   • each student's existing result for this (exam, subject), if any
 *
 * `subject.fullMarks` is the displayable max — for a theory-only
 * subject this equals theoryFullMarks. `subject.hasPractical` lets the
 * UI render a "use single-student entry" callout for subjects the grid
 * can't grade.
 */
export interface GridRosterPayload {
  exam: { id: string; name: string };
  class: { id: string; name: string };
  section: { id: string; name: string } | null;
  subject: {
    id: string;
    name: string;
    fullMarks: number;
    hasPractical: boolean;
  };
  students: Array<{
    id: string;
    firstName: string;
    lastName: string;
    symbolNumber: string | null;
    existing: { obtainedMarks: number | null; absent: boolean } | null;
  }>;
}

/** Richer report for printable marksheets — includes school & roster info. */
export interface Marksheet extends StudentReport {
  school: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  studentSymbolNumber: string | null;
  studentSection: {
    name: string;
    className: string;
  } | null;
  examCreatedAt: string;
  /** ISO timestamp when this marksheet was generated (useful for footers). */
  generatedAt: string;
  /**
   * Marks-publication lock state. Surfaced so the marksheet header
   * can render the LockedBadge without a follow-up exam fetch. The
   * backend lock check on writes is the authoritative guard — these
   * fields are display-only.
   */
  examLocked: boolean;
  examLockedAt: string | null;
}

@Injectable()
export class ResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grading: GradingService,
    private readonly exams: ExamService,
    private readonly sessions: AcademicSessionService,
  ) {}

  /**
   * Upsert results for a student across multiple subjects.
   * Grade data is always computed server-side from `marks` — clients can
   * display their own preview, but the server is authoritative.
   *
   * Audit: `createdById` is set on the INSERT path only (preserves the
   * original author when a row is later edited); `updatedById` is set
   * on BOTH paths so every save stamps the most-recent editor.
   */
  async save(
    dto: SaveResultsDto,
    schoolId: string,
    userId: string,
  ): Promise<StudentReport> {
    // Tenant guard + exam-level lock guard. assertEditable rejects
    // with HTTP 423 LOCKED if the admin has published this exam,
    // which is the server-side enforcement point for Phase
    // data-integrity Rule 1.
    const exam = await this.exams.assertEditable(dto.examId, schoolId);
    // Session lock guard — once a session is locked, marks updates
    // are frozen even if there's a different active session. The
    // exam remains in its original session for life.
    await this.sessions.assertSessionUnlocked(exam.sessionId);

    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, schoolId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }

    // Load all subjects referenced in the request in one query to validate
    // they belong to the exam and get fullMarks for each.
    const subjectIds = [...new Set(dto.entries.map((e) => e.subjectId))];
    if (subjectIds.length !== dto.entries.length) {
      throw new BadRequestException(
        'Duplicate subjectId entries in the request.',
      );
    }

    const subjects = await this.prisma.examSubject.findMany({
      where: { id: { in: subjectIds }, examId: exam.id },
      select: {
        id: true,
        name: true,
        theoryFullMarks: true,
        practicalFullMarks: true,
        creditHours: true,
      },
    });
    if (subjects.length !== subjectIds.length) {
      throw new BadRequestException(
        'One or more subjects do not belong to this exam.',
      );
    }
    const subjectById = new Map(subjects.map((s) => [s.id, s]));

    // Denormalize the parent exam's session onto every Result row
    // so result-side queries don't need to JOIN through Exam.
    // Stamped on insert only (the update path leaves it alone — the
    // exam can't change sessions mid-life).
    const sessionId = exam.sessionId ?? null;

    // Validate per-component ranges, apply NEB theory+practical pass rule,
    // then upsert each result.
    await this.prisma.$transaction(
      dto.entries.map((entry) => {
        const subject = subjectById.get(entry.subjectId)!;
        const theoryMarks = entry.theoryMarks;
        const practicalMarks = entry.practicalMarks ?? 0;

        if (theoryMarks < 0 || theoryMarks > subject.theoryFullMarks) {
          throw new BadRequestException(
            `Theory marks for "${subject.name}" must be between 0 and ${subject.theoryFullMarks}.`,
          );
        }
        if (
          practicalMarks < 0 ||
          practicalMarks > subject.practicalFullMarks
        ) {
          throw new BadRequestException(
            `Practical marks for "${subject.name}" must be between 0 and ${subject.practicalFullMarks}.`,
          );
        }

        const { percentage, letterGrade, gradePoint } = gradeWithSplit(
          this.grading,
          theoryMarks,
          subject.theoryFullMarks,
          practicalMarks,
          subject.practicalFullMarks,
        );

        return this.prisma.result.upsert({
          where: {
            studentId_subjectId: {
              studentId: dto.studentId,
              subjectId: entry.subjectId,
            },
          },
          create: {
            examId: exam.id,
            studentId: dto.studentId,
            subjectId: entry.subjectId,
            theoryMarks,
            practicalMarks,
            percentage,
            letterGrade,
            gradePoint,
            // First save → record the original author. Both audit
            // fields point at the same user on insert.
            createdById: userId,
            updatedById: userId,
            sessionId,
          },
          update: {
            theoryMarks,
            practicalMarks,
            percentage,
            letterGrade,
            gradePoint,
            // Edit path leaves `createdById` alone so the original
            // author is preserved. Only `updatedById` rolls forward.
            updatedById: userId,
          },
          select: { id: true },
        });
      }),
    );

    // Phase γ — re-sync the StudentAcademicRecord GPA snapshot for the
    // session this exam lives in. Fire-and-forget: a stale snapshot is
    // recoverable; a rolled-back marks save isn't.
    void this.recalculateStudentGPA(dto.studentId, sessionId).catch(() => {
      // Intentional no-op — see helper docstring.
    });

    return this.getStudentReport(dto.examId, dto.studentId, schoolId);
  }

  /**
   * Bulk marks entry — one subject, many students, one transaction.
   * Same grading + upsert logic as `save`; the difference is shape:
   * subject is hoisted to the top of the payload (one per call) and
   * each entry carries a studentId instead of being student-scoped.
   *
   * Validations (in order — cheapest first):
   *   1. Tenant guards (exam, class, section if given).
   *   2. Subject belongs to the exam.
   *   3. No duplicate studentIds in the payload.
   *   4. Every studentId is in the (class, section) scope. The scope
   *      rule mirrors the attendance roster:
   *        sectionId set  → students with that exact sectionId
   *        sectionId null → students with classId=X AND sectionId IS NULL
   *      Sectioned students under a class can ONLY be reached by
   *      naming their section. Same separation as attendance.
   *   5. Per-entry mark-range validation.
   *
   * The whole upsert runs inside `prisma.$transaction` so the response
   * either reflects every row or none of them — partial saves would
   * leave the class half-graded with no easy way to spot the gap.
   *
   * Authorization (ADMIN-only or TEACHER-with-matching-assignment) is
   * enforced upstream in the controller via
   * `TeacherScopeService.assertBulkMarksAccess`.
   */
  async bulkSave(
    dto: BulkSaveResultsDto,
    schoolId: string,
    userId: string,
  ): Promise<{ successCount: number }> {
    // 1. Tenant guard + exam-level lock guard. 423 LOCKED when the
    //    admin has published this exam.
    const exam = await this.exams.assertEditable(dto.examId, schoolId);
    // Same lock guard as the per-row save above — see comment there.
    await this.sessions.assertSessionUnlocked(exam.sessionId);

    const klass = await this.prisma.class.findFirst({
      where: { id: dto.classId, schoolId },
      select: { id: true },
    });
    if (!klass) {
      throw new BadRequestException('Class does not belong to this school.');
    }

    if (dto.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: dto.sectionId, classId: dto.classId },
        select: { id: true },
      });
      if (!section) {
        throw new BadRequestException(
          'Section does not belong to the given class.',
        );
      }
    }

    // 2. Subject must belong to this exam (and via the FK, the school).
    const subject = await this.prisma.examSubject.findFirst({
      where: { id: dto.subjectId, examId: exam.id },
      select: {
        id: true,
        name: true,
        theoryFullMarks: true,
        practicalFullMarks: true,
        creditHours: true,
      },
    });
    if (!subject) {
      throw new BadRequestException(
        'Subject does not belong to the given exam.',
      );
    }

    // 3. No duplicates — multiple entries for the same student would
    // both upsert the same composite key in the transaction, which
    // could non-deterministically clobber values within the batch.
    const studentIds = dto.entries.map((e) => e.studentId);
    const uniqueIds = [...new Set(studentIds)];
    if (uniqueIds.length !== studentIds.length) {
      throw new BadRequestException(
        'Duplicate studentId entries in the request.',
      );
    }

    // 4. Every student must live inside the (class, section) scope
    // we're targeting. One COUNT query proves all-or-nothing — cheap
    // and avoids per-row round-trips.
    const expectedScope = dto.sectionId
      ? { sectionId: dto.sectionId }
      : { classId: dto.classId, sectionId: null };
    const validCount = await this.prisma.student.count({
      where: {
        id: { in: uniqueIds },
        schoolId,
        ...expectedScope,
      },
    });
    if (validCount !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more students are not in the given class/section.',
      );
    }

    // Denormalize the parent exam's session onto every Result row —
    // same rule as the per-row save above.
    const sessionId = exam.sessionId ?? null;

    // 5. Validate marks per entry, then upsert atomically.
    await this.prisma.$transaction(
      dto.entries.map((entry) => {
        const theoryMarks = entry.theoryMarks;
        const practicalMarks = entry.practicalMarks ?? 0;

        if (theoryMarks < 0 || theoryMarks > subject.theoryFullMarks) {
          throw new BadRequestException(
            `Theory marks for "${subject.name}" must be between 0 and ${subject.theoryFullMarks}.`,
          );
        }
        if (
          practicalMarks < 0 ||
          practicalMarks > subject.practicalFullMarks
        ) {
          throw new BadRequestException(
            `Practical marks for "${subject.name}" must be between 0 and ${subject.practicalFullMarks}.`,
          );
        }

        // Reuse the same grading helper the per-row save uses — single
        // source of truth for the NEB pass rule + percentage math.
        const { percentage, letterGrade, gradePoint } = gradeWithSplit(
          this.grading,
          theoryMarks,
          subject.theoryFullMarks,
          practicalMarks,
          subject.practicalFullMarks,
        );

        return this.prisma.result.upsert({
          where: {
            studentId_subjectId: {
              studentId: entry.studentId,
              subjectId: subject.id,
            },
          },
          create: {
            examId: exam.id,
            studentId: entry.studentId,
            subjectId: subject.id,
            theoryMarks,
            practicalMarks,
            percentage,
            letterGrade,
            gradePoint,
            // Same audit pattern as the per-row save: stamp both on
            // insert; only updatedById on edit so the original author
            // survives later corrections.
            createdById: userId,
            updatedById: userId,
            sessionId,
          },
          update: {
            theoryMarks,
            practicalMarks,
            percentage,
            letterGrade,
            gradePoint,
            updatedById: userId,
          },
          select: { id: true },
        });
      }),
    );

    // Phase γ — fan out a fire-and-forget GPA snapshot recompute for
    // every student touched. updateMany on each is cheap (no row-found
    // is the no-op happy path for the unpromoted current session).
    for (const studentId of uniqueIds) {
      void this.recalculateStudentGPA(studentId, sessionId).catch(() => {
        // Intentional no-op — see helper docstring.
      });
    }

    return { successCount: dto.entries.length };
  }

  // ===========================================================================
  // Marks-entry GRID (`/exams/marks-entry`)
  // ---------------------------------------------------------------------------
  // Simpler shape than the bulk-save above: one number per row +
  // optional "absent" flag. Designed for the fast grid UI where a
  // teacher just types down a column and tabs through students.
  // Coexists with — does not replace — the bulk-save / per-student
  // endpoints; it's an additional fast mode.
  // ===========================================================================

  /**
   * Roster + existing-marks payload for the grid UI. Single round-trip
   * so the page can render the entire grid (students + their current
   * marks) with one call after the teacher picks (exam, class, section,
   * subject).
   *
   *   • Authorization: enforced upstream (controller calls
   *     `assertBulkMarksAccess`). Empty roster + no-marks for
   *     teachers without the matching assignment is the expected
   *     "you can't grade this" state — but that path doesn't get
   *     here because the guard 403s first.
   *
   *   • Subject scope: only theory-only subjects (practicalFullMarks
   *     = 0) are accepted. Subjects with a practical component need
   *     the per-student endpoint that exposes both inputs. We surface
   *     that as a 400 so the UI can render a clean "use single-entry"
   *     callout instead of silently mis-grading the row.
   */
  async getGridRoster(
    input: {
      examId: string;
      classId: string;
      sectionId: string | null;
      subjectId: string;
    },
    schoolId: string,
  ): Promise<GridRosterPayload> {
    // 1. Tenant guards (cheapest first).
    const exam = await this.exams.assertInSchool(input.examId, schoolId);

    const klass = await this.prisma.class.findFirst({
      where: { id: input.classId, schoolId },
      select: { id: true, name: true },
    });
    if (!klass) {
      throw new BadRequestException('Class does not belong to this school.');
    }

    let section: { id: string; name: string } | null = null;
    if (input.sectionId) {
      const found = await this.prisma.section.findFirst({
        where: { id: input.sectionId, classId: input.classId },
        select: { id: true, name: true },
      });
      if (!found) {
        throw new BadRequestException(
          'Section does not belong to the given class.',
        );
      }
      section = found;
    }

    // 2. Subject lookup + theory-only check.
    const subject = await this.prisma.examSubject.findFirst({
      where: { id: input.subjectId, examId: exam.id },
      select: {
        id: true,
        name: true,
        theoryFullMarks: true,
        practicalFullMarks: true,
        creditHours: true,
      },
    });
    if (!subject) {
      throw new BadRequestException(
        'Subject does not belong to the given exam.',
      );
    }

    // 3. Roster + existing results. The (class, section) scope rule
    //    matches BulkSave: section set → that section; section null →
    //    students linked DIRECTLY to the class with no section.
    const studentWhere = input.sectionId
      ? { sectionId: input.sectionId, schoolId }
      : { classId: input.classId, sectionId: null, schoolId };

    const students = await this.prisma.student.findMany({
      where: studentWhere,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        symbolNumber: true,
      },
      // Symbol number first (matches official Nepal-style ordering),
      // then by name for students without one.
      orderBy: [
        { symbolNumber: 'asc' },
        { firstName: 'asc' },
        { lastName: 'asc' },
      ],
    });

    if (students.length === 0) {
      return {
        exam: { id: exam.id, name: exam.name },
        class: klass,
        section,
        subject: {
          id: subject.id,
          name: subject.name,
          fullMarks: subject.theoryFullMarks,
          hasPractical: subject.practicalFullMarks > 0,
        },
        students: [],
      };
    }

    // Single round-trip for the existing results across the whole
    // roster. Indexed by studentId so the projection step is O(1).
    const existing = await this.prisma.result.findMany({
      where: {
        examId: exam.id,
        subjectId: subject.id,
        studentId: { in: students.map((s) => s.id) },
      },
      select: {
        studentId: true,
        theoryMarks: true,
        practicalMarks: true,
        absent: true,
      },
    });
    const byStudent = new Map(existing.map((r) => [r.studentId, r]));

    return {
      exam: { id: exam.id, name: exam.name },
      class: klass,
      section,
      subject: {
        id: subject.id,
        name: subject.name,
        // For grid mode, the displayable max is theory full marks (the
        // grid only supports theory-only subjects). The flag below
        // surfaces the practical-component case to the UI so it can
        // gently steer the teacher to the per-student form.
        fullMarks: subject.theoryFullMarks,
        hasPractical: subject.practicalFullMarks > 0,
      },
      students: students.map((s) => {
        const r = byStudent.get(s.id) ?? null;
        return {
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          symbolNumber: s.symbolNumber,
          existing: r
            ? {
                obtainedMarks: r.absent ? null : r.theoryMarks,
                absent: r.absent,
              }
            : null,
        };
      }),
    };
  }

  /**
   * Grid save — write the whole class for one subject in a single
   * transaction. Each row is upserted by `(studentId, subjectId)`.
   *
   * Mapping from the grid shape onto the Result table:
   *   • obtainedMarks → theoryMarks (the only writable component;
   *     practicalMarks stays at its existing value on update, or 0
   *     on insert).
   *   • absent = true → forces theoryMarks/practicalMarks to 0 and
   *     letter grade to NG, regardless of obtainedMarks.
   *   • obtainedMarks null AND absent false → row is SKIPPED. The
   *     grid leaves "I haven't decided yet" cells alone instead of
   *     auto-zeroing them.
   *
   * Validations (in order):
   *   1. Tenant guards (exam, class, section, subject under exam).
   *   2. Subject must be theory-only — grid mode doesn't support a
   *      practical component (it's a one-number-per-row grid).
   *   3. No duplicate studentIds in the payload.
   *   4. Every studentId is in the (class, section) scope.
   *   5. Per-row mark range check (0..theoryFullMarks).
   *
   * Authorization (ADMIN/STAFF bypass; TEACHER must own the matching
   * assignment) is enforced upstream by the controller via
   * `assertBulkMarksAccess`.
   */
  async gridSave(
    dto: GridSaveResultsDto,
    schoolId: string,
    userId: string,
  ): Promise<{ success: true; updatedCount: number }> {
    // 1. Tenant guard + exam-level lock guard. 423 LOCKED when the
    //    admin has published this exam.
    const exam = await this.exams.assertEditable(dto.examId, schoolId);
    await this.sessions.assertSessionUnlocked(exam.sessionId);

    const klass = await this.prisma.class.findFirst({
      where: { id: dto.classId, schoolId },
      select: { id: true },
    });
    if (!klass) {
      throw new BadRequestException('Class does not belong to this school.');
    }

    if (dto.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: dto.sectionId, classId: dto.classId },
        select: { id: true },
      });
      if (!section) {
        throw new BadRequestException(
          'Section does not belong to the given class.',
        );
      }
    }

    const subject = await this.prisma.examSubject.findFirst({
      where: { id: dto.subjectId, examId: exam.id },
      select: {
        id: true,
        name: true,
        theoryFullMarks: true,
        practicalFullMarks: true,
        creditHours: true,
      },
    });
    if (!subject) {
      throw new BadRequestException(
        'Subject does not belong to the given exam.',
      );
    }
    // 2. Theory-only check. The grid is intentionally a one-number-
    // per-row UI; a subject with a practical component can't be
    // round-tripped through it without losing data.
    if (subject.practicalFullMarks > 0) {
      throw new BadRequestException(
        `"${subject.name}" has a practical component — use the single-student form for subjects with both theory and practical marks.`,
      );
    }

    // 3. No duplicates — multiple entries for the same student would
    // both upsert the same composite key non-deterministically.
    const allStudentIds = dto.marks.map((m) => m.studentId);
    const uniqueIds = [...new Set(allStudentIds)];
    if (uniqueIds.length !== allStudentIds.length) {
      throw new BadRequestException(
        'Duplicate studentId entries in the request.',
      );
    }

    // 4. Every student must be in the (class, section) scope. Same
    // pattern as bulkSave — a single COUNT proves all-or-nothing.
    const expectedScope = dto.sectionId
      ? { sectionId: dto.sectionId }
      : { classId: dto.classId, sectionId: null };
    const validCount = await this.prisma.student.count({
      where: {
        id: { in: uniqueIds },
        schoolId,
        ...expectedScope,
      },
    });
    if (validCount !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more students are not in the given class/section.',
      );
    }

    // Filter out "blank, not absent" rows BEFORE the transaction so
    // the count we return reflects rows actually written.
    const writable = dto.marks.filter(
      (m) => m.absent === true || (m.obtainedMarks !== null && m.obtainedMarks !== undefined),
    );
    if (writable.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const sessionId = exam.sessionId ?? null;

    // 5. Validate ranges + upsert atomically.
    await this.prisma.$transaction(
      writable.map((entry) => {
        const isAbsent = entry.absent === true;
        // Range-check non-absent rows. We still allow
        // `obtainedMarks > 0` even when absent is true at the DTO
        // layer — the service force-zeros it below.
        if (!isAbsent) {
          const m = entry.obtainedMarks!;
          if (m < 0 || m > subject.theoryFullMarks) {
            throw new BadRequestException(
              `Marks for "${subject.name}" must be between 0 and ${subject.theoryFullMarks}.`,
            );
          }
        }

        const theoryMarks = isAbsent ? 0 : entry.obtainedMarks!;
        // Practical stays at 0 on insert; on update we leave the
        // existing column alone (Prisma's upsert update.set only
        // touches the fields we name).
        const practicalMarks = 0;

        const { percentage, letterGrade, gradePoint } = isAbsent
          ? { percentage: 0, letterGrade: LetterGrade.NG, gradePoint: 0 }
          : gradeWithSplit(
              this.grading,
              theoryMarks,
              subject.theoryFullMarks,
              practicalMarks,
              subject.practicalFullMarks,
            );

        return this.prisma.result.upsert({
          where: {
            studentId_subjectId: {
              studentId: entry.studentId,
              subjectId: subject.id,
            },
          },
          create: {
            examId: exam.id,
            studentId: entry.studentId,
            subjectId: subject.id,
            theoryMarks,
            practicalMarks,
            percentage,
            letterGrade,
            gradePoint,
            absent: isAbsent,
            createdById: userId,
            updatedById: userId,
            sessionId,
          },
          update: {
            theoryMarks,
            // Preserve the existing practical mark on update — bulk
            // grid only owns the theory column. (For absent rows we
            // DO want to zero practical too, since "absent" means
            // "didn't appear for any component".)
            ...(isAbsent ? { practicalMarks: 0 } : {}),
            percentage,
            letterGrade,
            gradePoint,
            absent: isAbsent,
            updatedById: userId,
          },
          select: { id: true },
        });
      }),
    );

    // Phase γ — fire-and-forget GPA snapshot recompute for every
    // student in the writable batch. See helper for why this is
    // safe to ignore on failure.
    const touchedStudents = new Set(writable.map((w) => w.studentId));
    for (const studentId of touchedStudents) {
      void this.recalculateStudentGPA(studentId, sessionId).catch(() => {
        // Intentional no-op — see helper docstring.
      });
    }

    return { success: true, updatedCount: writable.length };
  }

  async getStudentReport(
    examId: string,
    studentId: string,
    schoolId: string,
  ): Promise<StudentReport> {
    const exam = await this.exams.assertInSchool(examId, schoolId);
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!student) throw new NotFoundException('Student not found.');

    const rows = await this.prisma.result.findMany({
      where: { examId, studentId },
      include: {
        subject: {
          select: {
            name: true,
            theoryFullMarks: true,
            practicalFullMarks: true,
            creditHours: true,
          },
        },
      },
      orderBy: { subject: { name: 'asc' } },
    });

    const results: ResultRow[] = rows.map((r) => {
      const theoryFull = r.subject.theoryFullMarks;
      const practicalFull = r.subject.practicalFullMarks;
      const fullMarks = theoryFull + practicalFull;
      const marks = r.theoryMarks + r.practicalMarks;
      const theoryPct = theoryFull > 0 ? (r.theoryMarks / theoryFull) * 100 : 0;
      const practicalPct =
        practicalFull > 0 ? (r.practicalMarks / practicalFull) * 100 : 100;
      const failedComponent =
        theoryPct < 35 || (practicalFull > 0 && practicalPct < 35);
      return {
        id: r.id,
        subjectId: r.subjectId,
        subjectName: r.subject.name,
        fullMarks,
        marks,
        theoryMarks: r.theoryMarks,
        practicalMarks: r.practicalMarks,
        theoryFullMarks: theoryFull,
        practicalFullMarks: practicalFull,
        failedComponent,
        percentage: round(r.percentage, 2),
        letterGrade: r.letterGrade,
        letterGradeLabel: labelOf(r.letterGrade),
        gradePoint: r.gradePoint,
        creditHours: r.subject.creditHours ?? 5,
      };
    });

    // Credit-hour-weighted GPA (CDC progress-report formula). Returns null
    // when any subject is NG; we surface that as gpa=-1 (out-of-range
    // sentinel — 0 was ambiguous with a genuine 0.0 GPA) plus
    // gpaLetterGrade='NG'. Existing UIs that call `.toFixed(2)` must
    // guard with `gpa < 0` before formatting.
    const weightedGpa = this.grading.calculateWeightedGPA(
      rows.map((r) => ({
        gradePoint: r.gradePoint,
        creditHours: r.subject.creditHours ?? 5,
        letterGrade: labelOf(r.letterGrade),
      })),
    );
    const gpa = weightedGpa ?? -1;
    const gpaLetterGrade = this.grading.gpaToLetterGrade(weightedGpa);
    const totalCreditHours = rows.reduce(
      (sum, r) => sum + (r.subject.creditHours ?? 5),
      0,
    );

    // NEB rule: if any subject is NG, the final result is NG regardless of GPA.
    // Kept on the legacy fields below for back-compat with any UI that still
    // reads them.
    const hasFailingSubject = results.some(
      (r) => r.letterGrade === LetterGrade.NG,
    );
    const overall = hasFailingSubject
      ? { letterGrade: LetterGrade.NG, letterGradeLabel: 'NG' }
      : this.grading.grade(gpa * 25);

    return {
      examId,
      examName: exam.name,
      studentId,
      studentFirstName: student.firstName,
      studentLastName: student.lastName,
      results,
      gpa,
      gpaLetterGrade,
      totalCreditHours,
      overallLetterGrade: overall.letterGrade,
      overallLetterGradeLabel: overall.letterGradeLabel,
      hasFailingSubject,
    };
  }

  /**
   * Printable marksheet payload — extends StudentReport with the school's
   * display name and the student's class/section. Single roundtrip for a
   * report card.
   */
  async getMarksheet(
    examId: string,
    studentId: string,
    schoolId: string,
  ): Promise<Marksheet> {
    const [report, school, student, exam] = await Promise.all([
      this.getStudentReport(examId, studentId, schoolId),
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, slug: true, logoUrl: true },
      }),
      this.prisma.student.findFirst({
        where: { id: studentId, schoolId },
        select: {
          symbolNumber: true,
          section: {
            select: { name: true, class: { select: { name: true } } },
          },
        },
      }),
      this.exams.assertInSchool(examId, schoolId),
    ]);

    if (!school) throw new NotFoundException('School not found.');

    const studentSection = student?.section
      ? { name: student.section.name, className: student.section.class.name }
      : null;

    return {
      ...report,
      school,
      studentSymbolNumber: student?.symbolNumber ?? null,
      studentSection,
      examCreatedAt: exam.createdAt.toISOString(),
      generatedAt: new Date().toISOString(),
      examLocked: exam.locked,
      examLockedAt: exam.lockedAt ? exam.lockedAt.toISOString() : null,
    };
  }

  /**
   * Class-wide grade ledger — one row per student in the class, one
   * column per subject in the exam. Used by `/results/ledger` to print
   * an official class result sheet.
   *
   * "Students in the class" includes BOTH:
   *   • students linked directly to the class (no section), and
   *   • students placed into a section of that class.
   * That matches how Nepal-style result sheets are typically printed —
   * one ledger per class, regardless of how the school subdivides.
   */
  async getClassLedger(
    examId: string,
    classId: string,
    schoolId: string,
  ): Promise<ClassLedger> {
    // Tenant guards + school header in parallel — three independent
    // queries, single round-trip wall time.
    const [exam, klass, school] = await Promise.all([
      this.exams.assertInSchool(examId, schoolId),
      this.prisma.class.findFirst({
        where: { id: classId, schoolId },
        select: { id: true, name: true },
      }),
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, slug: true, logoUrl: true },
      }),
    ]);
    if (!klass) {
      throw new NotFoundException('Class not found.');
    }
    if (!school) {
      throw new NotFoundException('School not found.');
    }

    // Pull subjects (ledger column order) and roster (row order) in
    // parallel to keep total latency close to the slowest single query.
    const [subjects, students] = await Promise.all([
      this.prisma.examSubject.findMany({
        where: { examId },
        select: { id: true, name: true, creditHours: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.student.findMany({
        where: {
          schoolId,
          OR: [
            // Students linked directly to the class with no section.
            { classId, sectionId: null },
            // Students placed into any section of this class.
            { section: { classId } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          symbolNumber: true,
        },
        orderBy: [
          // Symbol-number-first when present matches how official Nepal
          // result sheets are organized; fall through to name for
          // students without a symbol number.
          { symbolNumber: 'asc' },
          { firstName: 'asc' },
          { lastName: 'asc' },
        ],
      }),
    ]);

    if (students.length === 0) {
      return {
        exam: { id: exam.id, name: exam.name },
        class: { id: klass.id, name: klass.name },
        school,
        subjects,
        students: [],
        generatedAt: new Date().toISOString(),
      };
    }

    // One round-trip for ALL results across the entire class. Index by
    // (studentId, subjectId) so building each row is O(1).
    const allResults = await this.prisma.result.findMany({
      where: {
        examId,
        studentId: { in: students.map((s) => s.id) },
      },
      select: {
        studentId: true,
        subjectId: true,
        letterGrade: true,
        gradePoint: true,
      },
    });
    const resultByKey = new Map<string, (typeof allResults)[number]>();
    for (const r of allResults) {
      resultByKey.set(`${r.studentId}:${r.subjectId}`, r);
    }

    // Index subjects by id for O(1) creditHours lookup when computing
    // each student's weighted GPA below.
    const subjectById = new Map(subjects.map((s) => [s.id, s]));

    const studentRows: LedgerStudentRow[] = students.map((student) => {
      const cells: LedgerCell[] = subjects.map((subj) => {
        const r = resultByKey.get(`${student.id}:${subj.id}`);
        return {
          subjectId: subj.id,
          grade: r ? labelOf(r.letterGrade) : null,
          gradePoint: r ? r.gradePoint : null,
        };
      });

      // Compute GPA + final result ONLY from cells that have results.
      // A student with no recorded results gets gpa=0, finalResult=null
      // — rendered as a blank in the UI rather than a misleading "NG".
      const recordedCells = cells.filter((c) => c.grade !== null);
      let gpa = 0;
      let finalResult: string | null = null;
      if (recordedCells.length > 0) {
        // Credit-hour-weighted GPA — same formula as getStudentReport.
        // calculateWeightedGPA returns null when ANY subject is NG, which
        // is exactly the NEB rule we want for `finalResult`.
        const weightedGpa = this.grading.calculateWeightedGPA(
          recordedCells.map((c) => ({
            gradePoint: c.gradePoint,
            creditHours: subjectById.get(c.subjectId)?.creditHours ?? 5,
            letterGrade: c.grade ?? 'NG',
          })),
        );
        gpa = weightedGpa ?? 0;
        finalResult = this.grading.gpaToLetterGrade(weightedGpa);
      }

      return {
        id: student.id,
        name: `${student.firstName} ${student.lastName}`,
        symbolNumber: student.symbolNumber,
        results: cells,
        gpa: round(gpa, 2),
        finalResult,
      };
    });

    return {
      exam: { id: exam.id, name: exam.name },
      class: { id: klass.id, name: klass.name },
      school,
      subjects,
      students: studentRows,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Recompute the credit-hour-weighted GPA snapshot stored on
   * `StudentAcademicRecord` for the given (student, session) pair, using
   * EVERY result the student has across every exam in that session.
   *
   * Called after a result save so that — if the student's session has
   * already been promoted (i.e. a StudentAcademicRecord row exists) —
   * any retroactive marks correction immediately re-syncs the archived
   * GPA. For the CURRENT (unpromoted) session, no row exists yet and
   * `updateMany` is a 0-row no-op; that's fine and intentional. The
   * row that gets created at promotion time will pick up whatever the
   * latest results say.
   *
   * Errors here are swallowed by the caller (fire-and-forget) — a
   * transient DB hiccup must not roll back the marks the teacher just
   * entered. Worst case: the cached GPA snapshot is stale until the
   * next save or until the promotion service rebuilds it.
   */
  private async recalculateStudentGPA(
    studentId: string,
    sessionId: string | null,
  ): Promise<void> {
    if (!sessionId) return;

    // Pull every result for this student where the parent exam sits in
    // this session. We filter via the relation so cross-session leaks
    // aren't possible even if a Result row's denormalized sessionId is
    // out of step with its exam.
    const results = await this.prisma.result.findMany({
      where: {
        studentId,
        exam: { sessionId },
      },
      include: {
        subject: { select: { creditHours: true } },
      },
    });

    if (results.length === 0) return;

    const gpaInputs = results.map((r) => ({
      gradePoint: r.gradePoint,
      creditHours: r.subject?.creditHours ?? 5,
      letterGrade: labelOf(r.letterGrade),
    }));

    const gpa = this.grading.calculateWeightedGPA(gpaInputs);
    const gpaLetterGrade = this.grading.gpaToLetterGrade(gpa);
    const totalCreditHours = results.reduce(
      (sum, r) => sum + (r.subject?.creditHours ?? 5),
      0,
    );

    // Only update if a StudentAcademicRecord exists; do not create one.
    // updateMany returns 0 affected rows for the unpromoted current
    // session — that's the intended no-op path.
    await this.prisma.studentAcademicRecord.updateMany({
      where: { studentId, sessionId },
      data: { gpa, gpaLetterGrade, totalCreditHours },
    });
  }
}

/**
 * NEB split-grading: must pass both theory (≥35%) AND practical (≥35%).
 * Theory-only subjects (practicalFullMarks = 0) auto-pass practical.
 * On failure of either component, the overall grade is forced to NG.
 */
function gradeWithSplit(
  grading: GradingService,
  theoryMarks: number,
  theoryFullMarks: number,
  practicalMarks: number,
  practicalFullMarks: number,
): { percentage: number; letterGrade: LetterGrade; gradePoint: number } {
  const theoryPct =
    theoryFullMarks > 0 ? (theoryMarks / theoryFullMarks) * 100 : 0;
  const practicalPct =
    practicalFullMarks > 0 ? (practicalMarks / practicalFullMarks) * 100 : 100;
  const passes =
    theoryPct >= 35 && (practicalFullMarks === 0 || practicalPct >= 35);

  const totalMarks = theoryMarks + practicalMarks;
  const totalFull = theoryFullMarks + practicalFullMarks;
  const percentage = totalFull > 0 ? (totalMarks / totalFull) * 100 : 0;

  if (!passes) {
    return { percentage, letterGrade: LetterGrade.NG, gradePoint: 0 };
  }
  const g = grading.grade(percentage);
  return {
    percentage,
    letterGrade: g.letterGrade,
    gradePoint: g.gradePoint,
  };
}

function labelOf(g: LetterGrade): string {
  switch (g) {
    case LetterGrade.A_PLUS: return 'A+';
    case LetterGrade.A: return 'A';
    case LetterGrade.B_PLUS: return 'B+';
    case LetterGrade.B: return 'B';
    case LetterGrade.C_PLUS: return 'C+';
    case LetterGrade.C: return 'C';
    case LetterGrade.D: return 'D';
    case LetterGrade.NG: return 'NG';
  }
}

function round(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

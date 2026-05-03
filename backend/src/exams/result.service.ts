import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LetterGrade, Result } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { GradingService } from '../grading/grading.service';
import { ExamService } from './exam.service';
import { BulkSaveResultsDto } from './dto/bulk-save-results.dto';
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
}

export interface StudentReport {
  examId: string;
  examName: string;
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  results: ResultRow[];
  gpa: number;
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
}

@Injectable()
export class ResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grading: GradingService,
    private readonly exams: ExamService,
  ) {}

  /**
   * Upsert results for a student across multiple subjects.
   * Grade data is always computed server-side from `marks` — clients can
   * display their own preview, but the server is authoritative.
   */
  async save(dto: SaveResultsDto, schoolId: string): Promise<StudentReport> {
    // Tenant guards.
    const exam = await this.exams.assertInSchool(dto.examId, schoolId);

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
      },
    });
    if (subjects.length !== subjectIds.length) {
      throw new BadRequestException(
        'One or more subjects do not belong to this exam.',
      );
    }
    const subjectById = new Map(subjects.map((s) => [s.id, s]));

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
          },
          update: {
            theoryMarks,
            practicalMarks,
            percentage,
            letterGrade,
            gradePoint,
          },
          select: { id: true },
        });
      }),
    );

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
  ): Promise<{ successCount: number }> {
    // 1. Tenant guards.
    const exam = await this.exams.assertInSchool(dto.examId, schoolId);

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
          },
          update: {
            theoryMarks,
            practicalMarks,
            percentage,
            letterGrade,
            gradePoint,
          },
          select: { id: true },
        });
      }),
    );

    return { successCount: dto.entries.length };
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
      };
    });

    const gpa = this.grading.gpa(results.map((r) => r.gradePoint));
    // NEB rule: if any subject is NG, the final result is NG regardless of GPA.
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
        select: { id: true, name: true },
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
        const points = recordedCells.map((c) => c.gradePoint ?? 0);
        gpa = this.grading.gpa(points);
        // NEB rule: any NG forces overall to NG, regardless of GPA.
        const hasNg = recordedCells.some((c) => c.grade === 'NG');
        finalResult = hasNg
          ? 'NG'
          : this.grading.grade(gpa * 25).letterGradeLabel;
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

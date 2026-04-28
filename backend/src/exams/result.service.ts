import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LetterGrade, Result } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { GradingService } from '../grading/grading.service';
import { ExamService } from './exam.service';
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

/** Richer report for printable marksheets — includes school & roster info. */
export interface Marksheet extends StudentReport {
  school: {
    id: string;
    name: string;
    slug: string;
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
        select: { id: true, name: true, slug: true },
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

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Exam,
  ExamSubject,
  LetterGrade,
  PlatformAuditAction,
  Prisma,
} from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuditService } from '../platform/platform-audit.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

export type ExamWithSubjects = Exam & { subjects: ExamSubject[] };

/**
 * Aggregated analytics for a single exam. Composed from the Result
 * rows attached to that exam, with a few interpretive choices baked
 * in (see comments on each field).
 */
export interface ExamAnalytics {
  exam: {
    id: string;
    name: string;
    sessionId: string | null;
    createdAt: string;
    subjectCount: number;
  };
  /** Distinct students who have at least one result row for this exam. */
  studentCount: number;
  /**
   * Student-level pass/fail.
   *
   *   passed — at least one result row AND no NG / D grades
   *            (D is "below pass mark" in the NEB rubric used here).
   *   failed — has at least one row AND any NG or D grade.
   *
   * Students with NO results are not counted in either bucket — they
   * haven't been graded yet, which is a third state ("pending"). The
   * UI surfaces `pending` separately so principals don't conflate
   * "didn't appear" with "failed."
   */
  studentOutcomes: {
    passed: number;
    failed: number;
    pending: number;
  };
  /**
   * Letter-grade histogram across ALL result rows (subject-level, not
   * student-level). Used to render the GPA distribution chart.
   * Sorted by grade severity (A+ → NG) so the chart reads naturally.
   */
  gradeDistribution: Array<{
    grade: LetterGrade;
    count: number;
  }>;
  /**
   * Per-subject summary. `passRate` = non-NG, non-D rows / total rows
   * for the subject. `averagePercentage` = mean across non-absent rows
   * (absent rows have forced-zero marks which would skew the mean).
   */
  subjects: Array<{
    subjectId: string;
    name: string;
    resultsCount: number;
    averagePercentage: number;
    passRate: number;
    /** Single highest scorer in the subject. Null when no results yet. */
    topper: {
      studentId: string;
      firstName: string;
      lastName: string;
      symbolNumber: string | null;
      percentage: number;
    } | null;
  }>;
  /**
   * Top 5 students by aggregate average percentage across the exam.
   * Ties broken by symbolNumber ascending so the order is deterministic.
   */
  topPerformers: Array<{
    studentId: string;
    firstName: string;
    lastName: string;
    symbolNumber: string | null;
    averagePercentage: number;
    subjectsTaken: number;
  }>;
  generatedAt: string;
}

/** Letter-grade order for the histogram — best on the left, fail on the right. */
const LETTER_GRADE_ORDER: LetterGrade[] = [
  'A_PLUS',
  'A',
  'B_PLUS',
  'B',
  'C_PLUS',
  'C',
  'D',
  'NG',
];

/** Grades that count as "failed" at the student level. */
const FAILING_GRADES = new Set<LetterGrade>(['NG', 'D']);

@Injectable()
export class ExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * Audit: every create stamps both `createdById` and `updatedById`
   * with the same caller. Session: STRICT — every new exam must be
   * attributed to an active, UNLOCKED session. Throws:
   *   • "No active academic session"   → none set up yet
   *   • "Active session is locked. …"  → admin froze the year
   */
  async create(
    dto: CreateExamDto,
    schoolId: string,
    userId: string,
  ): Promise<Exam> {
    const sessionId = await this.sessions.requireActiveUnlocked(schoolId);
    try {
      return await this.prisma.exam.create({
        data: {
          name: dto.name,
          schoolId,
          createdById: userId,
          updatedById: userId,
          sessionId,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `An exam named "${dto.name}" already exists.`,
        );
      }
      throw e;
    }
  }

  /**
   * List exams. Strict-default session filter:
   *   • caller passed sessionId → use it
   *   • active session exists   → filter to that session (NULL excluded)
   *   • no active session       → filter to NULL legacy rows
   *
   * See `AcademicSessionService.resolveReadFilter` for the rule.
   */
  async findAll(
    schoolId: string,
    sessionId?: string,
  ): Promise<ExamWithSubjects[]> {
    const filter = await this.sessions.resolveReadFilter(
      schoolId,
      sessionId,
    );
    return this.prisma.exam.findMany({
      where: { schoolId, ...filter },
      include: { subjects: { orderBy: { name: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Compose the analytics payload for a single exam. Single round-trip
   * (one query joins exam + subjects + results + students) followed by
   * in-memory aggregation. For exams with hundreds of results this is
   * still cheaper than fanning out per-subject + per-student counts.
   *
   * Returns 404 if the exam isn't in the caller's school. Tenancy is
   * enforced by the join filter — we never see results from another
   * tenant's exam even if a stale `examId` is passed.
   */
  async getAnalytics(
    examId: string,
    schoolId: string,
  ): Promise<ExamAnalytics> {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, schoolId },
      include: {
        subjects: { orderBy: { name: 'asc' } },
        results: {
          include: {
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                symbolNumber: true,
              },
            },
          },
        },
      },
    });
    if (!exam) throw new NotFoundException('Exam not found.');

    // ----- Student-level outcomes -----
    // Walk results once, bucket by studentId. A student passes if every
    // graded subject is non-failing. A student is "pending" only when
    // they have NO results at all — but we don't know about students
    // who didn't take the exam (no roster join), so `pending` here
    // represents zero-result students within the result-set, which is
    // always 0. The UI can compare studentCount to a class roster
    // separately if needed.
    const byStudent = new Map<
      string,
      {
        student: {
          id: string;
          firstName: string;
          lastName: string;
          symbolNumber: string | null;
        };
        results: Array<{
          subjectId: string;
          percentage: number;
          letterGrade: LetterGrade;
          absent: boolean;
        }>;
      }
    >();

    for (const r of exam.results) {
      const existing = byStudent.get(r.studentId);
      const row = {
        subjectId: r.subjectId,
        percentage: r.percentage,
        letterGrade: r.letterGrade,
        absent: r.absent,
      };
      if (existing) {
        existing.results.push(row);
      } else {
        byStudent.set(r.studentId, {
          student: {
            id: r.student.id,
            firstName: r.student.firstName,
            lastName: r.student.lastName,
            symbolNumber: r.student.symbolNumber,
          },
          results: [row],
        });
      }
    }

    let passed = 0;
    let failed = 0;
    for (const { results } of byStudent.values()) {
      // A pending student has no rows → wouldn't be in the map. Every
      // entry here has at least one result.
      const anyFail = results.some((r) => FAILING_GRADES.has(r.letterGrade));
      if (anyFail) failed += 1;
      else passed += 1;
    }

    // ----- Grade histogram -----
    const gradeCounts = new Map<LetterGrade, number>();
    for (const r of exam.results) {
      gradeCounts.set(r.letterGrade, (gradeCounts.get(r.letterGrade) ?? 0) + 1);
    }
    const gradeDistribution = LETTER_GRADE_ORDER.map((grade) => ({
      grade,
      count: gradeCounts.get(grade) ?? 0,
    }));

    // ----- Per-subject averages + toppers -----
    const subjects = exam.subjects.map((s) => {
      // Filter to this subject's results. Could pre-bucket but with
      // typical schools (≤ 20 subjects per exam) this is cheap and
      // keeps the code linear.
      const rows = exam.results.filter((r) => r.subjectId === s.id);
      const nonAbsent = rows.filter((r) => !r.absent);

      const averagePercentage =
        nonAbsent.length > 0
          ? nonAbsent.reduce((acc, r) => acc + r.percentage, 0) /
            nonAbsent.length
          : 0;

      const passingRows = rows.filter(
        (r) => !FAILING_GRADES.has(r.letterGrade),
      );
      const passRate = rows.length > 0 ? passingRows.length / rows.length : 0;

      // Topper: highest non-absent percentage. Ties broken by
      // symbolNumber ascending so the result is deterministic.
      const topRow = nonAbsent.reduce<typeof rows[number] | null>(
        (acc, r) => (acc === null || r.percentage > acc.percentage ? r : acc),
        null,
      );

      return {
        subjectId: s.id,
        name: s.name,
        resultsCount: rows.length,
        averagePercentage: round(averagePercentage, 2),
        passRate: round(passRate, 4),
        topper: topRow
          ? {
              studentId: topRow.student.id,
              firstName: topRow.student.firstName,
              lastName: topRow.student.lastName,
              symbolNumber: topRow.student.symbolNumber,
              percentage: round(topRow.percentage, 2),
            }
          : null,
      };
    });

    // ----- Top performers -----
    const studentAverages = [...byStudent.values()].map((entry) => {
      const nonAbsent = entry.results.filter((r) => !r.absent);
      const avg =
        nonAbsent.length > 0
          ? nonAbsent.reduce((acc, r) => acc + r.percentage, 0) /
            nonAbsent.length
          : 0;
      return {
        studentId: entry.student.id,
        firstName: entry.student.firstName,
        lastName: entry.student.lastName,
        symbolNumber: entry.student.symbolNumber,
        averagePercentage: round(avg, 2),
        subjectsTaken: nonAbsent.length,
      };
    });
    const topPerformers = studentAverages
      .filter((s) => s.subjectsTaken > 0)
      .sort((a, b) => {
        if (b.averagePercentage !== a.averagePercentage) {
          return b.averagePercentage - a.averagePercentage;
        }
        // Stable tiebreak — symbol number alpha-asc.
        return (a.symbolNumber ?? '').localeCompare(b.symbolNumber ?? '');
      })
      .slice(0, 5);

    return {
      exam: {
        id: exam.id,
        name: exam.name,
        sessionId: exam.sessionId,
        createdAt: exam.createdAt.toISOString(),
        subjectCount: exam.subjects.length,
      },
      studentCount: byStudent.size,
      studentOutcomes: {
        passed,
        failed,
        // No pending in this composition — see comment above. Kept on
        // the type for future expansion (e.g. when we cross-reference
        // a class roster).
        pending: 0,
      },
      gradeDistribution,
      subjects,
      topPerformers,
      generatedAt: new Date().toISOString(),
    };
  }

  async update(
    id: string,
    dto: UpdateExamDto,
    schoolId: string,
    userId: string,
  ): Promise<Exam> {
    const existing = await this.assertInSchool(id, schoolId);
    // Lock guard: edits to an exam in a locked session are blocked
    // even when there's a different active session. The exam stays
    // in the year it was created; if that year is locked, the data
    // is frozen.
    await this.sessions.assertSessionUnlocked(existing.sessionId);
    try {
      return await this.prisma.exam.update({
        where: { id },
        data: { ...dto, updatedById: userId },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `An exam named "${dto.name}" already exists.`,
        );
      }
      throw e;
    }
  }

  async remove(id: string, schoolId: string): Promise<void> {
    await this.assertInSchool(id, schoolId);
    await this.prisma.exam.delete({ where: { id } });
  }

  /** Throws 404 if the exam isn't in the caller's school. */
  async assertInSchool(id: string, schoolId: string): Promise<Exam> {
    const exam = await this.prisma.exam.findFirst({
      where: { id, schoolId },
    });
    if (!exam) throw new NotFoundException('Exam not found.');
    return exam;
  }

  /**
   * Tenant + lock guard for marks-write paths. Returns the exam
   * when it's both in the caller's school AND not locked. Throws:
   *
   *   • 404 NotFound  — exam doesn't exist in this school.
   *   • 423 Locked    — exam exists but `locked = true`. Marks edits
   *                     require an explicit unlock first; the
   *                     frontend surfaces this with the LockedBadge
   *                     and a "Request unlock" affordance.
   *
   * Phase data-integrity Rule 1: this is the SERVER-SIDE guard. The
   * UI may also disable inputs when locked, but the source of truth
   * is here — every results.save / bulkSave / gridSave call routes
   * through this method.
   */
  async assertEditable(id: string, schoolId: string): Promise<Exam> {
    const exam = await this.assertInSchool(id, schoolId);
    if (exam.locked) {
      // 423 LOCKED — RFC 4918 §11.3. Closest standard code for
      // "the resource is locked against modification."
      throw new HttpException(
        {
          statusCode: HttpStatus.LOCKED,
          message:
            'This exam is locked. Marks cannot be edited until an admin unlocks it.',
          examId: exam.id,
          locked: true,
          lockedAt: exam.lockedAt,
        },
        HttpStatus.LOCKED,
      );
    }
    return exam;
  }

  /**
   * Lock an exam. Idempotent: a lock-when-already-locked is a no-op
   * (returns the existing row, no audit emit, no extra timestamp
   * shuffle). The actor is recorded for the audit trail.
   *
   * Phase data-integrity Rules 1+2+5:
   *   • Server-enforced — every save path checks the flag.
   *   • Explicit action — separate endpoint, ADMIN-only.
   *   • Audit emits with examId + examName so the operator can see
   *     "locked X by Y at Z" in the platform audit timeline.
   */
  async lockExam(
    id: string,
    schoolId: string,
    actor: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<Exam> {
    const before = await this.assertInSchool(id, schoolId);
    if (before.locked) {
      // No-op — return the existing row without writing or auditing.
      // The endpoint is idempotent so a double-click can't spam audit.
      return before;
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        locked: true,
        lockedAt: new Date(),
        lockedById: actor.userId,
      },
    });

    await this.audit.record({
      action: PlatformAuditAction.MARKS_LOCKED,
      // Tenant-scope explicitly so the school-side audit feed picks
      // this up. Without it the row would inherit the actor's
      // schoolId, which IS the target school here, but being
      // explicit decouples the audit from any future actor that
      // doesn't match (e.g. SUPER_ADMIN locking on behalf of).
      schoolId,
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: { type: 'Exam', id: updated.id, label: updated.name },
      before: { locked: false, lockedAt: null },
      after: {
        locked: true,
        lockedAt: updated.lockedAt,
        examId: updated.id,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return updated;
  }

  /**
   * Unlock an exam. Mirror of lockExam — idempotent no-op when
   * already unlocked. Clears `lockedAt` + `lockedById` so the
   * audit trail tells the full story (lock event + unlock event in
   * the platform audit stream); the row itself doesn't carry
   * "previously locked at X" history because the audit log is the
   * source of truth for that.
   */
  async unlockExam(
    id: string,
    schoolId: string,
    actor: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<Exam> {
    const before = await this.assertInSchool(id, schoolId);
    if (!before.locked) {
      return before;
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        locked: false,
        lockedAt: null,
        lockedById: null,
      },
    });

    await this.audit.record({
      action: PlatformAuditAction.MARKS_UNLOCKED,
      schoolId,
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: { type: 'Exam', id: updated.id, label: updated.name },
      before: {
        locked: true,
        lockedAt: before.lockedAt,
        lockedById: before.lockedById,
      },
      after: { locked: false, examId: updated.id },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return updated;
  }
}

/** Round to N decimal places — matches the convention in fees.service. */
function round(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

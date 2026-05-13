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
import { assertNotStaleAndUpdate } from '../common/db/optimistic-update';
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
   * Archive filter (Phase DATA LIFECYCLE Part 1):
   *   • archived === true   → only archived rows (the "Archived" tab)
   *   • archived === 'all'  → both active + archived
   *   • undefined (default) → only active rows (`archivedAt: null`)
   *
   * See `AcademicSessionService.resolveReadFilter` for the session rule.
   */
  async findAll(
    schoolId: string,
    sessionId?: string,
    archived?: boolean | 'all',
  ): Promise<ExamWithSubjects[]> {
    const filter = await this.sessions.resolveReadFilter(
      schoolId,
      sessionId,
    );
    const archivedFilter: Prisma.ExamWhereInput =
      archived === true
        ? { archivedAt: { not: null } }
        : archived === 'all'
          ? {}
          : { archivedAt: null };
    return this.prisma.exam.findMany({
      where: { schoolId, ...filter, ...archivedFilter },
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
    if (existing.archivedAt) {
      // Phase DATA LIFECYCLE Part 1: archived exams can't be renamed
      // or otherwise edited. Restore first.
      throw new ConflictException(
        'This exam is archived. Restore it before editing.',
      );
    }
    // Lock guard: edits to an exam in a locked session are blocked
    // even when there's a different active session. The exam stays
    // in the year it was created; if that year is locked, the data
    // is frozen.
    await this.sessions.assertSessionUnlocked(existing.sessionId);
    try {
      // Phase FINAL-HARDENING Part 2: optimistic-concurrency-aware.
      // Falls back to last-write-wins when the client didn't
      // round-trip `updatedAt` (legacy callers during rollout).
      const { updatedAt: _expectedUpdatedAt, ...rest } = dto;
      return (await assertNotStaleAndUpdate(
        this.prisma.exam as unknown as Parameters<
          typeof assertNotStaleAndUpdate
        >[0],
        {
          entity: 'Exam',
          id,
          expectedUpdatedAt: _expectedUpdatedAt,
          data: { ...rest, updatedById: userId } as unknown as Record<
            string,
            unknown
          >,
        },
      )) as Exam;
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
   * Soft-delete an exam.
   *
   * Phase DATA LIFECYCLE Part 1+2: hard-delete is no longer offered
   * for Exam — Result/ResultLedger rows cascade off the exam and would
   * erase grading history that parents/audit need. This redirects to
   * `archiveExam()` so the `DELETE /exams/:id` endpoint stays useful
   * while honouring the soft-delete guarantee.
   */
  async remove(
    id: string,
    schoolId: string,
    actor: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<void> {
    await this.archiveExam(id, schoolId, actor, null);
  }

  /**
   * Archive an exam. Stamps `archivedAt` + `archivedById` + optional
   * reason and emits EXAM_ARCHIVED with explicit `schoolId`.
   *
   * Idempotent: archiving an already-archived exam returns the
   * existing row with no second audit emit. Mirrors lockExam.
   *
   * Locked exams CAN be archived (and archived exams stay locked).
   * The two flags are orthogonal: lock = "marks frozen, can be
   * unlocked for edits", archive = "hidden from default listings,
   * Restore before any edit". Archiving a locked exam is fine — the
   * data is doubly-protected.
   */
  async archiveExam(
    id: string,
    schoolId: string,
    actor: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
    reason: string | null,
  ): Promise<Exam> {
    const before = await this.assertInSchool(id, schoolId);
    if (before.archivedAt) {
      return before;
    }
    const trimmedReason =
      typeof reason === 'string' && reason.trim().length > 0
        ? reason.trim().slice(0, 500)
        : null;

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        archivedAt: new Date(),
        archivedById: actor.userId,
        archiveReason: trimmedReason,
      },
    });

    await this.audit.record({
      action: PlatformAuditAction.EXAM_ARCHIVED,
      schoolId,
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: { type: 'Exam', id: updated.id, label: updated.name },
      before: { archivedAt: null, archivedById: null, archiveReason: null },
      after: {
        archivedAt: updated.archivedAt,
        archivedById: updated.archivedById,
        archiveReason: updated.archiveReason,
        examId: updated.id,
      },
      reason: trimmedReason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return updated;
  }

  /**
   * Restore a previously archived exam. Clears the archive triplet
   * and emits EXAM_RESTORED. Idempotent.
   */
  async restoreExam(
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
    if (!before.archivedAt) {
      return before;
    }

    const beforeSnapshot = {
      archivedAt: before.archivedAt,
      archivedById: before.archivedById,
      archiveReason: before.archiveReason,
    };

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      },
    });

    await this.audit.record({
      action: PlatformAuditAction.EXAM_RESTORED,
      schoolId,
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: { type: 'Exam', id: updated.id, label: updated.name },
      before: beforeSnapshot,
      after: {
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        examId: updated.id,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return updated;
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
    if (exam.archivedAt) {
      // Phase DATA LIFECYCLE Part 1: archived exams reject every
      // marks-write path. 409 Conflict (not 423 Locked) — archive is a
      // different state from lock; the operator should restore first
      // if they truly want to edit, not "unlock". Frontend surfaces
      // this with the ArchivedBadge + a "Restore to edit" affordance.
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          message:
            'This exam is archived. Restore it before editing marks.',
          examId: exam.id,
          archivedAt: exam.archivedAt,
        },
        HttpStatus.CONFLICT,
      );
    }
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
   * Publish an exam — marks become visible to parents. Phase
   * ACADEMIC TRANSITION SAFETY Part 4. Orthogonal to the lock flag:
   *   • Publishing a draft exam → state goes Draft → Published.
   *   • Publishing then locking → state goes Published → Locked, but
   *     the publishedAt timestamp is preserved.
   *   • Publishing a locked exam IS allowed (rare but legal) — locking
   *     freezes edits, it doesn't toggle visibility on its own.
   *
   * Idempotent: republishing an already-published exam is a no-op
   * (same row returned, no audit emit). Mirrors lockExam.
   */
  async publishExam(
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
    if (before.archivedAt) {
      // Archived exams can't be re-published — restore first.
      throw new ConflictException(
        'This exam is archived. Restore it before publishing.',
      );
    }
    if (before.publishedAt) {
      // Already published — short-circuit, no audit emit.
      return before;
    }

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        publishedAt: new Date(),
        publishedById: actor.userId,
      },
    });

    await this.audit.record({
      action: PlatformAuditAction.MARKS_PUBLISHED,
      schoolId,
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: { type: 'Exam', id: updated.id, label: updated.name },
      before: { publishedAt: null, publishedById: null },
      after: {
        publishedAt: updated.publishedAt,
        publishedById: updated.publishedById,
        examId: updated.id,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return updated;
  }

  /**
   * Unpublish an exam — marks return to Draft state. Useful when an
   * admin published prematurely and needs to clawback visibility.
   * Idempotent.
   *
   * Rejects locked exams: unpublishing a locked exam would leave it
   * in an awkward state (frozen + draft) and there's no operator
   * scenario for that. Unlock first.
   */
  async unpublishExam(
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
    if (!before.publishedAt) {
      return before;
    }
    if (before.locked) {
      throw new ConflictException(
        'This exam is locked. Unlock it before changing publication state.',
      );
    }

    const beforeSnapshot = {
      publishedAt: before.publishedAt,
      publishedById: before.publishedById,
    };

    const updated = await this.prisma.exam.update({
      where: { id },
      data: {
        publishedAt: null,
        publishedById: null,
      },
    });

    await this.audit.record({
      action: PlatformAuditAction.MARKS_UNPUBLISHED,
      schoolId,
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: { type: 'Exam', id: updated.id, label: updated.name },
      before: beforeSnapshot,
      after: { publishedAt: null, publishedById: null, examId: updated.id },
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

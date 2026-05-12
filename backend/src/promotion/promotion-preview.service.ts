import { Injectable, Logger } from '@nestjs/common';
import {
  PlatformAuditAction,
  StudentSessionStatus,
  type Class,
  type Section,
  type Student,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import { PlatformAuditService } from '../platform/platform-audit.service';
import { RunPromotionDto } from './dto/run-promotion.dto';
import {
  ISSUE_SEVERITY,
  type PromotionIssue,
  type PromotionIssueCode,
  type PromotionPreviewEntry,
  type PromotionValidationResult,
} from './promotion-preview.types';

// ============================================================================
// PromotionPreviewService — dry-run promotion validation.
//
// Phase ACADEMIC TRANSITION SAFETY Part 1.
//
// Why a separate service from PromotionService.run():
//   • The live run can assume preconditions are met (run() will throw
//     on the first problem); the preview's job is the opposite — find
//     ALL the problems at once so the operator sees the full picture.
//   • Different output shape (validation report vs. execution result).
//   • Different audit event (PROMOTION_PREVIEWED, not PROMOTION_EXECUTED).
//
// Reuse strategy:
//   • Same DTO (`RunPromotionDto`) as the live run — the UI submits a
//     payload, hits Preview, reviews, then hits Execute with the same
//     payload. No payload divergence.
//   • The set of preconditions checked here is a superset of what
//     PromotionService.run() checks; in Part 6 the live run will
//     internally re-validate via this service so the two paths can't
//     drift.
//
// Read-only contract:
//   • This service is BANNED from calling `prisma.*.create/update/delete`.
//     The only write path is the audit emit at the end — and that's
//     soft-fail by design (see PlatformAuditService).
// ============================================================================

/** Convenience constructor for a PromotionIssue with a fixed severity. */
function makeIssue(
  code: PromotionIssueCode,
  message: string,
  scope?: { studentId?: string; classId?: string; examId?: string },
): PromotionIssue {
  return {
    code,
    severity: ISSUE_SEVERITY[code] ?? 'error',
    message,
    ...scope,
  };
}

@Injectable()
export class PromotionPreviewService {
  private readonly logger = new Logger(PromotionPreviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * Build the validation report.
   *
   * No throw on payload-level problems — every issue is collected
   * into the result so the UI can render the full picture in one
   * pass. The only kind of error this CAN throw is an unexpected
   * runtime failure (database down, schema drift); callers should
   * surface those as 500s.
   */
  async preview(
    dto: RunPromotionDto,
    schoolId: string,
    actor?: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<PromotionValidationResult> {
    const sessionIssues: PromotionIssue[] = [];

    // ---- Session preconditions ----
    const active = await this.sessions.getActive(schoolId);
    let fromSessionSnapshot: PromotionValidationResult['fromSession'] = null;
    if (!active) {
      sessionIssues.push(
        makeIssue('NO_ACTIVE_SESSION', 'No active academic session.'),
      );
    } else {
      fromSessionSnapshot = {
        id: active.id,
        name: active.name,
        isActive: active.isActive,
        isLocked: active.isLocked,
        endDate: active.endDate.toISOString(),
      };
      if (!active.isLocked) {
        sessionIssues.push(
          makeIssue(
            'SESSION_NOT_LOCKED',
            `Active session "${active.name}" must be locked before promotion. Lock it from Settings → Sessions first.`,
          ),
        );
      }
      const today = new Date();
      if (today > active.endDate) {
        sessionIssues.push(
          makeIssue(
            'SESSION_ENDED',
            `Active session "${active.name}" ended on ${active.endDate
              .toISOString()
              .slice(0, 10)}. Proceeding is fine but late.`,
          ),
        );
      }
    }

    // ---- Next-session payload checks ----
    const nextStart = new Date(dto.nextSession.startDate);
    const nextEnd = new Date(dto.nextSession.endDate);
    if (
      Number.isNaN(nextStart.getTime()) ||
      Number.isNaN(nextEnd.getTime()) ||
      nextStart >= nextEnd
    ) {
      sessionIssues.push(
        makeIssue(
          'INVALID_DATE_RANGE',
          'Next-session startDate must be before endDate.',
        ),
      );
    }
    if (active && nextStart < active.endDate) {
      sessionIssues.push(
        makeIssue(
          'OVERLAPPING_SESSION_DATES',
          `Next session starts ${nextStart
            .toISOString()
            .slice(0, 10)} but the current session doesn't end until ${active.endDate
            .toISOString()
            .slice(0, 10)}.`,
        ),
      );
    }
    const trimmedNextName = dto.nextSession.name.trim();
    const dupeName = await this.prisma.academicSession.findFirst({
      where: { schoolId, name: trimmedNextName },
      select: { id: true },
    });
    if (dupeName) {
      sessionIssues.push(
        makeIssue(
          'DUPLICATE_SESSION_NAME',
          `A session named "${trimmedNextName}" already exists for this school.`,
        ),
      );
    }

    // ---- Payload-wide student duplicate detection ----
    const studentIds = dto.entries.map((e) => e.studentId);
    const dupeStudentIdSet = collectDuplicates(studentIds);

    // ---- Fan-out reads (one batch per kind) ----
    const studentRows = await this.prisma.student.findMany({
      where: { id: { in: studentIds }, schoolId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        classId: true,
        sectionId: true,
        archivedAt: true,
        class: { select: { id: true, name: true } },
      },
    });
    const studentById = new Map(studentRows.map((s) => [s.id, s]));

    const referencedClassIds = Array.from(
      new Set(
        dto.entries
          .map((e) => e.nextClassId)
          .filter((id): id is string => !!id),
      ),
    );
    const classRows: Pick<Class, 'id' | 'name' | 'schoolId'>[] =
      referencedClassIds.length > 0
        ? await this.prisma.class.findMany({
            where: { id: { in: referencedClassIds } },
            select: { id: true, name: true, schoolId: true },
          })
        : [];
    const classById = new Map(classRows.map((c) => [c.id, c]));

    const referencedSectionIds = Array.from(
      new Set(
        dto.entries
          .map((e) => e.nextSectionId)
          .filter((id): id is string => !!id),
      ),
    );
    const sectionRows: Pick<Section, 'id' | 'classId'>[] =
      referencedSectionIds.length > 0
        ? await this.prisma.section.findMany({
            where: { id: { in: referencedSectionIds } },
            select: { id: true, classId: true },
          })
        : [];
    const sectionById = new Map(sectionRows.map((s) => [s.id, s]));

    // Already-promoted check: rows that already have a SAR for the
    // active session. If `active` is null we skip (no source to
    // intersect with).
    const alreadyPromoted = active
      ? await this.prisma.studentAcademicRecord.findMany({
          where: { schoolId, sessionId: active.id, studentId: { in: studentIds } },
          select: { studentId: true },
        })
      : [];
    const alreadyPromotedSet = new Set(alreadyPromoted.map((r) => r.studentId));

    // Source-session result-dependency warnings (one query for the
    // whole school) — cheap and informational. We count rather than
    // pull every row, then surface one summary issue per category.
    let unpublishedResultsCount = 0;
    let lockedExamCount = 0;
    if (active) {
      [unpublishedResultsCount, lockedExamCount] = await Promise.all([
        this.prisma.exam.count({
          where: {
            schoolId,
            sessionId: active.id,
            archivedAt: null,
            publishedAt: null,
            // Only flag exams that actually have results — a draft
            // empty exam isn't a promotion risk.
            results: { some: {} },
          },
        }),
        this.prisma.exam.count({
          where: {
            schoolId,
            sessionId: active.id,
            archivedAt: null,
            locked: true,
          },
        }),
      ]);
    }
    if (unpublishedResultsCount > 0) {
      sessionIssues.push(
        makeIssue(
          'UNPUBLISHED_RESULTS_IN_SOURCE',
          `${unpublishedResultsCount} exam(s) in the current session still have draft (unpublished) results. Promote anyway, or publish first to lock visibility.`,
        ),
      );
    }
    if (lockedExamCount > 0) {
      sessionIssues.push(
        makeIssue(
          'LOCKED_EXAMS_IN_SOURCE',
          `${lockedExamCount} exam(s) are locked in the current session — their marks won't be editable after promotion either, which is usually fine.`,
        ),
      );
    }

    // ---- Per-entry validation ----
    const entries: PromotionPreviewEntry[] = dto.entries.map((e) => {
      const issues: PromotionIssue[] = [];
      const student = studentById.get(e.studentId);
      if (dupeStudentIdSet.has(e.studentId)) {
        issues.push(
          makeIssue(
            'DUPLICATE_STUDENT_IN_PAYLOAD',
            `Student ${e.studentId} appears more than once in the payload.`,
            { studentId: e.studentId },
          ),
        );
      }
      if (!student) {
        issues.push(
          makeIssue(
            'STUDENT_NOT_FOUND',
            `Student ${e.studentId} does not belong to this school.`,
            { studentId: e.studentId },
          ),
        );
      } else {
        if (student.archivedAt) {
          issues.push(
            makeIssue(
              'STUDENT_ARCHIVED',
              `${student.firstName} ${student.lastName} is archived. Restore them before including in a promotion run.`,
              { studentId: student.id },
            ),
          );
        }
        if (!student.classId) {
          issues.push(
            makeIssue(
              'STUDENT_NO_CURRENT_CLASS',
              `${student.firstName} ${student.lastName} has no current class — promotion can't snapshot "promoted from".`,
              { studentId: student.id },
            ),
          );
        }
        if (alreadyPromotedSet.has(student.id)) {
          issues.push(
            makeIssue(
              'STUDENT_ALREADY_PROMOTED',
              `${student.firstName} ${student.lastName} is already recorded in this session's promotion. Re-running would duplicate the snapshot.`,
              { studentId: student.id },
            ),
          );
        }
      }

      // Per-entry status-conditional checks.
      let nextClassName: string | null = null;
      let nextClassId: string | null = e.nextClassId ?? null;
      const nextSectionId: string | null = e.nextSectionId ?? null;
      if (e.status === StudentSessionStatus.PROMOTED) {
        if (!e.nextClassId) {
          issues.push(
            makeIssue(
              'PROMOTED_MISSING_NEXT_CLASS',
              'PROMOTED entries must specify nextClassId.',
              { studentId: e.studentId },
            ),
          );
        } else {
          const klass = classById.get(e.nextClassId);
          if (!klass || klass.schoolId !== schoolId) {
            issues.push(
              makeIssue(
                'NEXT_CLASS_NOT_FOUND',
                'Selected destination class is not in this school.',
                { studentId: e.studentId, classId: e.nextClassId },
              ),
            );
          } else {
            nextClassName = klass.name;
          }
          if (e.nextSectionId) {
            const section = sectionById.get(e.nextSectionId);
            if (!section || section.classId !== e.nextClassId) {
              issues.push(
                makeIssue(
                  'NEXT_SECTION_MISMATCH',
                  'Selected section does not belong to the destination class.',
                  { studentId: e.studentId, classId: e.nextClassId },
                ),
              );
            }
          }
        }
      } else {
        // RETAINED / LEFT — nextClass / nextSection are ignored. We
        // explicitly null them in the preview entry so the UI can
        // show "—" rather than a stale id.
        nextClassId = null;
      }

      const blocked = issues.some((i) => i.severity === 'error');
      return {
        studentId: e.studentId,
        studentName: student
          ? `${student.firstName} ${student.lastName}`.trim()
          : '(unknown)',
        currentClassId: student?.class?.id ?? student?.classId ?? null,
        currentClassName: student?.class?.name ?? null,
        proposedStatus: e.status as PromotionPreviewEntry['proposedStatus'],
        nextClassId,
        nextClassName,
        nextSectionId,
        archived: !!student?.archivedAt,
        blocked,
        issues,
      };
    });

    // ---- Aggregate counts ----
    let willPromote = 0;
    let willRetain = 0;
    let willLeave = 0;
    let blocked = 0;
    let withWarnings = 0;
    let archivedExcluded = 0;
    for (const r of entries) {
      if (r.blocked) {
        blocked += 1;
        if (r.archived) archivedExcluded += 1;
        continue;
      }
      if (r.issues.length > 0) withWarnings += 1;
      switch (r.proposedStatus) {
        case 'PROMOTED':
          willPromote += 1;
          break;
        case 'RETAINED':
          willRetain += 1;
          break;
        case 'LEFT':
          willLeave += 1;
          break;
      }
    }

    const allIssues: PromotionIssue[] = [
      ...sessionIssues,
      ...entries.flatMap((r) => r.issues),
    ];
    const blockers = allIssues.filter((i) => i.severity === 'error');
    const warnings = allIssues.filter((i) => i.severity === 'warning');

    const result: PromotionValidationResult = {
      canRun: blockers.length === 0,
      fromSession: fromSessionSnapshot,
      nextSession: {
        name: trimmedNextName,
        startDate: dto.nextSession.startDate,
        endDate: dto.nextSession.endDate,
      },
      counts: {
        total: dto.entries.length,
        willPromote,
        willRetain,
        willLeave,
        blocked,
        withWarnings,
        archivedExcluded,
      },
      sessionIssues,
      entries,
      blockers,
      warnings,
      generatedAt: new Date().toISOString(),
    };

    // Audit the preview — soft-fail. The target is the "from session"
    // (or the school itself if none yet) so the audit feed can group
    // multiple preview attempts on the same session together.
    if (actor) {
      await this.audit.record({
        action: PlatformAuditAction.PROMOTION_PREVIEWED,
        schoolId,
        actor: {
          userId: actor.userId,
          email: actor.email,
          role: actor.role,
        },
        target: fromSessionSnapshot
          ? {
              type: 'AcademicSession',
              id: fromSessionSnapshot.id,
              label: fromSessionSnapshot.name,
            }
          : { type: 'School', id: schoolId, label: 'promotion preview' },
        after: {
          canRun: result.canRun,
          counts: result.counts,
          blockerCodes: blockers.map((b) => b.code),
          warningCodes: warnings.map((w) => w.code),
        },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }

    return result;
  }
}

/** Return a Set of values that occur more than once in the input. */
function collectDuplicates<T>(xs: T[]): Set<T> {
  const seen = new Set<T>();
  const dupes = new Set<T>();
  for (const x of xs) {
    if (seen.has(x)) dupes.add(x);
    else seen.add(x);
  }
  return dupes;
}

// Re-export for convenience to controller-side consumers.
export type {
  PromotionIssue,
  PromotionIssueCode,
  PromotionPreviewEntry,
  PromotionValidationResult,
  Student as PromotionPreviewStudent,
};

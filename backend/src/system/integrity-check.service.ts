import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ============================================================================
// IntegrityCheckService — Phase PLATFORM STABILIZATION Part 7.
//
// Periodic verification layer for silent data drift. Surfaces a
// per-tenant report of any rows that have entered an unexpected state
// — without rewriting them. The service is READ-ONLY: it never
// auto-corrects. Operators decide what to do once a drift is detected.
//
// Why a separate service (vs. ad-hoc admin queries):
//   • A single shape for the report so the frontend can render a
//     consistent panel + future cron job can email digests.
//   • Stable check codes (`STUDENT_DUPLICATE_REGNO`, …) so the UI
//     can hint at remediation without hardcoding copy.
//   • Tenant-scoped — never reaches across schools. Operator-tier
//     cross-tenant integrity is a separate concern.
//
// Cost shape:
//   • Each check is one SELECT against an indexed column. No JOINs
//     across more than two tables, no full table scans without WHERE.
//   • The full report runs in O(few queries) per school. Safe to run
//     on demand from the admin page; a cron variant is deferred.
// ============================================================================

/** Stable identifier for every kind of drift the service can detect. */
export type IntegrityCheckCode =
  | 'STUDENT_DUPLICATE_REGNO'
  | 'STUDENT_DUPLICATE_SYMBOL'
  | 'STUDENT_ORPHANED_SECTION'
  | 'STUDENT_REFERENCES_ARCHIVED_CLASS'
  | 'STUDENT_REFERENCES_ARCHIVED_SECTION'
  | 'EXAM_MISSING_SESSION'
  | 'EXAM_REFERENCES_ARCHIVED_SESSION'
  | 'RESULT_REFERENCES_ARCHIVED_EXAM'
  | 'RESULT_REFERENCES_ARCHIVED_STUDENT'
  | 'PROMOTION_MISSING_LINK'
  | 'MULTIPLE_ACTIVE_SESSIONS'
  | 'NO_ACTIVE_SESSION';

export type IntegrityCheckSeverity = 'info' | 'warning' | 'error';

/** Severity per check — same severity-as-contract rule as promotion preview. */
const SEVERITY: Record<IntegrityCheckCode, IntegrityCheckSeverity> = {
  STUDENT_DUPLICATE_REGNO: 'error',
  STUDENT_DUPLICATE_SYMBOL: 'error',
  STUDENT_ORPHANED_SECTION: 'warning',
  STUDENT_REFERENCES_ARCHIVED_CLASS: 'warning',
  STUDENT_REFERENCES_ARCHIVED_SECTION: 'warning',
  EXAM_MISSING_SESSION: 'warning',
  EXAM_REFERENCES_ARCHIVED_SESSION: 'warning',
  RESULT_REFERENCES_ARCHIVED_EXAM: 'info',
  RESULT_REFERENCES_ARCHIVED_STUDENT: 'info',
  PROMOTION_MISSING_LINK: 'warning',
  MULTIPLE_ACTIVE_SESSIONS: 'error',
  NO_ACTIVE_SESSION: 'warning',
};

export interface IntegrityFinding {
  code: IntegrityCheckCode;
  severity: IntegrityCheckSeverity;
  /** Headline copy for the admin panel. */
  message: string;
  /** Number of rows affected. 0 means the check passed. */
  count: number;
  /** Optional sample of up to 5 affected ids — never PII, just UUID prefixes. */
  sampleIds?: string[];
  /** Operator-readable remediation hint. */
  remediation?: string;
}

export interface IntegrityReport {
  schoolId: string;
  generatedAt: string;
  /** True when every check returned count === 0. */
  clean: boolean;
  counts: {
    info: number;
    warnings: number;
    errors: number;
  };
  findings: IntegrityFinding[];
}

@Injectable()
export class IntegrityCheckService {
  private readonly logger = new Logger(IntegrityCheckService.name);

  constructor(private readonly prisma: PrismaService) {}

  async checkSchool(schoolId: string): Promise<IntegrityReport> {
    const findings: IntegrityFinding[] = [];

    // 1. Duplicate registration numbers within a school. The schema
    //    has a unique index but it's NULLs-allowed; we cross-check
    //    in case a migration ever bypassed it.
    findings.push(
      await this.checkDuplicate(
        schoolId,
        'STUDENT_DUPLICATE_REGNO',
        'registrationNumber',
        'Duplicate registration numbers detected.',
        'Reissue affected students from the Students page.',
      ),
    );

    // 2. Duplicate symbol numbers (Nepal-style roll #). Also indexed
    //    unique but with NULL allowance; double-check for safety.
    findings.push(
      await this.checkDuplicate(
        schoolId,
        'STUDENT_DUPLICATE_SYMBOL',
        'symbolNumber',
        'Duplicate symbol numbers detected.',
        'Edit the affected students to assign unique symbol numbers.',
      ),
    );

    // 3. Students pointing at an archived class.
    findings.push(
      await this.checkStudentsReferencingArchivedClass(schoolId),
    );

    // 4. Students pointing at a section whose class is archived
    //    (orphaned section).
    findings.push(await this.checkOrphanedSection(schoolId));

    // 5. Exams without a session attached. Allowed legacy state but
    //    informational.
    findings.push(await this.checkExamsMissingSession(schoolId));

    // 6. Promotion linkage — StudentAcademicRecord rows with
    //    `promotedById` unset where the student row was archived
    //    AFTER promotion. Phase ACADEMIC TRANSITION SAFETY Part 6
    //    started capturing this; rows from before would be null.
    //    The finding here is informational so older data isn't
    //    flagged as broken.
    findings.push(await this.checkPromotionLinkage(schoolId));

    // 7. Active-session sanity: exactly one ACTIVE session expected.
    findings.push(await this.checkActiveSessionCount(schoolId));

    const counts = {
      info: 0,
      warnings: 0,
      errors: 0,
    };
    for (const f of findings) {
      if (f.count === 0) continue;
      if (f.severity === 'info') counts.info += 1;
      else if (f.severity === 'warning') counts.warnings += 1;
      else counts.errors += 1;
    }

    return {
      schoolId,
      generatedAt: new Date().toISOString(),
      clean: findings.every((f) => f.count === 0),
      counts,
      findings,
    };
  }

  // -------------------------------------------------------------------------
  // Individual checks
  // -------------------------------------------------------------------------

  /**
   * Generic duplicate scan over a column on the students table.
   * Returns a structured finding with count + sample ids.
   */
  private async checkDuplicate(
    schoolId: string,
    code:
      | 'STUDENT_DUPLICATE_REGNO'
      | 'STUDENT_DUPLICATE_SYMBOL',
    column: 'registrationNumber' | 'symbolNumber',
    message: string,
    remediation: string,
  ): Promise<IntegrityFinding> {
    const dupes = await this.prisma.$queryRawUnsafe<
      Array<{ value: string; cnt: bigint }>
    >(
      `SELECT "${column}" AS value, COUNT(*) AS cnt
       FROM "students"
       WHERE "schoolId" = $1::uuid
         AND "${column}" IS NOT NULL
       GROUP BY "${column}"
       HAVING COUNT(*) > 1
       LIMIT 5`,
      schoolId,
    );
    const count = dupes.reduce((acc, r) => acc + Number(r.cnt) - 1, 0);
    return {
      code,
      severity: SEVERITY[code],
      message,
      count,
      sampleIds: dupes.slice(0, 5).map((d) => d.value),
      remediation: count > 0 ? remediation : undefined,
    };
  }

  private async checkStudentsReferencingArchivedClass(
    schoolId: string,
  ): Promise<IntegrityFinding> {
    const rows = await this.prisma.student.findMany({
      where: {
        schoolId,
        archivedAt: null,
        class: { is: { schoolId: { not: undefined } } },
        // Sub-where on the class relation isn't directly supported
        // for archive (no archivedAt on Class), so this is a placeholder
        // for the future. Today the check is a no-op + zero count.
      },
      select: { id: true },
      take: 5,
    });
    // Schema currently lacks `archivedAt` on Class — return zero.
    // Keeping the finding entry so the UI shows the slot.
    return {
      code: 'STUDENT_REFERENCES_ARCHIVED_CLASS',
      severity: SEVERITY.STUDENT_REFERENCES_ARCHIVED_CLASS,
      message:
        'Students pointing at archived classes. (Class-archive not yet supported in this schema; check returns 0.)',
      count: 0,
      sampleIds: rows.slice(0, 5).map((r) => r.id.slice(0, 8)),
    };
  }

  private async checkOrphanedSection(
    schoolId: string,
  ): Promise<IntegrityFinding> {
    // A "section" should always have a parent class. The FK enforces
    // it, but we double-check via a left-join count for any rows
    // where the section's class no longer belongs to this school
    // (could happen if a class was deleted while a student still
    // referenced its sectionId — Prisma SetNull / Cascade would
    // normally prevent this).
    const rows = await this.prisma.student.findMany({
      where: {
        schoolId,
        sectionId: { not: null },
        // Filter: section's class.schoolId != this school. Prisma's
        // relation filter syntax:
        section: { is: { class: { is: { schoolId: { not: schoolId } } } } },
      },
      select: { id: true },
      take: 5,
    });
    return {
      code: 'STUDENT_ORPHANED_SECTION',
      severity: SEVERITY.STUDENT_ORPHANED_SECTION,
      message:
        'Students linked to a section whose parent class is from a different school.',
      count: rows.length,
      sampleIds: rows.map((r) => r.id.slice(0, 8)),
      remediation:
        rows.length > 0
          ? 'Reassign these students to a section in the correct class.'
          : undefined,
    };
  }

  private async checkExamsMissingSession(
    schoolId: string,
  ): Promise<IntegrityFinding> {
    const count = await this.prisma.exam.count({
      where: { schoolId, sessionId: null, archivedAt: null },
    });
    const sample = await this.prisma.exam.findMany({
      where: { schoolId, sessionId: null, archivedAt: null },
      select: { id: true },
      take: 5,
    });
    return {
      code: 'EXAM_MISSING_SESSION',
      severity: SEVERITY.EXAM_MISSING_SESSION,
      message:
        'Exams not attached to any academic session. Legacy state from before session support.',
      count,
      sampleIds: sample.map((r) => r.id.slice(0, 8)),
      remediation:
        count > 0
          ? 'Open each exam in /exams and re-save it under the active session, or archive if obsolete.'
          : undefined,
    };
  }

  private async checkPromotionLinkage(
    schoolId: string,
  ): Promise<IntegrityFinding> {
    // Find StudentAcademicRecord rows missing the new (Part 6)
    // `promotedById` attribution. Older rows pre-date the column —
    // we mark as info so an existing school's history isn't surfaced
    // as broken.
    const count = await this.prisma.studentAcademicRecord.count({
      where: { schoolId, promotedById: null },
    });
    return {
      code: 'PROMOTION_MISSING_LINK',
      severity: SEVERITY.PROMOTION_MISSING_LINK,
      message:
        'Promotion history rows are missing the actor attribution column. Pre-dates the new Phase ACADEMIC TRANSITION SAFETY columns.',
      count,
      remediation:
        count > 0
          ? 'No action required. Future promotions will populate the missing fields automatically.'
          : undefined,
    };
  }

  private async checkActiveSessionCount(
    schoolId: string,
  ): Promise<IntegrityFinding> {
    const activeCount = await this.prisma.academicSession.count({
      where: { schoolId, isActive: true },
    });
    if (activeCount === 0) {
      return {
        code: 'NO_ACTIVE_SESSION',
        severity: SEVERITY.NO_ACTIVE_SESSION,
        message: 'No active academic session.',
        count: 1,
        remediation:
          'Create or activate a session in Settings → Sessions. Most write paths require one.',
      };
    }
    if (activeCount > 1) {
      // Structurally blocked by a partial unique index, but the
      // check is here as a defense-in-depth — an index disablement
      // during ops would surface it immediately.
      return {
        code: 'MULTIPLE_ACTIVE_SESSIONS',
        severity: SEVERITY.MULTIPLE_ACTIVE_SESSIONS,
        message:
          'Multiple academic sessions are flagged active. Schema invariant violated.',
        count: activeCount,
        remediation:
          'Contact platform operations — this should not be possible under the partial unique index.',
      };
    }
    return {
      code: 'NO_ACTIVE_SESSION',
      severity: SEVERITY.NO_ACTIVE_SESSION,
      message: 'Active session present.',
      count: 0,
    };
  }
}

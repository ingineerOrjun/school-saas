import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  ChangeKind,
  ContinuousRecord,
  EvalPhase,
  Prisma,
  SubjectCode,
} from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { TeacherScopeService } from '../common/auth/teacher-scope.service';
import { txWithRetry } from '../common/db/tx-retry';
import { PrismaService } from '../database/prisma.service';
import type { CreateContinuousRecordDto } from './dto/create-continuous-record.dto';
import type { ListContinuousRecordDto } from './dto/list-continuous-record.dto';

// ============================================================================
// ContinuousRecordService — CDC continuous-evaluation write surface.
//
// Three public methods:
//   • upsertSingle(input, user)  — POST /continuous-records
//   • upsertBulk(inputs, user)   — POST /continuous-records/bulk
//   • list(query, user)          — GET  /continuous-records
//
// Cross-cutting rules enforced inside this service (NOT at the
// controller layer) so future call sites — internal services, jobs,
// admin scripts — pick them up automatically:
//
//   • feature flag: gated at the controller via @RequireFeature
//   • JWT auth: gated at the controller via JwtAuthGuard
//   • roles: gated at the controller via RolesGuard / @Roles
//   • session lock: AcademicSessionService.assertSessionUnlocked()
//                   (same call exam.service.ts + result.service.ts use;
//                    throws BadRequestException → HTTP 400)
//   • teacher scope: TeacherScopeService.assertContinuousRecordAccess()
//                    (ADMIN + STAFF bypass; TEACHER must have a
//                    TeachingAssignment matching the student's class +
//                    the outcome's subject)
//   • AFTER_SUPPORT precondition: a REGULAR row with rating ≤ 2 must
//                                 exist for the same (student, outcome,
//                                 session). Reject with 422 otherwise.
//   • duplicate composite keys inside one bulk payload: reject with 400.
//   • optimistic concurrency: if expectedUpdatedAt is provided AND the
//                             stored updatedAt differs, fail the call
//                             (or, in bulk, the whole transaction)
//                             with ConflictException carrying code
//                             CONCURRENT_MODIFICATION.
//
// Audit history is append-only — every accepted upsert writes one
// `continuous_record_history` row with the previous values snapshotted
// (null on CREATE rows). History writes share the transaction with the
// main record, so a rollback wipes both.
// ============================================================================

/** Service-layer copy IDs — stable strings for tests + frontend. */
export const CONTINUOUS_RECORD_FAILURE = {
  SESSION_LOCKED: 'This session is locked. Writes are no longer permitted.',
  // AFTER_SUPPORT_REQUIRES_REGULAR removed in Deviation 001 —
  // AFTER_SUPPORT is now allowed for any REGULAR rating value (or
  // even when no REGULAR exists). See backend/docs/cdc-compliance-
  // deviations.md.
  TEACHER_NOT_ASSIGNED:
    'You are not assigned to evaluate this student for this subject.',
  DUPLICATE_BULK_ENTRY:
    'Bulk payload contains duplicate entries for the same student/outcome/session/phase.',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
} as const;

/** Outcome row shape we hydrate to authorize a write. */
interface OutcomeForScope {
  id: string;
  classLevel: number;
  subjectCode: SubjectCode;
}

@Injectable()
export class ContinuousRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
    private readonly scope: TeacherScopeService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /continuous-records — single upsert
  // ---------------------------------------------------------------------------
  async upsertSingle(
    input: CreateContinuousRecordDto,
    user: AuthenticatedUser,
  ): Promise<ContinuousRecord> {
    // 1. Session lock — same call exam/result writes use. Throws
    //    BadRequestException (HTTP 400). See AcademicSessionService.
    await this.sessions.assertSessionUnlocked(input.sessionId);

    // 2. Outcome must exist (FK enforces this on insert, but reading it
    //    upfront lets us authorize the teacher scope using its
    //    classLevel + subjectCode without trusting client-supplied data).
    const outcome = await this.requireOutcome(input.outcomeId);

    // 3. Teacher scope — ADMIN/STAFF bypass; TEACHER must match the
    //    student's class + the outcome's subject + (school is implicit
    //    via assertContinuousRecordAccess's tenant-filtered query).
    await this.scope.assertContinuousRecordAccess(user, {
      studentId: input.studentId,
      subjectCode: outcome.subjectCode,
    });

    // 4. AFTER_SUPPORT is allowed for any REGULAR rating per
    //    Deviation 001 (see backend/docs/cdc-compliance-deviations.md).
    //    The CDC framework originally restricted AFTER_SUPPORT to
    //    REGULAR ≤ 2 cases, but the product allows universal
    //    AFTER_SUPPORT for UX reasons. The frontend renders
    //    AFTER_SUPPORT buttons inline for every student.

    // 5. Write under a retryable transaction so concurrent upserts of
    //    the same composite key never duplicate the history row.
    return txWithRetry(
      this.prisma,
      async (tx) => {
        return this.upsertOne(tx, input, user, /* schoolId */ outcome);
      },
      { label: 'continuous-record-upsert' },
    );
  }

  // ---------------------------------------------------------------------------
  // POST /continuous-records/bulk — atomic bulk upsert
  // ---------------------------------------------------------------------------
  async upsertBulk(
    inputs: CreateContinuousRecordDto[],
    user: AuthenticatedUser,
  ): Promise<ContinuousRecord[]> {
    // 0. Duplicate composite keys inside the payload — reject before any
    //    DB round-trip so the operator gets a clean 400 instead of a
    //    cryptic upsert race.
    const seen = new Set<string>();
    for (const r of inputs) {
      const key = `${r.studentId}|${r.outcomeId}|${r.sessionId}|${r.phase}`;
      if (seen.has(key)) {
        throw new BadRequestException(
          CONTINUOUS_RECORD_FAILURE.DUPLICATE_BULK_ENTRY,
        );
      }
      seen.add(key);
    }

    // 1. Pre-validation — every input runs through the same gates as
     //   `upsertSingle` BEFORE we open the transaction. The spec is
     //   explicit: if ANY input is invalid, NO writes happen. Collecting
     //   all the errors at once would be nicer UX but the spec asks for
     //   fail-fast, so first-error wins.
    //
    //   Each unique sessionId / outcomeId is read at most once via a
    //   small memoization map — bulk payloads tend to repeat both.
    const sessionLockCache = new Map<string, void>();
    const outcomeCache = new Map<string, OutcomeForScope>();
    for (const input of inputs) {
      if (!sessionLockCache.has(input.sessionId)) {
        await this.sessions.assertSessionUnlocked(input.sessionId);
        sessionLockCache.set(input.sessionId);
      }
      let outcome = outcomeCache.get(input.outcomeId);
      if (!outcome) {
        outcome = await this.requireOutcome(input.outcomeId);
        outcomeCache.set(input.outcomeId, outcome);
      }
      await this.scope.assertContinuousRecordAccess(user, {
        studentId: input.studentId,
        subjectCode: outcome.subjectCode,
      });
      // AFTER_SUPPORT precondition removed per Deviation 001
      // (see backend/docs/cdc-compliance-deviations.md). Bulk path
      // mirrors the single-record path: any phase is acceptable.
    }

    // 2. All-or-nothing transaction. Per-record optimistic-concurrency
    //    check sits INSIDE the loop — first stale match collapses the
    //    whole batch via ConflictException.
    return txWithRetry(
      this.prisma,
      async (tx) => {
        const saved: ContinuousRecord[] = [];
        for (const input of inputs) {
          const outcome = outcomeCache.get(input.outcomeId)!;
          if (input.expectedUpdatedAt) {
            const existing = await tx.continuousRecord.findUnique({
              where: this.uniqueKey(input),
              select: { updatedAt: true },
            });
            // A row currently absent is fine — `expectedUpdatedAt` is a
            // stale-write guard, not a "row must exist" assertion. Only
            // a mismatch when a row DOES exist counts as a conflict.
            if (
              existing &&
              existing.updatedAt.toISOString() !== input.expectedUpdatedAt
            ) {
              throw new ConflictException(
                this.concurrentModificationMessage(input),
              );
            }
          }
          saved.push(await this.upsertOne(tx, input, user, outcome));
        }
        return saved;
      },
      { label: 'continuous-record-bulk-upsert' },
    );
  }

  // ---------------------------------------------------------------------------
  // GET /continuous-records — list (read-only)
  // ---------------------------------------------------------------------------
  async list(
    query: ListContinuousRecordDto,
    user: AuthenticatedUser,
  ): Promise<ContinuousRecord[]> {
    // SUPER_ADMIN bypasses tenant filter; everyone else stays inside
    // their school. Roles that reach here have already been gated by
    // RolesGuard (TEACHER / ADMIN / STAFF / SUPER_ADMIN).
    const tenantClause =
      user.role === 'SUPER_ADMIN' ? {} : { schoolId: user.schoolId };

    // Teacher-scope: a TEACHER reading another student's records must
    // also be assigned to that student's class. ADMIN + STAFF skip via
    // the bypass branch inside `assertContinuousRecordAccess`. For the
    // list endpoint we don't always have a SubjectCode (it's optional),
    // so we make a best-effort check: when subjectCode is supplied we
    // run the full assertion; when it's not, we only run the class /
    // section gate via assertStudentsInScope.
    if (user.role !== 'SUPER_ADMIN') {
      if (query.subjectCode) {
        await this.scope.assertContinuousRecordAccess(user, {
          studentId: query.studentId,
          subjectCode: query.subjectCode,
        });
      } else {
        await this.scope.assertStudentsInScope(user, [query.studentId]);
      }
    }

    return this.prisma.continuousRecord.findMany({
      where: {
        ...tenantClause,
        studentId: query.studentId,
        sessionId: query.sessionId,
        outcome: {
          ...(query.subjectCode ? { subjectCode: query.subjectCode } : {}),
          ...(query.classLevel ? { classLevel: query.classLevel } : {}),
        },
      },
      include: { outcome: true },
      orderBy: [
        { outcome: { unitNumber: 'asc' } },
        { outcome: { sortOrder: 'asc' } },
        // REGULAR sorts before AFTER_SUPPORT alphabetically — explicit
        // here so the contract doesn't drift if either enum value
        // changes name in the future.
        { phase: 'asc' },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Composite-unique key used by every upsert path. */
  private uniqueKey(
    input: Pick<
      CreateContinuousRecordDto,
      'studentId' | 'outcomeId' | 'sessionId' | 'phase'
    >,
  ): Prisma.ContinuousRecordWhereUniqueInput {
    return {
      studentId_outcomeId_sessionId_phase: {
        studentId: input.studentId,
        outcomeId: input.outcomeId,
        sessionId: input.sessionId,
        phase: input.phase,
      },
    };
  }

  private concurrentModificationMessage(
    input: Pick<CreateContinuousRecordDto, 'studentId' | 'outcomeId' | 'phase'>,
  ): string {
    return `${CONTINUOUS_RECORD_FAILURE.CONCURRENT_MODIFICATION}: stale write for student=${input.studentId} outcome=${input.outcomeId} phase=${input.phase}. Refetch and retry.`;
  }

  /**
   * Hydrate a LearningOutcome row + 404-style 403 if missing. Returns
   * the small subset of fields the service actually consumes.
   */
  private async requireOutcome(outcomeId: string): Promise<OutcomeForScope> {
    const outcome = await this.prisma.learningOutcome.findUnique({
      where: { id: outcomeId },
      select: { id: true, classLevel: true, subjectCode: true },
    });
    if (!outcome) {
      // We surface this as a 403 (not a 404) intentionally — leaking
      // "this outcome id doesn't exist" to a random caller is a tiny
      // information disclosure. The frontend never types raw ids; this
      // path fires only on tampered requests.
      throw new ForbiddenException(
        CONTINUOUS_RECORD_FAILURE.TEACHER_NOT_ASSIGNED,
      );
    }
    return outcome;
  }

  // Note: the `assertAfterSupportAllowed` private method and the
  // `AFTER_SUPPORT_REQUIRES_REGULAR` failure copy were removed in
  // Deviation 001 (see backend/docs/cdc-compliance-deviations.md).
  // If we ever restore CDC-strict mode, both should come back as a
  // unit — the message string was part of the user-facing contract.

  /**
   * Apply one upsert + history row inside a transaction client. The
   * read-before-write pattern lets us snapshot the previous values onto
   * the history row when this is an UPDATE; a Prisma `upsert` cannot
   * report whether it inserted vs updated, so we make the branching
   * explicit. The findUnique runs first inside the transaction so the
   * read is consistent with the write.
   */
  private async upsertOne(
    tx: Prisma.TransactionClient,
    input: CreateContinuousRecordDto,
    user: AuthenticatedUser,
    outcome: OutcomeForScope,
  ): Promise<ContinuousRecord> {
    // Resolve the school the record belongs to: STAFF/ADMIN write under
    // their user.schoolId, TEACHER same. The student MUST be in that
    // school (the scope helper above already enforced this for
    // TEACHER; for ADMIN/STAFF the tenant clause below catches it).
    // Reading the student here gives us a tenant guard for non-TEACHER
    // callers without an extra DB round-trip on the happy path.
    const student = await tx.student.findFirst({
      where: { id: input.studentId, schoolId: user.schoolId },
      select: { schoolId: true },
    });
    if (!student) {
      throw new ForbiddenException(
        CONTINUOUS_RECORD_FAILURE.TEACHER_NOT_ASSIGNED,
      );
    }

    const existing = await tx.continuousRecord.findUnique({
      where: this.uniqueKey(input),
    });

    if (existing) {
      // expectedUpdatedAt check for the single-record path lives here
      // (in the transaction) so retries observe the latest committed
      // state. The bulk path runs an equivalent check just above.
      if (
        input.expectedUpdatedAt &&
        existing.updatedAt.toISOString() !== input.expectedUpdatedAt
      ) {
        throw new ConflictException(
          this.concurrentModificationMessage(input),
        );
      }

      const updated = await tx.continuousRecord.update({
        where: { id: existing.id },
        data: {
          rating: input.rating,
          notes: input.notes ?? null,
          updatedById: user.id,
        },
      });
      await tx.continuousRecordHistory.create({
        data: {
          recordId: updated.id,
          changeKind: ChangeKind.UPDATE,
          rating: updated.rating,
          phase: updated.phase,
          notes: updated.notes,
          previousRating: existing.rating,
          previousNotes: existing.notes,
          changedById: user.id,
        },
      });
      return updated;
    }

    const created = await tx.continuousRecord.create({
      data: {
        schoolId: student.schoolId,
        studentId: input.studentId,
        outcomeId: input.outcomeId,
        sessionId: input.sessionId,
        phase: input.phase,
        rating: input.rating,
        notes: input.notes ?? null,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await tx.continuousRecordHistory.create({
      data: {
        recordId: created.id,
        changeKind: ChangeKind.CREATE,
        rating: created.rating,
        phase: created.phase,
        notes: created.notes,
        previousRating: null,
        previousNotes: null,
        changedById: user.id,
      },
    });
    return created;
  }
}

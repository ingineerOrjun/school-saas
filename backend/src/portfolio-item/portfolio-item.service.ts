import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PortfolioItem,
  Prisma,
  SubjectCode,
} from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { TeacherScopeService } from '../common/auth/teacher-scope.service';
import { txWithRetry } from '../common/db/tx-retry';
import { PrismaService } from '../database/prisma.service';
import type { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';
import type { ListPortfolioItemsDto } from './dto/list-portfolio-items.dto';
import type { UpdatePortfolioItemDto } from './dto/update-portfolio-item.dto';

// ============================================================================
// PortfolioItemService — CDC portfolio-item write surface (Session 4).
//
// Public surface:
//   • create(input, user)    — POST   /portfolio-items
//   • update(id, dto, user)  — PATCH  /portfolio-items/:id
//   • list(query, user)      — GET    /portfolio-items
//
// Cross-cutting rules (mirrored from ContinuousRecordService so the
// two write paths fail/succeed for the same reasons):
//
//   • feature flag (controller-level @RequireFeature(ConEvaluation))
//   • JWT auth + roles guard (controller-level)
//   • session lock: AcademicSessionService.assertSessionUnlocked(),
//                   throws BadRequestException with the SAME copy
//                   exam.service.ts and continuous-record.service.ts
//                   use ("This session is locked. Writes are no
//                   longer permitted.")
//   • teacher scope: TeacherScopeService.assertPortfolioItemAccess()
//                    — ADMIN + STAFF bypass; TEACHER must have a
//                    matching TeachingAssignment. Subject match is
//                    only required when an outcomeId is in play.
//   • tenant: every read / write filters by user.schoolId. SUPER_ADMIN
//             passes through the same checks because portfolio items
//             are intrinsically tenant-scoped (no platform-global use
//             case the way LearningOutcome has).
//   • occurredOn envelope: ≥ session.startDate AND ≤ today.
//
// Audit history (PortfolioItemHistory) is append-only:
//   • create writes one row with previousDescription = null,
//     newDescription = the input description.
//   • update writes one row with previousDescription = the row's
//     PRE-update description, newDescription = the new one.
//   • The history insert shares the transaction with the
//     create/update, so a rollback wipes both.
// ============================================================================

/** Service-layer copy IDs — stable strings for tests + frontend. */
export const PORTFOLIO_ITEM_FAILURE = {
  SESSION_LOCKED: 'This session is locked. Writes are no longer permitted.',
  TEACHER_NOT_ASSIGNED:
    'You are not assigned to record portfolio items for this student.',
  STUDENT_NOT_FOUND: 'Student not found in your school.',
  SESSION_NOT_FOUND: 'Academic session not found in your school.',
  OUTCOME_NOT_FOUND: 'Learning outcome not found.',
  OCCURRED_ON_FUTURE:
    'occurredOn must be today or earlier — future-dated portfolio items are not allowed.',
  OCCURRED_ON_BEFORE_SESSION:
    'occurredOn must be on or after the academic session start date.',
  ITEM_NOT_FOUND: 'Portfolio item not found.',
} as const;

/** Outcome row hydrated when an outcomeId is supplied. */
interface OutcomeForScope {
  id: string;
  subjectCode: SubjectCode;
}

@Injectable()
export class PortfolioItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
    private readonly scope: TeacherScopeService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /portfolio-items
  // ---------------------------------------------------------------------------
  async create(
    input: CreatePortfolioItemDto,
    user: AuthenticatedUser,
  ): Promise<PortfolioItem> {
    // 1. Session lock — first gate, cheapest failure path. Same
    //    BadRequestException ContinuousRecord uses.
    await this.sessions.assertSessionUnlocked(input.sessionId);

    // 2. Tenant guards: student + session must belong to caller's
    //    school. Fetch both up-front so a malformed payload (e.g.
    //    student in school A + session in school B) fails fast with
    //    a clear message instead of falling out the FK constraint
    //    side. We need the session anyway for the occurredOn check.
    const [student, session] = await Promise.all([
      this.prisma.student.findFirst({
        where: { id: input.studentId, schoolId: user.schoolId },
        select: { id: true, schoolId: true },
      }),
      this.prisma.academicSession.findFirst({
        where: { id: input.sessionId, schoolId: user.schoolId },
        select: { id: true, startDate: true },
      }),
    ]);
    if (!student) {
      throw new NotFoundException(PORTFOLIO_ITEM_FAILURE.STUDENT_NOT_FOUND);
    }
    if (!session) {
      throw new NotFoundException(PORTFOLIO_ITEM_FAILURE.SESSION_NOT_FOUND);
    }

    // 3. Outcome hydrate (when supplied). LearningOutcome is
    //    platform-global, so no tenant filter — but we DO need the
    //    subjectCode to enforce teacher scope.
    let outcome: OutcomeForScope | null = null;
    if (input.outcomeId) {
      const found = await this.prisma.learningOutcome.findUnique({
        where: { id: input.outcomeId },
        select: { id: true, subjectCode: true },
      });
      if (!found) {
        throw new NotFoundException(PORTFOLIO_ITEM_FAILURE.OUTCOME_NOT_FOUND);
      }
      outcome = found;
    }

    // 4. Teacher scope. Subject is required iff outcomeId was provided.
    await this.scope.assertPortfolioItemAccess(user, {
      studentId: input.studentId,
      subjectCode: outcome ? outcome.subjectCode : null,
    });

    // 5. occurredOn envelope. Both bounds are INCLUSIVE per spec:
    //    "today and session.startDate both accepted".
    this.assertOccurredOnInWindow(input.occurredOn, session.startDate);

    // 6. Write under a retryable transaction. The CREATE-history row
    //    intentionally duplicates the description for audit-trail
    //    parity with ContinuousRecord's CREATE history (so the first
    //    entry in every item's history is a CREATE event with the
    //    full original description snapshotted).
    return txWithRetry(
      this.prisma,
      async (tx) => {
        const created = await tx.portfolioItem.create({
          data: {
            schoolId: student.schoolId,
            studentId: input.studentId,
            sessionId: input.sessionId,
            outcomeId: input.outcomeId ?? null,
            type: input.type,
            description: input.description,
            occurredOn: new Date(input.occurredOn),
            fileUrl: input.fileUrl ?? null,
            createdById: user.id,
            updatedById: user.id,
          },
        });
        await tx.portfolioItemHistory.create({
          data: {
            portfolioItemId: created.id,
            previousDescription: null,
            newDescription: created.description,
            changedById: user.id,
          },
        });
        return created;
      },
      { label: 'portfolio-item-create' },
    );
  }

  // ---------------------------------------------------------------------------
  // PATCH /portfolio-items/:id  — description-only
  // ---------------------------------------------------------------------------
  async update(
    id: string,
    dto: UpdatePortfolioItemDto,
    user: AuthenticatedUser,
  ): Promise<PortfolioItem> {
    // 1. Load the existing row + the session it belongs to in a
    //    single round-trip so we know:
    //      (a) the item exists in the caller's school (tenant)
    //      (b) the bound session for the lock check
    //      (c) the outcomeId (drives subject-aware scope check)
    //      (d) the pre-update description for the history snapshot
    const existing = await this.prisma.portfolioItem.findFirst({
      where: { id, schoolId: user.schoolId },
      select: {
        id: true,
        studentId: true,
        sessionId: true,
        outcomeId: true,
        description: true,
        outcome: { select: { subjectCode: true } },
      },
    });
    if (!existing) {
      // Tenant isolation: items in OTHER schools surface as 404 —
      // we do not confirm-or-deny existence across the tenant boundary.
      // Matches the pattern in student-archive and other admin paths.
      throw new NotFoundException(PORTFOLIO_ITEM_FAILURE.ITEM_NOT_FOUND);
    }

    // 2. Session lock guard, same call/copy ContinuousRecord uses.
    await this.sessions.assertSessionUnlocked(existing.sessionId);

    // 3. Teacher scope, parameterized on whether the existing item is
    //    tied to an outcome. (We don't allow the PATCH to re-link to
    //    a different outcome; description-only.)
    await this.scope.assertPortfolioItemAccess(user, {
      studentId: existing.studentId,
      subjectCode: existing.outcome?.subjectCode ?? null,
    });

    // 4. Defensive sanity check on the DTO — the global ValidationPipe
    //    with forbidNonWhitelisted should have already rejected stray
    //    fields, but a service-layer assertion documents intent and
    //    survives any pipeline misconfiguration. We compare the keys
    //    of the dto object to the known-allowed set.
    const allowedKeys = new Set(['description']);
    const extraKeys = Object.keys(
      dto as unknown as Record<string, unknown>,
    ).filter((k) => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      throw new BadRequestException(
        `Only 'description' may be updated. Unexpected fields: ${extraKeys.join(', ')}`,
      );
    }

    // 5. Write update + history row atomically. Note that we DO NOT
    //    touch type / occurredOn / studentId / sessionId / outcomeId /
    //    fileUrl / schoolId — Prisma's `update` only writes the
    //    fields listed in `data`. updatedAt is bumped by @updatedAt.
    return txWithRetry(
      this.prisma,
      async (tx) => {
        const updated = await tx.portfolioItem.update({
          where: { id: existing.id },
          data: {
            description: dto.description,
            updatedById: user.id,
          },
        });
        await tx.portfolioItemHistory.create({
          data: {
            portfolioItemId: updated.id,
            previousDescription: existing.description,
            newDescription: updated.description,
            changedById: user.id,
          },
        });
        return updated;
      },
      { label: 'portfolio-item-update' },
    );
  }

  // ---------------------------------------------------------------------------
  // GET /portfolio-items
  // ---------------------------------------------------------------------------
  async list(query: ListPortfolioItemsDto, user: AuthenticatedUser) {
    // 1. Tenant: confirm the student belongs to the caller's school.
    //    We don't need to fetch the session — listing on a session in
    //    another school is harmless because the schoolId filter below
    //    is the authoritative gate, but failing fast with a clear 404
    //    on the student is friendlier for the frontend.
    const student = await this.prisma.student.findFirst({
      where: { id: query.studentId, schoolId: user.schoolId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException(PORTFOLIO_ITEM_FAILURE.STUDENT_NOT_FOUND);
    }

    // 2. Teacher scope. When outcomeId is supplied as a filter, we
    //    hydrate the outcome to pass its subjectCode down. When it's
    //    not, we drop the subject requirement (the GET endpoint is the
    //    one place where "any-teacher-of-this-class can read" lines
    //    up with the broader spirit of the portfolio view).
    let outcomeSubject: SubjectCode | null = null;
    if (query.outcomeId) {
      const outcome = await this.prisma.learningOutcome.findUnique({
        where: { id: query.outcomeId },
        select: { subjectCode: true },
      });
      // We allow the read to proceed even if the outcomeId is unknown
      // (filter just yields no results), but if we DID find it we use
      // its subjectCode for the scope check.
      outcomeSubject = outcome?.subjectCode ?? null;
    }
    await this.scope.assertPortfolioItemAccess(user, {
      studentId: query.studentId,
      subjectCode: outcomeSubject,
    });

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const rows = await this.prisma.portfolioItem.findMany({
      where: {
        schoolId: user.schoolId,
        studentId: query.studentId,
        sessionId: query.sessionId,
        ...(query.outcomeId ? { outcomeId: query.outcomeId } : {}),
      },
      include: {
        outcome: {
          select: {
            id: true,
            unitTitleEn: true,
            descriptionEn: true,
            subjectCode: true,
            classLevel: true,
          },
        },
        // CRITICAL — Session 4.1 fix: do NOT include `email` here.
        // Surfacing a peer teacher's login email to other teachers in
        // the same school is a privacy regression (the spec asks for
        // `{ id, name }`). Instead, hydrate the User's optional
        // Teacher + Student profile rows and post-resolve a display
        // name below. `User.name` does NOT exist on this schema —
        // names live on the profile rows.
        createdBy: {
          select: {
            id: true,
            teacher: { select: { name: true } },
            student: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
    });

    // Flatten `createdBy` to the public `{ id, name }` shape so the
    // raw User → Teacher / Student graph never leaks past the service
    // boundary. Resolution order:
    //   1. User deleted (createdBy === null, the onDelete: SetNull
    //      branch) → null. Frontend treats absent createdBy as
    //      "actor no longer in system".
    //   2. Teacher profile present → teacher.name. Covers >99% of
    //      writes in practice (TEACHER role is the primary author).
    //   3. Student profile present → `firstName lastName`.
    //      Future-proofing: today no role-gated write path lets a
    //      STUDENT create a portfolio item, but the shape lines up
    //      cleanly if that changes (e.g. a self-portfolio surface).
    //   4. Neither profile (ADMIN / STAFF / SUPER_ADMIN — no Teacher
    //      or Student row by design) → 'Administrator'. Generic on
    //      purpose: leaking "Principal Sharma is the one who logged
    //      this" cross-tenant via SUPER_ADMIN would re-introduce the
    //      same privacy issue the email change was meant to fix.
    return rows.map(({ createdBy, ...rest }) => ({
      ...rest,
      createdBy: resolveCreatedByName(createdBy),
    }));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Validate `occurredOn` falls inside `[session.startDate, today]`
   * INCLUSIVE on both ends. We compare at DAY granularity (both
   * boundaries are dates without time, and JS Date comparisons of
   * "today" vs an arbitrary timestamp can wobble across timezones).
   * Stripping to UTC-midnight on both sides makes the rule
   * timezone-stable for the deployments this service ships to (Nepal
   * Standard Time = UTC+5:45; even with the offset, day boundaries
   * compared at UTC midnight match calendar-day intent because both
   * inputs are normalized the same way).
   */
  private assertOccurredOnInWindow(
    occurredOnIso: string,
    sessionStart: Date,
  ): void {
    const occurred = startOfUtcDay(new Date(occurredOnIso));
    const today = startOfUtcDay(new Date());
    const start = startOfUtcDay(sessionStart);

    if (occurred.getTime() > today.getTime()) {
      throw new BadRequestException(PORTFOLIO_ITEM_FAILURE.OCCURRED_ON_FUTURE);
    }
    if (occurred.getTime() < start.getTime()) {
      throw new BadRequestException(
        PORTFOLIO_ITEM_FAILURE.OCCURRED_ON_BEFORE_SESSION,
      );
    }
  }
}

/**
 * Strip a Date to its UTC-midnight equivalent. Helper sits outside
 * the class so it can be unit-tested cheaply without instantiating
 * the service. Exported is unnecessary — the spec covers temporal
 * behavior via the create/update integration tests.
 */
function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Hydrated User → display `{ id, name }` for GET responses. */
interface HydratedCreatedBy {
  id: string;
  teacher: { name: string } | null;
  student: { firstName: string; lastName: string } | null;
}

/**
 * Resolve a hydrated User to the public `{ id, name }` shape used by
 * the GET /portfolio-items response. See the inline rationale in
 * `list()`; this is the single source of truth for the resolution
 * order so it stays consistent if a future endpoint reuses it.
 */
export function resolveCreatedByName(
  createdBy: HydratedCreatedBy | null,
): { id: string; name: string } | null {
  if (createdBy === null) return null;
  if (createdBy.teacher) {
    return { id: createdBy.id, name: createdBy.teacher.name };
  }
  if (createdBy.student) {
    const full = `${createdBy.student.firstName} ${createdBy.student.lastName}`.trim();
    return { id: createdBy.id, name: full.length > 0 ? full : 'Unknown' };
  }
  // ADMIN / STAFF / SUPER_ADMIN — no profile row by design. Generic
  // label avoids leaking the operator's identity cross-tenant.
  return { id: createdBy.id, name: 'Administrator' };
}

// Re-exported for the controller's success-status mapping (Prisma's
// generated type lives at `@prisma/client`; this alias keeps the
// controller's import surface narrow).
export type { PortfolioItem };
// Avoid an unused-import flag on Prisma — it's there for callers who
// want the generated `WhereInput` types downstream.
export type PortfolioItemWhereInput = Prisma.PortfolioItemWhereInput;

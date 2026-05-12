import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { txWithRetry } from '../common/db/tx-retry';
import { PrismaService } from '../database/prisma.service';
import {
  BulkAssignmentTupleDto,
  BulkTeachingAssignmentsDto,
} from './dto/bulk-teaching-assignments.dto';
import { CreateTeachingAssignmentDto } from './dto/create-teaching-assignment.dto';

const teachingAssignmentInclude = {
  class: { select: { id: true, name: true } },
  section: {
    select: {
      id: true,
      name: true,
      class: { select: { id: true, name: true } },
    },
  },
  subject: { select: { id: true, name: true } },
} satisfies Prisma.TeachingAssignmentInclude;

export type TeachingAssignmentWithRefs = Prisma.TeachingAssignmentGetPayload<{
  include: typeof teachingAssignmentInclude;
}>;

@Injectable()
export class TeachingAssignmentService {
  private readonly logger = new Logger(TeachingAssignmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List every assignment for a teacher in the caller's school. The
   * teacher's existence + tenant ownership are validated before the
   * read so a cross-tenant `teacherId` returns 404, not an empty list.
   */
  async listForTeacher(
    teacherId: string,
    schoolId: string,
  ): Promise<TeachingAssignmentWithRefs[]> {
    await this.assertTeacherInSchool(teacherId, schoolId);
    return this.prisma.teachingAssignment.findMany({
      where: { teacherId, schoolId },
      include: teachingAssignmentInclude,
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  /**
   * Same as `listForTeacher` but resolves the teacher row from a User
   * id. Used by `/teachers/me/assignments` from the teacher dashboard.
   *
   * Returns empty array when the teacher row doesn't exist (e.g., a
   * logged-in user has TEACHER role but no Teacher profile yet).
   *
   * The legacy "self-heal from Teacher.classId" path is GONE — the
   * legacy columns were dropped in the 20260511 migration. The
   * AssignmentsDialog grid + the bulk endpoint are the only ways to
   * create assignments now.
   *
   * Diagnostic logging: every call records the (userId → teacherId)
   * resolution and the resulting count, so the "I assigned them but
   * nothing showed up" support tickets can be triaged from the server
   * log without redeploying. When NO assignments come back we also
   * scan for duplicate Teacher rows that share the user's email — a
   * concrete scenario where assignments would land on a different
   * Teacher row than the one the dashboard reads from.
   */
  async listForUser(
    userId: string,
    schoolId: string,
  ): Promise<TeachingAssignmentWithRefs[]> {
    const teacher = await this.prisma.teacher.findFirst({
      where: { userId, schoolId },
      select: { id: true },
    });

    this.logger.log(
      `[listForUser] userId=${userId} schoolId=${schoolId} resolvedTeacherId=${teacher?.id ?? 'null'}`,
    );

    if (!teacher) {
      // Strict role/profile coupling: a User with role=TEACHER MUST
      // have a Teacher row. Hitting this branch means the data drifted
      // (the Teacher was deleted but the User still has TEACHER role
      // and a valid token). The frontend's global 403 handler turns
      // this into "log out + redirect to /login", which is the only
      // safe response — admins must re-create the Teacher profile or
      // change the User's role before this account can be useful.
      this.logger.warn(
        `[listForUser] No Teacher row for userId=${userId} in schoolId=${schoolId} — rejecting with 403.`,
      );
      throw new ForbiddenException(
        'No teacher profile linked to this account.',
      );
    }

    const rows = await this.prisma.teachingAssignment.findMany({
      where: { teacherId: teacher.id, schoolId },
      include: teachingAssignmentInclude,
      orderBy: [{ createdAt: 'asc' }],
    });

    this.logger.log(
      `[listForUser] teacherId=${teacher.id} returned ${rows.length} assignment(s)`,
    );

    // Fallback diagnostic: empty result + same email points at another
    // Teacher row → assignments are likely sitting on the wrong row.
    // Only scan when we'd otherwise return [] so the hot path stays
    // single-query.
    if (rows.length === 0) {
      await this.warnIfDuplicateTeacherShareEmail(userId, teacher.id, schoolId);
    }

    return rows;
  }

  /**
   * Diagnostic: when a teacher's dashboard load comes back empty,
   * check whether ANOTHER Teacher row in the same school points at a
   * User with the same email as the caller. That's the failure mode
   * the visibility-issue ticket is actually about: the admin assigned
   * classes to a stale Teacher row (a different `userId`) but the
   * caller's User points at a different Teacher row.
   *
   * Best-effort and silent on failure — the call is purely for
   * triage. Production behavior never changes based on its result.
   */
  private async warnIfDuplicateTeacherShareEmail(
    userId: string,
    currentTeacherId: string,
    schoolId: string,
  ): Promise<void> {
    try {
      const me = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (!me) return;
      const others = await this.prisma.teacher.findMany({
        where: {
          schoolId,
          id: { not: currentTeacherId },
          user: { email: me.email },
        },
        select: { id: true, userId: true },
      });
      if (others.length > 0) {
        this.logger.warn(
          `[listForUser] DUPLICATE TEACHER DETECTED: caller userId=${userId} ` +
            `(email=${me.email}) is on Teacher.id=${currentTeacherId}, but ` +
            `${others.length} other Teacher row(s) in the same school share ` +
            `that email: ${others.map((o) => `id=${o.id} userId=${o.userId}`).join('; ')}. ` +
            `Assignments may have been written to the wrong row.`,
        );
      }
    } catch (err) {
      // Never let the diagnostic break the request.
      this.logger.warn(
        `[listForUser] duplicate-teacher scan failed: ${(err as Error).message ?? err}`,
      );
    }
  }

  /**
   * Create a new (teacher × class × optional section × optional subject)
   * row. Validates that:
   *   • the teacher exists in this school
   *   • the class exists in this school
   *   • the section, if set, belongs to that class
   *   • the subject, if set, belongs to this school
   *   • there's no existing duplicate row (the unique index handles
   *     non-null tuples; we hand-check the all-nulls case)
   */
  async create(
    teacherId: string,
    dto: CreateTeachingAssignmentDto,
    schoolId: string,
  ): Promise<TeachingAssignmentWithRefs> {
    await this.assertTeacherInSchool(teacherId, schoolId);

    // Class tenant guard.
    const klass = await this.prisma.class.findFirst({
      where: { id: dto.classId, schoolId },
      select: { id: true },
    });
    if (!klass) {
      throw new BadRequestException('Class does not belong to this school.');
    }

    // Section: must live UNDER the requested class. We don't trust the
    // caller to pre-validate; cross-class section ids are silently
    // rejected here.
    let sectionId: string | null = null;
    if (dto.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: dto.sectionId, classId: dto.classId },
        select: { id: true },
      });
      if (!section) {
        throw new BadRequestException(
          'Section does not belong to the specified class.',
        );
      }
      sectionId = section.id;
    }

    // Subject: tenant guard, that's all — subjects aren't class-scoped.
    let subjectId: string | null = null;
    if (dto.subjectId) {
      const subject = await this.prisma.subject.findFirst({
        where: { id: dto.subjectId, schoolId },
        select: { id: true },
      });
      if (!subject) {
        throw new BadRequestException(
          'Subject does not belong to this school.',
        );
      }
      subjectId = subject.id;
    }

    // Postgres treats NULLs as DISTINCT in unique indexes, so the DB
    // unique constraint won't catch (teacher, class, NULL, NULL)
    // duplicates. We pre-check explicitly and 409 instead.
    const dupe = await this.prisma.teachingAssignment.findFirst({
      where: {
        teacherId,
        classId: dto.classId,
        sectionId,
        subjectId,
      },
      select: { id: true },
    });
    if (dupe) {
      throw new ConflictException(
        'This teacher already has that class/section/subject assignment.',
      );
    }

    try {
      return await this.prisma.teachingAssignment.create({
        data: {
          teacherId,
          classId: dto.classId,
          sectionId,
          subjectId,
          schoolId,
        },
        include: teachingAssignmentInclude,
      });
    } catch (e) {
      // Concurrent-create race: two admins click "Add" with the same
      // tuple at the same moment. Surface a clean 409.
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          'This teacher already has that class/section/subject assignment.',
        );
      }
      throw e;
    }
  }

  /**
   * Bulk reconcile a teacher's assignments in one transaction. The
   * client computes the diff (cells ticked/unticked in the grid) and
   * sends two tuple lists; the server validates them and applies all
   * changes atomically.
   *
   * Idempotency rules — the grid is the source of truth, so the bulk
   * call should never fail just because the client and server briefly
   * disagreed on what already existed:
   *   • An "add" tuple that already exists is silently skipped (not a
   *     409). The end-state is what matters.
   *   • A "remove" tuple that doesn't exist is silently skipped (not
   *     a 404). Same reason.
   *
   * Tenant + shape guards still apply to "add" tuples — a malformed
   * class/section/subject combination is rejected before the
   * transaction starts so we never partial-commit.
   *
   * Returns the teacher's full assignment list AFTER the reconcile so
   * the client doesn't need a follow-up GET.
   */
  async bulk(
    teacherId: string,
    dto: BulkTeachingAssignmentsDto,
    schoolId: string,
  ): Promise<TeachingAssignmentWithRefs[]> {
    await this.assertTeacherInSchool(teacherId, schoolId);

    // Validate every "add" tuple BEFORE we open the transaction. We
    // collect the normalized rows (with nulls for omitted optional
    // fields) so the transaction body is straight DB writes.
    const normalizedAdds = await Promise.all(
      dto.add.map((tuple) => this.validateTuple(tuple, schoolId)),
    );

    // "Remove" tuples don't need tenant validation — the WHERE clause
    // below scopes by teacherId + schoolId, so a cross-tenant tuple
    // simply matches no rows and is a no-op.
    const normalizedRemoves = dto.remove.map((tuple) => ({
      classId: tuple.classId,
      sectionId: tuple.sectionId ?? null,
      subjectId: tuple.subjectId ?? null,
    }));

    // Phase RELIABILITY Part 1: retry-aware wrapper. Bulk teaching-
    // assignment edits commonly contend with concurrent admin edits;
    // a P2034 here retries instead of returning 500. Unique-violation
    // P2002 is still caught + swallowed by the inner `isUniqueViolation`
    // check (idempotent end-state).
    await txWithRetry(this.prisma, async (tx) => {
      // ---- Removes first ----
      // Doing removes before adds means an admin who unchecks (Math, A)
      // and rechecks (Math, A) in the same save (no-op net change)
      // doesn't briefly trip the unique index.
      for (const tuple of normalizedRemoves) {
        await tx.teachingAssignment.deleteMany({
          where: {
            teacherId,
            schoolId,
            classId: tuple.classId,
            sectionId: tuple.sectionId,
            subjectId: tuple.subjectId,
          },
        });
      }

      // ---- Adds ----
      // We deliberately DON'T use createMany + skipDuplicates because
      // Postgres treats NULL as DISTINCT in unique indexes — so the
      // (class, NULL section, NULL subject) duplicate case slips
      // through. Per-row create with a pre-check covers both cases.
      for (const row of normalizedAdds) {
        const existing = await tx.teachingAssignment.findFirst({
          where: {
            teacherId,
            classId: row.classId,
            sectionId: row.sectionId,
            subjectId: row.subjectId,
          },
          select: { id: true },
        });
        if (existing) continue; // idempotent: tick is already saved

        try {
          await tx.teachingAssignment.create({
            data: {
              teacherId,
              classId: row.classId,
              sectionId: row.sectionId,
              subjectId: row.subjectId,
              schoolId,
            },
          });
        } catch (e) {
          // Concurrent insert from another admin — same idempotency
          // story: end-state already matches, swallow the violation.
          if (!isUniqueViolation(e)) throw e;
        }
      }
    }, { label: 'save-teaching-assignment' });

    return this.prisma.teachingAssignment.findMany({
      where: { teacherId, schoolId },
      include: teachingAssignmentInclude,
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  /**
   * Tenant + shape validation for a single bulk-add tuple. Returns the
   * normalized row (nulls for omitted optional fields) ready to insert.
   *
   * Mirrors the per-row checks in `create()`:
   *   • class belongs to the caller's school
   *   • section, if set, lives under the requested class
   *   • subject, if set, belongs to this school
   */
  private async validateTuple(
    tuple: BulkAssignmentTupleDto,
    schoolId: string,
  ): Promise<{
    classId: string;
    sectionId: string | null;
    subjectId: string | null;
  }> {
    const klass = await this.prisma.class.findFirst({
      where: { id: tuple.classId, schoolId },
      select: { id: true },
    });
    if (!klass) {
      throw new BadRequestException('Class does not belong to this school.');
    }

    let sectionId: string | null = null;
    if (tuple.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: tuple.sectionId, classId: tuple.classId },
        select: { id: true },
      });
      if (!section) {
        throw new BadRequestException(
          'Section does not belong to the specified class.',
        );
      }
      sectionId = section.id;
    }

    let subjectId: string | null = null;
    if (tuple.subjectId) {
      const subject = await this.prisma.subject.findFirst({
        where: { id: tuple.subjectId, schoolId },
        select: { id: true },
      });
      if (!subject) {
        throw new BadRequestException(
          'Subject does not belong to this school.',
        );
      }
      subjectId = subject.id;
    }

    return { classId: tuple.classId, sectionId, subjectId };
  }

  /** Remove a single assignment row. 404 cross-tenant. */
  async remove(id: string, schoolId: string): Promise<void> {
    const found = await this.prisma.teachingAssignment.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Assignment not found.');
    await this.prisma.teachingAssignment.delete({ where: { id } });
  }

  private async assertTeacherInSchool(
    teacherId: string,
    schoolId: string,
  ): Promise<void> {
    const found = await this.prisma.teacher.findFirst({
      where: { id: teacherId, schoolId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Teacher not found.');
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

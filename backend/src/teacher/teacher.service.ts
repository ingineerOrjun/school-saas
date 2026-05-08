import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, type User } from '@prisma/client';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../database/prisma.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { CreateTeacherWithUserDto } from './dto/create-teacher-with-user.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

/** Strip the bcrypt hash before sending the user back to the client. */
type SafeUser = Omit<User, 'password'>;

/**
 * Aggregate counts of a teacher's assignments. Computed by `findAll`,
 * `findOne`, and `getAssignmentSummary` so the admin UI never has to
 * fan out N + 1 calls to render "X classes · Y subjects" on a roster.
 */
export interface TeacherAssignmentCounts {
  total: number;
  classes: number;
  sections: number;
  subjects: number;
}

/**
 * Public teacher row shape returned by every teacher endpoint. Built
 * from `Teacher` + included `assignments` (raw rows) + a derived
 * `assignmentCounts` summary. The `class` / `section` relations are
 * gone — the legacy `Teacher.classId` / `Teacher.sectionId` columns
 * were dropped in the 20260511 migration; assignments are the only
 * source of truth now.
 */
export interface TeacherWithCounts {
  id: string;
  name: string;
  schoolId: string;
  userId: string;
  assignmentCounts: TeacherAssignmentCounts;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeacherWithUserResult {
  teacher: TeacherWithCounts;
  user: SafeUser;
}

/**
 * Prisma include used by every read path. We only need the raw
 * `(classId, sectionId, subjectId)` tuples to derive distinct counts —
 * skipping the relation joins keeps the per-teacher payload small even
 * when the school has many teachers with many assignments.
 */
const teacherInclude = {
  assignments: {
    select: { classId: true, sectionId: true, subjectId: true },
  },
} satisfies Prisma.TeacherInclude;

type TeacherRowWithAssignments = Prisma.TeacherGetPayload<{
  include: typeof teacherInclude;
}>;

@Injectable()
export class TeacherService {
  private readonly logger = new Logger(TeacherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
  ) {}

  /**
   * One-step provisioning. Creates the Teacher row, and the User row
   * too if the email is brand new — both inside a single transaction
   * so a partial state is impossible.
   *
   * Email-reuse contract (the reason this method has more branches
   * than a vanilla create):
   *
   *   1. No User with this email           → create User + Teacher.
   *   2. User exists in a different school → 409. Emails are global
   *      across the User table, but we never silently move a user
   *      between tenants.
   *   3. User exists, role is not TEACHER  → 400. Admins/staff/
   *      students can't get hijacked into a teacher profile.
   *   4. User exists, already linked to a  → 409. The unique index on
   *      Teacher                             Teacher.userId already
   *                                          enforces this; we 409
   *                                          early so the message is
   *                                          actionable.
   *   5. Orphaned TEACHER User in this     → REUSE the User: just
   *      school (no Teacher attached)        attach a fresh Teacher
   *                                          row. Password is left
   *                                          intact (the typed value
   *                                          is silently ignored —
   *                                          admins can issue a
   *                                          separate reset).
   *
   * Case (5) is the main reason this exists: when an admin deletes a
   * Teacher row, the User stays (Teacher → User has cascade only in
   * the OPPOSITE direction). Re-typing the same email in Add Teacher
   * lets the admin recover that orphan instead of needing a different
   * email address forever.
   *
   * The teacher is created with NO assignments — the admin assigns
   * classes/subjects via the AssignmentsDialog after, and the login
   * hard-guard (auth.service) blocks the teacher from signing in
   * until at least one assignment exists.
   */
  async createWithUser(
    dto: CreateTeacherWithUserDto,
    schoolId: string,
  ): Promise<TeacherWithUserResult> {
    // Hash up front so the slow bcrypt step doesn't sit inside a
    // transaction holding row locks. The reuse path (case 5) ignores
    // this hash; the create path (case 1) uses it. The waste on the
    // reuse path is one bcrypt-call worth of CPU, which is fine for
    // an admin-initiated, low-frequency endpoint.
    const passwordHash = await this.hashing.hash(dto.password);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Single read inside the transaction. Race-safe because the
        // unique-index error path below catches anything that slips
        // between this read and the writes.
        const existing = await tx.user.findUnique({
          where: { email: dto.email },
          include: { teacher: { select: { id: true } } },
        });

        if (existing) {
          // Case 2: tenant boundary.
          if (existing.schoolId !== schoolId) {
            throw new ConflictException(
              'An account with this email already exists.',
            );
          }
          // Case 3: account exists but it's an admin/staff/student.
          if (existing.role !== Role.TEACHER) {
            throw new BadRequestException(
              'User exists but is not a teacher.',
            );
          }
          // Case 4: another Teacher row is already attached.
          if (existing.teacher) {
            throw new ConflictException(
              'This account is already assigned to another teacher.',
            );
          }
          // Case 5: orphaned TEACHER User in this school — reuse.
          const teacher = await tx.teacher.create({
            data: {
              name: dto.name,
              schoolId,
              userId: existing.id,
            },
            include: teacherInclude,
          });
          // Strip the `teacher` relation off the User payload so the
          // returned shape matches the "fresh create" branch below.
          const { teacher: _linked, ...userOnly } = existing;
          return { teacher, user: userOnly as User };
        }

        // Case 1: brand-new email — create both rows.
        const user = await tx.user.create({
          data: {
            email: dto.email,
            password: passwordHash,
            role: Role.TEACHER,
            schoolId,
          },
        });
        const teacher = await tx.teacher.create({
          data: {
            name: dto.name,
            schoolId,
            userId: user.id,
          },
          include: teacherInclude,
        });
        return { teacher, user };
      });

      // Defensive sanity check — Teacher.userId is NOT NULL at the DB
      // layer and both branches above set it explicitly, so this is
      // belt-and-suspenders. Surfacing it as a 500 with a clear
      // message beats a confused dashboard later if the invariant
      // ever drifts (e.g., during a future schema change).
      if (!result.teacher.userId) {
        this.logger.error(
          `[createWithUser] Teacher row created without userId. teacherId=${result.teacher.id} email=${dto.email} — refusing to return.`,
        );
        throw new ConflictException(
          'Teacher could not be linked to a login account. Please retry.',
        );
      }

      return {
        teacher: this.toDto(result.teacher),
        user: stripPassword(result.user),
      };
    } catch (e) {
      // Translate unique-index violations into clean 409s. We
      // distinguish between the email-collision and the orphan-link
      // race so the message points at the actual cause:
      //   • users.email collision        → admin typed an email that
      //                                    just got registered.
      //   • teachers.userId collision    → another admin claimed the
      //                                    same orphan in parallel.
      if (isUniqueViolation(e)) {
        const target = (e as Prisma.PrismaClientKnownRequestError).meta
          ?.target;
        const targetStr = Array.isArray(target)
          ? target.join(',')
          : String(target ?? '');
        if (targetStr.toLowerCase().includes('userid')) {
          throw new ConflictException(
            'This account is already assigned to another teacher.',
          );
        }
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw e;
    }
  }

  /**
   * @deprecated Direct teacher creation is no longer permitted. Every
   * teacher MUST have a linked User account so the teacher can actually
   * log in and resolve assignments. Use `createWithUser` instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(
    _dto: CreateTeacherDto,
    _schoolId: string,
  ): Promise<TeacherWithCounts> {
    throw new BadRequestException(
      'Teacher must be created with a user account. Use POST /teachers/create-with-user (email + password required).',
    );
  }

  async findAll(schoolId: string): Promise<TeacherWithCounts[]> {
    const rows = await this.prisma.teacher.findMany({
      where: { schoolId },
      include: teacherInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async findOne(id: string, schoolId: string): Promise<TeacherWithCounts> {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id, schoolId },
      include: teacherInclude,
    });
    if (!teacher) {
      // 404 (not 403) — don't leak whether the record exists in another
      // tenant.
      throw new NotFoundException('Teacher not found.');
    }
    return this.toDto(teacher);
  }

  /**
   * Admin-facing summary: just the counts, no row payloads. Used by
   * the new TeacherTable column "3 Classes · 5 Subjects" and any future
   * admin tool that needs a quick "is this teacher set up?" check
   * without pulling the full assignment list.
   */
  async getAssignmentSummary(
    id: string,
    schoolId: string,
  ): Promise<TeacherAssignmentCounts> {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id, schoolId },
      include: teacherInclude,
    });
    if (!teacher) {
      throw new NotFoundException('Teacher not found.');
    }
    return computeCounts(teacher.assignments);
  }

  async update(
    id: string,
    dto: UpdateTeacherDto,
    schoolId: string,
  ): Promise<TeacherWithCounts> {
    await this.ensureInSchool(id, schoolId);

    if (dto.userId) {
      await this.assertUserBelongsToSchool(dto.userId, schoolId);
    }

    try {
      const updated = await this.prisma.teacher.update({
        where: { id },
        data: {
          name: dto.name,
          userId: dto.userId,
        },
        include: teacherInclude,
      });
      return this.toDto(updated);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          'That user is already linked to another teacher.',
        );
      }
      throw e;
    }
  }

  async remove(id: string, schoolId: string): Promise<void> {
    // Resolve the Teacher row + its linked userId in a single read so
    // we can delete via the User (the User → Teacher FK has cascade
    // delete, so removing the User also removes the Teacher).
    const teacher = await this.prisma.teacher.findFirst({
      where: { id, schoolId },
      select: { id: true, userId: true },
    });
    if (!teacher) {
      throw new NotFoundException('Teacher not found.');
    }

    // Delete the User instead of the Teacher.
    //
    // Why: when the Teacher row was deleted on its own, the User row
    // stayed (no reverse cascade), leaving a dead login rattling
    // around in Settings → Users & roles. The user can't actually
    // log in (the auth hard-guard rejects TEACHER users with no
    // assignments), but they still cluttered the list.
    //
    // Deleting via the User keeps Teacher + login as a cohesive unit
    // — "delete this teacher" now means the same thing in every
    // place an admin sees them. Audit FKs that reference this User
    // (Subject.createdBy, Exam.updatedBy, Result.createdBy/updatedBy)
    // are SetNull on User delete, so historical authorship just
    // becomes anonymous rather than the records disappearing.
    this.logger.log(
      `[remove] Cascading delete of Teacher.id=${teacher.id} via User.id=${teacher.userId}`,
    );
    await this.prisma.user.delete({ where: { id: teacher.userId } });
  }

  /**
   * Verifies the teacher belongs to this school and returns the row id
   * (cheapest possible projection). Used as a tenant guard before any
   * write or before computing a summary.
   */
  private async ensureInSchool(id: string, schoolId: string) {
    const row = await this.prisma.teacher.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException('Teacher not found.');
    }
    return row;
  }

  private async assertUserBelongsToSchool(
    userId: string,
    schoolId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, schoolId },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException(
        'Linked user does not belong to this school.',
      );
    }
  }

  /** Convert a raw Teacher row + assignment tuples into the public DTO. */
  private toDto(row: TeacherRowWithAssignments): TeacherWithCounts {
    return {
      id: row.id,
      name: row.name,
      schoolId: row.schoolId,
      userId: row.userId,
      assignmentCounts: computeCounts(row.assignments),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * Pure helper — derives `total / classes / sections / subjects` from a
 * teacher's raw assignment tuples. Distinct counts (not just totals)
 * are what the UI actually wants to render, e.g. "5 subjects across 3
 * classes" — a teacher with 3 rows on Class 5 still teaches 1 class.
 *
 * `sections` counts only NON-NULL section ids — a class-bound
 * assignment doesn't pin to a specific section, so it shouldn't inflate
 * the section tally. Same logic for `subjects`.
 */
function computeCounts(
  assignments: ReadonlyArray<{
    classId: string;
    sectionId: string | null;
    subjectId: string | null;
  }>,
): TeacherAssignmentCounts {
  const classes = new Set<string>();
  const sections = new Set<string>();
  const subjects = new Set<string>();
  for (const a of assignments) {
    classes.add(a.classId);
    if (a.sectionId) sections.add(a.sectionId);
    if (a.subjectId) subjects.add(a.subjectId);
  }
  return {
    total: assignments.length,
    classes: classes.size,
    sections: sections.size,
    subjects: subjects.size,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

function stripPassword(user: User): SafeUser {
  const { password: _password, ...safe } = user;
  return safe;
}

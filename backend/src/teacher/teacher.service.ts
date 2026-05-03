import {
  BadRequestException,
  ConflictException,
  Injectable,
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

export interface TeacherWithUserResult {
  teacher: TeacherWithAssignment;
  user: SafeUser;
}

const teacherInclude = {
  class: { select: { id: true, name: true } },
  section: {
    select: {
      id: true,
      name: true,
      class: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.TeacherInclude;

export type TeacherWithAssignment = Prisma.TeacherGetPayload<{
  include: typeof teacherInclude;
}>;

@Injectable()
export class TeacherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
  ) {}

  /**
   * One-step provisioning: create a User (role=TEACHER) and a Teacher row
   * in a single transaction so a partial state is impossible. The User is
   * what the teacher uses to log in; the Teacher row carries the profile
   * + class/section assignment.
   *
   * Validates the class/section pair and the email uniqueness BEFORE the
   * transaction so the failure path doesn't waste a write.
   */
  async createWithUser(
    dto: CreateTeacherWithUserDto,
    schoolId: string,
  ): Promise<TeacherWithUserResult> {
    // Email uniqueness is global (the User table has a unique index on
    // email), so check across all schools — not just this one.
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    // Resolve assignment up front so an invalid class/section doesn't hash
    // a password and roll back a transaction for nothing.
    const { classId, sectionId } = await this.resolveClassAndSection(
      dto.classId,
      dto.sectionId,
      schoolId,
    );

    const passwordHash = await this.hashing.hash(dto.password);

    try {
      const { teacher, user } = await this.prisma.$transaction(async (tx) => {
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
            classId,
            sectionId,
          },
          include: teacherInclude,
        });

        return { teacher, user };
      });

      return { teacher, user: stripPassword(user) };
    } catch (e) {
      // Race-condition fallback: if two admins click "Add" at the same
      // moment with the same email, only one survives. Surface a clean
      // 409 instead of a Prisma stack trace.
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          'An account with this email already exists.',
        );
      }
      throw e;
    }
  }

  /**
   * @deprecated Direct teacher creation is no longer permitted.
   * Every teacher MUST have a linked User account so the teacher can
   * actually log in and see assignments — the dashboard resolves them
   * via Teacher.userId === currentUser.id, so a userId-less row is a
   * silent dead end.
   *
   * Use `createWithUser` instead, which provisions a User (role=TEACHER)
   * and a Teacher in one transaction. This method now throws
   * unconditionally; the route stays mounted only so callers get a
   * clean 400 with explicit guidance instead of a 404.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(
    _dto: CreateTeacherDto,
    _schoolId: string,
  ): Promise<TeacherWithAssignment> {
    throw new BadRequestException(
      'Teacher must be created with a user account. Use POST /teachers/create-with-user (email + password required).',
    );
  }

  findAll(schoolId: string): Promise<TeacherWithAssignment[]> {
    return this.prisma.teacher.findMany({
      where: { schoolId },
      include: teacherInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    schoolId: string,
  ): Promise<TeacherWithAssignment> {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id, schoolId },
      include: teacherInclude,
    });
    if (!teacher) {
      // 404 (not 403) — don't leak whether the record exists in another tenant.
      throw new NotFoundException('Teacher not found.');
    }
    return teacher;
  }

  async update(
    id: string,
    dto: UpdateTeacherDto,
    schoolId: string,
  ): Promise<TeacherWithAssignment> {
    const existing = await this.ensureInSchool(id, schoolId);

    if (dto.userId) {
      await this.assertUserBelongsToSchool(dto.userId, schoolId);
    }

    // Re-resolve assignment only when the caller touched either field.
    // Otherwise leave the existing values alone.
    let assignmentPatch:
      | { classId: string | null; sectionId: string | null }
      | null = null;
    if (dto.classId !== undefined || dto.sectionId !== undefined) {
      const nextClassId =
        dto.classId !== undefined ? dto.classId : existing.classId;
      const nextSectionId =
        dto.sectionId !== undefined ? dto.sectionId : existing.sectionId;
      assignmentPatch = await this.resolveClassAndSection(
        nextClassId,
        nextSectionId,
        schoolId,
      );
    }

    try {
      return await this.prisma.teacher.update({
        where: { id },
        data: {
          name: dto.name,
          userId: dto.userId,
          ...(assignmentPatch ?? {}),
        },
        include: teacherInclude,
      });
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
    await this.ensureInSchool(id, schoolId);
    await this.prisma.teacher.delete({ where: { id } });
  }

  /**
   * Returns the existing row (minimal fields) if the teacher belongs
   * to this school, otherwise throws 404. Used by `update` to read the
   * current class/section without a second query.
   */
  private async ensureInSchool(id: string, schoolId: string) {
    const row = await this.prisma.teacher.findFirst({
      where: { id, schoolId },
      select: { id: true, classId: true, sectionId: true },
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

  /**
   * Validates the class/section pair and returns the canonical values
   * to persist. Mirrors the same rule used for Student assignments:
   *   • neither set    → both null
   *   • class only     → class must belong to this school
   *   • section set    → section's class is taken as authoritative; if
   *     classId was also passed, it must agree
   */
  private async resolveClassAndSection(
    classId: string | null | undefined,
    sectionId: string | null | undefined,
    schoolId: string,
  ): Promise<{ classId: string | null; sectionId: string | null }> {
    if (!sectionId && !classId) {
      return { classId: null, sectionId: null };
    }

    if (!sectionId && classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: classId, schoolId },
        select: { id: true },
      });
      if (!klass) {
        throw new BadRequestException(
          'Class does not belong to this school.',
        );
      }
      return { classId, sectionId: null };
    }

    const section = await this.prisma.section.findFirst({
      where: { id: sectionId!, class: { schoolId } },
      select: { id: true, classId: true },
    });
    if (!section) {
      throw new BadRequestException(
        'Section does not belong to this school.',
      );
    }
    if (classId && classId !== section.classId) {
      throw new BadRequestException(
        'Section does not belong to the specified class.',
      );
    }
    return { classId: section.classId, sectionId: section.id };
  }
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

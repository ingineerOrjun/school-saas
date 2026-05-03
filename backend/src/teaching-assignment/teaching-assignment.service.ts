import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
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

  /** Same as above but resolves the teacher row from a User id. */
  async listForUser(
    userId: string,
    schoolId: string,
  ): Promise<TeachingAssignmentWithRefs[]> {
    const teacher = await this.prisma.teacher.findFirst({
      where: { userId, schoolId },
      select: { id: true },
    });
    // No teacher row → no assignments. We return an empty array (NOT 404)
    // because /teachers/me/assignments is read-only and the caller might
    // legitimately be a TEACHER user with a partially-set-up profile.
    if (!teacher) return [];
    return this.prisma.teachingAssignment.findMany({
      where: { teacherId: teacher.id, schoolId },
      include: teachingAssignmentInclude,
      orderBy: [{ createdAt: 'asc' }],
    });
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

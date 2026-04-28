import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

const studentInclude = {
  class: true,
  section: {
    include: {
      class: true,
    },
  },
} satisfies Prisma.StudentInclude;

export type StudentWithSection = Prisma.StudentGetPayload<{
  include: typeof studentInclude;
}>;

@Injectable()
export class StudentService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateStudentDto,
    schoolId: string,
  ): Promise<StudentWithSection> {
    if (dto.userId) {
      await this.assertUserBelongsToSchool(dto.userId, schoolId);
    }

    // Resolve class/section together so we enforce the invariant that a
    // section (if provided) lives under the provided class (if provided).
    const { classId, sectionId } = await this.resolveClassAndSection(
      dto.classId,
      dto.sectionId,
      schoolId,
    );

    try {
      return await this.prisma.student.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          symbolNumber: dto.symbolNumber,
          schoolId,
          userId: dto.userId,
          classId,
          sectionId,
        },
        include: studentInclude,
      });
    } catch (e) {
      throw this.translateUniqueViolation(e);
    }
  }

  findAll(
    schoolId: string,
    filter?: { classId?: string | null },
  ): Promise<StudentWithSection[]> {
    const classFilter = filter?.classId
      ? { classId: filter.classId }
      : filter?.classId === null
        ? { classId: null }
        : undefined;
    return this.prisma.student.findMany({
      where: { schoolId, ...classFilter },
      include: studentInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, schoolId: string): Promise<StudentWithSection> {
    const student = await this.prisma.student.findFirst({
      where: { id, schoolId },
      include: studentInclude,
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }
    return student;
  }

  async update(
    id: string,
    dto: UpdateStudentDto,
    schoolId: string,
  ): Promise<StudentWithSection> {
    const existing = await this.ensureInSchool(id, schoolId);

    if (dto.userId) {
      await this.assertUserBelongsToSchool(dto.userId, schoolId);
    }

    // Only re-resolve class/section when at least one of them is present
    // in the update payload; otherwise preserve the existing values.
    let assignmentPatch: { classId: string | null; sectionId: string | null } | null =
      null;
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
      return await this.prisma.student.update({
        where: { id },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          symbolNumber: dto.symbolNumber,
          userId: dto.userId,
          ...(assignmentPatch ?? {}),
        },
        include: studentInclude,
      });
    } catch (e) {
      throw this.translateUniqueViolation(e);
    }
  }

  /** Map Prisma P2002 errors onto field-specific, friendly 409 messages. */
  private translateUniqueViolation(e: unknown): unknown {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') {
      return e;
    }
    const target = (e.meta?.target as string[] | undefined) ?? [];
    if (target.includes('symbolNumber')) {
      return new ConflictException(
        'That symbol number is already assigned to another student in this school.',
      );
    }
    if (target.includes('userId')) {
      return new ConflictException(
        'That user is already linked to another student.',
      );
    }
    return new ConflictException('Conflict with an existing record.');
  }

  async remove(id: string, schoolId: string): Promise<void> {
    await this.ensureInSchool(id, schoolId);
    await this.prisma.student.delete({ where: { id } });
  }

  /**
   * Returns the existing row (minimal fields) if the student belongs to
   * this school, otherwise throws NotFound. Callers use the returned row
   * to read current classId/sectionId values without a second query.
   */
  private async ensureInSchool(id: string, schoolId: string) {
    const row = await this.prisma.student.findFirst({
      where: { id, schoolId },
      select: { id: true, classId: true, sectionId: true },
    });
    if (!row) {
      throw new NotFoundException('Student not found.');
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
   * Validates class and section inputs and returns the canonical pair to
   * persist. If `sectionId` is provided, its class is inferred and
   * `classId` is auto-populated from it (so the FK always lines up). If
   * both are provided, the section's classId must match the supplied
   * classId — otherwise a 400 tells the caller to fix the payload.
   */
  private async resolveClassAndSection(
    classId: string | null | undefined,
    sectionId: string | null | undefined,
    schoolId: string,
  ): Promise<{ classId: string | null; sectionId: string | null }> {
    // No section, no class — unassigned student.
    if (!sectionId && !classId) {
      return { classId: null, sectionId: null };
    }

    // Only a class — verify it belongs to this school.
    if (!sectionId && classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: classId, schoolId },
        select: { id: true },
      });
      if (!klass) {
        throw new BadRequestException('Class does not belong to this school.');
      }
      return { classId, sectionId: null };
    }

    // Section is set (with or without an explicit classId). Verify
    // tenant ownership and derive classId from the section.
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

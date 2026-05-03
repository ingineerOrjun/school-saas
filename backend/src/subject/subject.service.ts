import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Subject } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

/**
 * School-owned subject catalog. Used by `TeachingAssignment` to express
 * "this teacher teaches Math to Class 8" — without subject the teacher
 * is treated as a class-teacher (attendance only, no exam writes).
 *
 * The `ExamSubject` table (per-exam subject row with full marks) does
 * NOT yet link to this catalog — that's a separate migration. For now
 * Subject is a standalone catalog used only by TeachingAssignment.
 */
@Injectable()
export class SubjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSubjectDto, schoolId: string): Promise<Subject> {
    try {
      return await this.prisma.subject.create({
        data: { name: dto.name.trim(), schoolId },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A subject named "${dto.name.trim()}" already exists.`,
        );
      }
      throw e;
    }
  }

  findAll(schoolId: string): Promise<Subject[]> {
    return this.prisma.subject.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
    });
  }

  async update(
    id: string,
    dto: UpdateSubjectDto,
    schoolId: string,
  ): Promise<Subject> {
    await this.assertInSchool(id, schoolId);
    try {
      return await this.prisma.subject.update({
        where: { id },
        data: { name: dto.name?.trim() },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A subject named "${dto.name?.trim() ?? ''}" already exists.`,
        );
      }
      throw e;
    }
  }

  async remove(id: string, schoolId: string): Promise<void> {
    await this.assertInSchool(id, schoolId);
    // FKs use ON DELETE SET NULL for TeachingAssignment.subjectId, so
    // dropping a subject narrows existing assignments to "no subject"
    // rather than blowing them away. Admins can re-attach later.
    await this.prisma.subject.delete({ where: { id } });
  }

  /**
   * 404 (not 403) when the subject doesn't belong to the caller's
   * school — same convention as every other tenant-scoped resource.
   */
  private async assertInSchool(id: string, schoolId: string): Promise<void> {
    const found = await this.prisma.subject.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Subject not found.');
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

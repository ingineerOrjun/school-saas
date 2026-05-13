import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Section } from '@prisma/client';
import { ClassService } from '../class/class.service';
import { assertNotStaleAndUpdate } from '../common/db/optimistic-update';
import { PrismaService } from '../database/prisma.service';
import { CreateSectionDto } from './dto/create-section.dto';
import { UpdateSectionDto } from './dto/update-section.dto';

@Injectable()
export class SectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classes: ClassService,
  ) {}

  async create(dto: CreateSectionDto, schoolId: string): Promise<Section> {
    // Cross-tenant guard: the targeted class must belong to the caller's school.
    await this.classes.assertInSchool(dto.classId, schoolId);

    try {
      return await this.prisma.section.create({
        data: { name: dto.name, classId: dto.classId },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A section named "${dto.name}" already exists in this class.`,
        );
      }
      throw e;
    }
  }

  async findByClass(classId: string, schoolId: string): Promise<Section[]> {
    await this.classes.assertInSchool(classId, schoolId);
    return this.prisma.section.findMany({
      where: { classId },
      orderBy: { name: 'asc' },
    });
  }

  async update(
    id: string,
    dto: UpdateSectionDto,
    schoolId: string,
  ): Promise<Section> {
    await this.ensureInSchool(id, schoolId);

    try {
      // Phase FINAL-HARDENING Part 2: optimistic-concurrency-aware.
      const { updatedAt, ...rest } = dto;
      return (await assertNotStaleAndUpdate(
        this.prisma.section as unknown as Parameters<
          typeof assertNotStaleAndUpdate
        >[0],
        {
          entity: 'Section',
          id,
          expectedUpdatedAt: updatedAt,
          data: rest as unknown as Record<string, unknown>,
        },
      )) as Section;
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A section named "${dto.name}" already exists in this class.`,
        );
      }
      throw e;
    }
  }

  async remove(id: string, schoolId: string): Promise<void> {
    await this.ensureInSchool(id, schoolId);
    // Cascade leaves students' sectionId NULL (SetNull on the Student.section relation).
    await this.prisma.section.delete({ where: { id } });
  }

  /**
   * Verify a section exists and belongs (via class) to the caller's school.
   */
  async assertInSchool(id: string, schoolId: string): Promise<void> {
    await this.ensureInSchool(id, schoolId);
  }

  private async ensureInSchool(id: string, schoolId: string): Promise<void> {
    const exists = await this.prisma.section.findFirst({
      where: { id, class: { schoolId } },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Section not found.');
    }
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Class, Prisma, Section } from '@prisma/client';
import { assertNotStaleAndUpdate } from '../common/db/optimistic-update';
import { PrismaService } from '../database/prisma.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

export type ClassWithSections = Class & { sections: Section[] };

@Injectable()
export class ClassService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateClassDto, schoolId: string): Promise<Class> {
    try {
      return await this.prisma.class.create({
        data: { name: dto.name, schoolId },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A class named "${dto.name}" already exists in this school.`,
        );
      }
      throw e;
    }
  }

  findAll(schoolId: string): Promise<ClassWithSections[]> {
    return this.prisma.class.findMany({
      where: { schoolId },
      include: { sections: { orderBy: { name: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    dto: UpdateClassDto,
    schoolId: string,
  ): Promise<Class> {
    await this.ensureInSchool(id, schoolId);
    try {
      // Phase FINAL-HARDENING Part 2: optimistic-concurrency-aware.
      const { updatedAt, ...rest } = dto;
      return (await assertNotStaleAndUpdate(
        this.prisma.class as unknown as Parameters<
          typeof assertNotStaleAndUpdate
        >[0],
        {
          entity: 'Class',
          id,
          expectedUpdatedAt: updatedAt,
          data: rest as unknown as Record<string, unknown>,
        },
      )) as Class;
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A class named "${dto.name}" already exists in this school.`,
        );
      }
      throw e;
    }
  }

  async remove(id: string, schoolId: string): Promise<void> {
    await this.ensureInSchool(id, schoolId);
    // Cascade deletes all sections; students' sectionId → SetNull.
    await this.prisma.class.delete({ where: { id } });
  }

  /**
   * Check that a class belongs to the caller's school. Returns the class if
   * so, otherwise throws 404.
   */
  async assertInSchool(id: string, schoolId: string): Promise<Class> {
    const klass = await this.prisma.class.findFirst({
      where: { id, schoolId },
    });
    if (!klass) {
      throw new NotFoundException('Class not found.');
    }
    return klass;
  }

  private async ensureInSchool(id: string, schoolId: string): Promise<void> {
    const exists = await this.prisma.class.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Class not found.');
    }
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

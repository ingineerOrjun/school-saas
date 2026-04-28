import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Teacher } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

@Injectable()
export class TeacherService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTeacherDto, schoolId: string): Promise<Teacher> {
    if (dto.userId) {
      await this.assertUserBelongsToSchool(dto.userId, schoolId);
    }

    try {
      return await this.prisma.teacher.create({
        data: {
          name: dto.name,
          schoolId,
          userId: dto.userId,
        },
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

  findAll(schoolId: string): Promise<Teacher[]> {
    return this.prisma.teacher.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, schoolId: string): Promise<Teacher> {
    const teacher = await this.prisma.teacher.findFirst({
      where: { id, schoolId },
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
  ): Promise<Teacher> {
    await this.ensureInSchool(id, schoolId);

    if (dto.userId) {
      await this.assertUserBelongsToSchool(dto.userId, schoolId);
    }

    try {
      return await this.prisma.teacher.update({
        where: { id },
        data: dto,
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

  private async ensureInSchool(id: string, schoolId: string): Promise<void> {
    const exists = await this.prisma.teacher.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Teacher not found.');
    }
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
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

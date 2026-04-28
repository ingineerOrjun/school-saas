import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Exam, ExamSubject, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

export type ExamWithSubjects = Exam & { subjects: ExamSubject[] };

@Injectable()
export class ExamService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateExamDto, schoolId: string): Promise<Exam> {
    try {
      return await this.prisma.exam.create({
        data: { name: dto.name, schoolId },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `An exam named "${dto.name}" already exists.`,
        );
      }
      throw e;
    }
  }

  findAll(schoolId: string): Promise<ExamWithSubjects[]> {
    return this.prisma.exam.findMany({
      where: { schoolId },
      include: { subjects: { orderBy: { name: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    dto: UpdateExamDto,
    schoolId: string,
  ): Promise<Exam> {
    await this.assertInSchool(id, schoolId);
    try {
      return await this.prisma.exam.update({ where: { id }, data: dto });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `An exam named "${dto.name}" already exists.`,
        );
      }
      throw e;
    }
  }

  async remove(id: string, schoolId: string): Promise<void> {
    await this.assertInSchool(id, schoolId);
    await this.prisma.exam.delete({ where: { id } });
  }

  /** Throws 404 if the exam isn't in the caller's school. */
  async assertInSchool(id: string, schoolId: string): Promise<Exam> {
    const exam = await this.prisma.exam.findFirst({
      where: { id, schoolId },
    });
    if (!exam) throw new NotFoundException('Exam not found.');
    return exam;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

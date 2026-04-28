import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ExamSubject, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { ExamService } from './exam.service';

@Injectable()
export class SubjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exams: ExamService,
  ) {}

  async create(
    examId: string,
    dto: CreateSubjectDto,
    schoolId: string,
  ): Promise<ExamSubject> {
    await this.exams.assertInSchool(examId, schoolId);
    try {
      return await this.prisma.examSubject.create({
        data: {
          name: dto.name,
          theoryFullMarks: dto.theoryFullMarks,
          practicalFullMarks: dto.practicalFullMarks ?? 0,
          examId,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A subject named "${dto.name}" already exists in this exam.`,
        );
      }
      throw e;
    }
  }

  async remove(id: string, schoolId: string): Promise<void> {
    const subject = await this.prisma.examSubject.findFirst({
      where: { id, exam: { schoolId } },
      select: { id: true },
    });
    if (!subject) throw new NotFoundException('Subject not found.');
    await this.prisma.examSubject.delete({ where: { id } });
  }

  /** Returns the subject if it belongs to the caller's school, else throws 404. */
  async assertInSchool(id: string, schoolId: string): Promise<ExamSubject> {
    const subject = await this.prisma.examSubject.findFirst({
      where: { id, exam: { schoolId } },
    });
    if (!subject) throw new NotFoundException('Subject not found.');
    return subject;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

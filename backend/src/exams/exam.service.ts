import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Exam, ExamSubject, Prisma } from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import { PrismaService } from '../database/prisma.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

export type ExamWithSubjects = Exam & { subjects: ExamSubject[] };

@Injectable()
export class ExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
  ) {}

  /**
   * Audit: every create stamps both `createdById` and `updatedById`
   * with the same caller. Session: STRICT — every new exam must be
   * attributed to an active, UNLOCKED session. Throws:
   *   • "No active academic session"   → none set up yet
   *   • "Active session is locked. …"  → admin froze the year
   */
  async create(
    dto: CreateExamDto,
    schoolId: string,
    userId: string,
  ): Promise<Exam> {
    const sessionId = await this.sessions.requireActiveUnlocked(schoolId);
    try {
      return await this.prisma.exam.create({
        data: {
          name: dto.name,
          schoolId,
          createdById: userId,
          updatedById: userId,
          sessionId,
        },
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

  /**
   * List exams. Strict-default session filter:
   *   • caller passed sessionId → use it
   *   • active session exists   → filter to that session (NULL excluded)
   *   • no active session       → filter to NULL legacy rows
   *
   * See `AcademicSessionService.resolveReadFilter` for the rule.
   */
  async findAll(
    schoolId: string,
    sessionId?: string,
  ): Promise<ExamWithSubjects[]> {
    const filter = await this.sessions.resolveReadFilter(
      schoolId,
      sessionId,
    );
    return this.prisma.exam.findMany({
      where: { schoolId, ...filter },
      include: { subjects: { orderBy: { name: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: string,
    dto: UpdateExamDto,
    schoolId: string,
    userId: string,
  ): Promise<Exam> {
    const existing = await this.assertInSchool(id, schoolId);
    // Lock guard: edits to an exam in a locked session are blocked
    // even when there's a different active session. The exam stays
    // in the year it was created; if that year is locked, the data
    // is frozen.
    await this.sessions.assertSessionUnlocked(existing.sessionId);
    try {
      return await this.prisma.exam.update({
        where: { id },
        data: { ...dto, updatedById: userId },
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

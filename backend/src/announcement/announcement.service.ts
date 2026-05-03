import { Injectable, NotFoundException } from '@nestjs/common';
import type { Announcement } from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import { PrismaService } from '../database/prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

/**
 * School-wide announcements. Newest-first feed served from the
 * `(schoolId, createdAt)` composite index — single seek, no sort.
 */
@Injectable()
export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
  ) {}

  /**
   * Announcements feed — strict-default session filter:
   *   • caller passed sessionId → use it
   *   • active session exists   → only that session's notices (NULL excluded)
   *   • no active session       → only NULL legacy notices
   *
   * Mirrors the rule in `AcademicSessionService.resolveReadFilter`
   * — same shape applies across attendance, exams, and here.
   */
  async list(schoolId: string, sessionId?: string): Promise<Announcement[]> {
    const filter = await this.sessions.resolveReadFilter(
      schoolId,
      sessionId,
    );
    return this.prisma.announcement.findMany({
      where: { schoolId, ...filter },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    dto: CreateAnnouncementDto,
    schoolId: string,
  ): Promise<Announcement> {
    // STRICT — every new announcement must belong to the active
    // session. Throws "No active academic session" when none exists
    // so legacy null-attribution can't accumulate.
    const sessionId = await this.sessions.requireActiveId(schoolId);
    return this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        message: dto.message.trim(),
        schoolId,
        sessionId,
      },
    });
  }

  async remove(id: string, schoolId: string): Promise<void> {
    // Tenant guard — 404 (not 403) so we don't leak whether the row
    // exists in another school.
    const found = await this.prisma.announcement.findFirst({
      where: { id, schoolId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Announcement not found.');
    await this.prisma.announcement.delete({ where: { id } });
  }
}

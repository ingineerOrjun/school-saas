import { Injectable, NotFoundException } from '@nestjs/common';
import type { Announcement } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

/**
 * School-wide announcements. Newest-first feed served from the
 * `(schoolId, createdAt)` composite index — single seek, no sort.
 */
@Injectable()
export class AnnouncementService {
  constructor(private readonly prisma: PrismaService) {}

  /** All announcements in the caller's school, latest first. */
  list(schoolId: string): Promise<Announcement[]> {
    return this.prisma.announcement.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(
    dto: CreateAnnouncementDto,
    schoolId: string,
  ): Promise<Announcement> {
    return this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        message: dto.message.trim(),
        schoolId,
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

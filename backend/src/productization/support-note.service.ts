import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// SupportNoteService — Phase 23 Section 6.
//
// SUPER_ADMIN-only. Internal context pinned to a school during
// support engagements. School-side users never see these notes.
//
// Append-only by convention — there's no edit endpoint. Operators
// add notes; old notes stay as part of the support history. A future
// "soft delete" can land if the audit trail demands it.
// ---------------------------------------------------------------------------

export interface SupportNoteRow {
  id: string;
  schoolId: string;
  authorId: string;
  authorEmail: string | null;
  body: string;
  tone: string | null;
  createdAt: string;
}

@Injectable()
export class SupportNoteService {
  private readonly logger = new Logger(SupportNoteService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string, limit = 50): Promise<SupportNoteRow[]> {
    const rows = await this.prisma.supportNote.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
      include: {
        author: { select: { email: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      authorId: r.authorId,
      authorEmail: r.author?.email ?? null,
      body: r.body,
      tone: r.tone,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async create(input: {
    schoolId: string;
    authorId: string;
    body: string;
    tone?: string | null;
  }): Promise<SupportNoteRow> {
    const created = await this.prisma.supportNote.create({
      data: {
        schoolId: input.schoolId,
        authorId: input.authorId,
        body: input.body,
        tone: input.tone ?? null,
      },
      include: { author: { select: { email: true } } },
    });
    this.logger.log(
      `[support-notes] created id=${created.id} schoolId=${input.schoolId}`,
    );
    return {
      id: created.id,
      schoolId: created.schoolId,
      authorId: created.authorId,
      authorEmail: created.author?.email ?? null,
      body: created.body,
      tone: created.tone,
      createdAt: created.createdAt.toISOString(),
    };
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AnnouncementAudience,
  Prisma,
  Role,
  type PlatformAnnouncement,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// AnnouncementService — Phase 23 Section 7.
//
// Operator-published banners surfaced in the school-side dashboard.
//
// API surface:
//
//   • SUPER_ADMIN — publish / list-all / retire / target.
//   • School-side — list active (filtered by audience + dismissals).
//   • School-side — dismiss (per-user — won't show to that user
//                            again, but other users in the same
//                            school still see it).
//
// Audience filter:
//   ALL_SCHOOLS    → every school user sees it.
//   ADMINS_ONLY    → only role=ADMIN users see it.
//   TEACHERS_ONLY  → only role=TEACHER users see it.
//   SPECIFIC_SCHOOLS → only users in `targetSchoolIds`.
//
// Dismissal:
//   Per-user via the AnnouncementDismissal table. Same announcement
//   can show to user A and be hidden for user B — operators don't
//   need to clone announcements to handle "I already saw this."
//
// Distinct from PlatformIncident:
//   Announcements are routine release-note / heads-up copy.
//   Incidents are urgent operational events with active/resolved
//   lifecycle. Both render as banners; announcements are dismissable
//   per-user, incidents are dismiss-only-by-operator.
// ---------------------------------------------------------------------------

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  tone: string;
  audience: AnnouncementAudience;
  targetSchoolIds: string[];
  publishedById: string;
  publishedByEmail: string | null;
  active: boolean;
  linkUrl: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  dismissCount: number;
}

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // SUPER_ADMIN — publish / manage
  // -------------------------------------------------------------------------

  async publish(input: {
    title: string;
    body: string;
    tone?: string;
    audience: AnnouncementAudience;
    targetSchoolIds?: string[];
    linkUrl?: string | null;
    expiresAt?: Date | null;
    publishedById: string;
  }): Promise<AnnouncementRow> {
    const created = await this.prisma.platformAnnouncement.create({
      data: {
        title: input.title,
        body: input.body,
        tone: input.tone ?? 'info',
        audience: input.audience,
        targetSchoolIds:
          input.audience === 'SPECIFIC_SCHOOLS' && input.targetSchoolIds
            ? (input.targetSchoolIds as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        linkUrl: input.linkUrl ?? null,
        expiresAt: input.expiresAt ?? null,
        publishedById: input.publishedById,
      },
      include: { publishedBy: { select: { email: true } } },
    });
    this.logger.log(
      `[announcements] published id=${created.id} title="${input.title}" audience=${input.audience}`,
    );
    return toRow(created, 0);
  }

  async retire(announcementId: string): Promise<AnnouncementRow> {
    const existing = await this.prisma.platformAnnouncement.findUnique({
      where: { id: announcementId },
    });
    if (!existing) throw new NotFoundException('Announcement not found.');
    const updated = await this.prisma.platformAnnouncement.update({
      where: { id: announcementId },
      data: { active: false },
      include: { publishedBy: { select: { email: true } } },
    });
    const dismissCount = await this.prisma.announcementDismissal.count({
      where: { announcementId },
    });
    return toRow(updated, dismissCount);
  }

  /** Operator-side list — every announcement, including retired. */
  async listAll(): Promise<AnnouncementRow[]> {
    const rows = await this.prisma.platformAnnouncement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        publishedBy: { select: { email: true } },
        _count: { select: { dismissals: true } },
      },
    });
    return rows.map((r) => toRow(r, r._count.dismissals));
  }

  // -------------------------------------------------------------------------
  // School-side — read + dismiss
  // -------------------------------------------------------------------------

  /**
   * Active, audience-matching, non-dismissed, non-expired
   * announcements for the calling user. Drives the dashboard
   * banner stack.
   */
  async listActiveFor(input: {
    userId: string;
    schoolId: string;
    role: Role;
  }): Promise<AnnouncementRow[]> {
    const now = new Date();
    const audienceFilter: AnnouncementAudience[] = ['ALL_SCHOOLS'];
    if (input.role === 'ADMIN') audienceFilter.push('ADMINS_ONLY');
    if (input.role === 'TEACHER') audienceFilter.push('TEACHERS_ONLY');
    audienceFilter.push('SPECIFIC_SCHOOLS');

    const rows = await this.prisma.platformAnnouncement.findMany({
      where: {
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        audience: { in: audienceFilter },
        // Exclude announcements this user already dismissed.
        NOT: {
          dismissals: { some: { userId: input.userId } },
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        publishedBy: { select: { email: true } },
      },
    });

    // Filter SPECIFIC_SCHOOLS in-memory (Prisma can't easily query
    // "JSON array contains UUID").
    return rows
      .filter((r) => {
        if (r.audience !== 'SPECIFIC_SCHOOLS') return true;
        const ids = Array.isArray(r.targetSchoolIds)
          ? (r.targetSchoolIds as string[])
          : [];
        return ids.includes(input.schoolId);
      })
      .map((r) => toRow(r, 0));
  }

  async dismiss(input: {
    announcementId: string;
    userId: string;
  }): Promise<{ dismissed: true }> {
    // Idempotent — `upsert` so a second dismiss is a no-op.
    await this.prisma.announcementDismissal.upsert({
      where: {
        announcementId_userId: {
          announcementId: input.announcementId,
          userId: input.userId,
        },
      },
      create: { announcementId: input.announcementId, userId: input.userId },
      update: {},
    });
    return { dismissed: true };
  }
}

function toRow(
  a: PlatformAnnouncement & {
    publishedBy?: { email: string | null } | null;
  },
  dismissCount: number,
): AnnouncementRow {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    tone: a.tone,
    audience: a.audience,
    targetSchoolIds: Array.isArray(a.targetSchoolIds)
      ? (a.targetSchoolIds as string[])
      : [],
    publishedById: a.publishedById,
    publishedByEmail: a.publishedBy?.email ?? null,
    active: a.active,
    linkUrl: a.linkUrl,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    dismissCount,
  };
}

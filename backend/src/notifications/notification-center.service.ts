import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Notification,
  NotificationSeverity,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { getTemplate } from './templates/template-registry';

// ---------------------------------------------------------------------------
// NotificationCenterService — Phase 14 operator-facing read API.
//
// Powers the /platform/notifications page + the topbar bell badge.
// Read-only side of the notifications table (writes go through
// NotificationService.enqueue from Phase 2). The only writes here
// are status flips: markRead / markUnread.
//
// Listing semantics:
//   • Newest-first by createdAt.
//   • Filter by severity (multi-select via comma-separated query).
//   • Filter by unread-only (default off).
//   • Filter by schoolId (operator drilldown).
//   • Pagination: page/pageSize, capped at 100/page.
//
// Audit:
//   The act of marking a notification read is NOT audited — it's
//   read-state, not a security-relevant action. If we add a
//   "mass-mark-read" affordance later, that one IS auditable
//   because it touches many rows.
// ---------------------------------------------------------------------------

export interface NotificationListQuery {
  severity?: NotificationSeverity[];
  unreadOnly?: boolean;
  schoolId?: string;
  page?: number;
  pageSize?: number;
}

export interface NotificationListRow {
  id: string;
  templateKey: string;
  title: string;
  severity: NotificationSeverity;
  schoolId: string | null;
  userId: string | null;
  readAt: string | null;
  createdAt: string;
  /** Most recent delivery status across all channels — UI badge. */
  lastDeliveryStatus: string | null;
}

export interface NotificationListResponse {
  rows: NotificationListRow[];
  total: number;
  page: number;
  pageSize: number;
  unreadCount: number;
}

export interface NotificationDetailRow extends NotificationListRow {
  payload: unknown;
  dedupeKey: string | null;
  deliveries: Array<{
    id: string;
    channel: string;
    recipient: string;
    status: string;
    attempts: number;
    errorMessage: string | null;
    sentAt: string | null;
    providerMessageId: string | null;
    createdAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// School-side variants (Phase 20).
//
// School users see a subset of the platform-side payload — they get
// `body` rendered from the template's renderInApp() instead of the
// raw payload (most school users shouldn't see template internals).
// Deliveries are summarised into a single `lastDeliveryStatus` rather
// than a full per-channel list (operator-tier detail isn't useful to
// the end user).
// ---------------------------------------------------------------------------

export interface SchoolNotificationListRow {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  readAt: string | null;
  createdAt: string;
  /** Set when the notification targets a specific user (vs school-wide). */
  targetedToMe: boolean;
}

export interface SchoolNotificationListResponse {
  rows: SchoolNotificationListRow[];
  total: number;
  page: number;
  pageSize: number;
  unreadCount: number;
}

export interface SchoolNotificationDetailRow extends SchoolNotificationListRow {
  templateKey: string;
  payload: unknown;
  /** Per-channel summary — keys: EMAIL/IN_APP/etc → status. */
  deliveries: Array<{ channel: string; status: string; sentAt: string | null }>;
}

@Injectable()
export class NotificationCenterService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: NotificationListQuery): Promise<NotificationListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const where: Prisma.NotificationWhereInput = {};
    if (query.severity && query.severity.length > 0) {
      where.severity = { in: query.severity };
    }
    if (query.unreadOnly) where.readAt = null;
    if (query.schoolId) where.schoolId = query.schoolId;

    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          deliveries: {
            // The "last delivery status" surfaced in the list is the
            // most-recent attempt across any channel. One row per
            // notification → keep this cheap.
            orderBy: { updatedAt: 'desc' },
            take: 1,
            select: { status: true },
          },
        },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { readAt: null } }),
    ]);

    return {
      rows: rows.map((r) => this.toListRow(r)),
      total,
      page,
      pageSize,
      unreadCount,
    };
  }

  async get(id: string): Promise<NotificationDetailRow> {
    const row = await this.prisma.notification.findUnique({
      where: { id },
      include: {
        deliveries: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Notification not found.');
    return {
      ...this.toListRow({
        ...row,
        deliveries: row.deliveries.length > 0 ? [row.deliveries[row.deliveries.length - 1]] : [],
      }),
      payload: row.payload,
      dedupeKey: row.dedupeKey,
      deliveries: row.deliveries.map((d) => ({
        id: d.id,
        channel: d.channel,
        recipient: d.recipient,
        status: d.status,
        attempts: d.attempts,
        errorMessage: d.errorMessage,
        sentAt: d.sentAt?.toISOString() ?? null,
        providerMessageId: d.providerMessageId,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  async markRead(id: string): Promise<NotificationListRow> {
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
      include: {
        deliveries: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    });
    return this.toListRow(updated);
  }

  async markUnread(id: string): Promise<NotificationListRow> {
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: null },
      include: {
        deliveries: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
    });
    return this.toListRow(updated);
  }

  /** Quick-count for the topbar bell badge. Cheap (covered by index). */
  async unreadCount(): Promise<number> {
    return this.prisma.notification.count({ where: { readAt: null } });
  }

  // -------------------------------------------------------------------------
  // School-side methods (Phase 20). All apply the tenant-safe filter:
  //
  //   schoolId == user.schoolId
  //   AND (userId == user.id OR userId IS NULL)
  //
  // This means a school user sees notifications addressed specifically
  // to them PLUS school-wide notifications for their tenant. They never
  // see another tenant's notifications, another user's targeted
  // notifications at the same tenant, or platform-tier broadcasts
  // (where schoolId IS NULL).
  // -------------------------------------------------------------------------

  /**
   * Build the access-control where-clause used by every school-side
   * method. Centralised so a future change (e.g. school admins seeing
   * peer admins' notifications) only touches one place.
   */
  private buildSchoolAccessWhere(input: {
    userId: string;
    schoolId: string;
  }): Prisma.NotificationWhereInput {
    return {
      schoolId: input.schoolId,
      OR: [{ userId: input.userId }, { userId: null }],
    };
  }

  async listForSchoolUser(
    user: { userId: string; schoolId: string },
    query: NotificationListQuery,
  ): Promise<SchoolNotificationListResponse> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const access = this.buildSchoolAccessWhere(user);
    const where: Prisma.NotificationWhereInput = { ...access };
    if (query.severity && query.severity.length > 0) {
      where.severity = { in: query.severity };
    }
    if (query.unreadOnly) where.readAt = null;

    // unreadCount uses the SAME access filter so the badge reflects
    // what the user actually sees (not the global unread count).
    const [rows, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { ...access, readAt: null },
      }),
    ]);

    return {
      rows: rows.map((r) => this.toSchoolListRow(r, user.userId)),
      total,
      page,
      pageSize,
      unreadCount,
    };
  }

  async unreadCountForSchoolUser(user: {
    userId: string;
    schoolId: string;
  }): Promise<number> {
    return this.prisma.notification.count({
      where: { ...this.buildSchoolAccessWhere(user), readAt: null },
    });
  }

  async getForSchoolUser(
    user: { userId: string; schoolId: string },
    id: string,
  ): Promise<SchoolNotificationDetailRow> {
    // Combined where clause means a missing-or-not-mine row surfaces
    // as the same NotFound shape — no leakage of other-user IDs.
    const row = await this.prisma.notification.findFirst({
      where: { id, ...this.buildSchoolAccessWhere(user) },
      include: { deliveries: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw new NotFoundException('Notification not found.');
    return this.toSchoolDetailRow(row, user.userId);
  }

  async markReadForSchoolUser(
    user: { userId: string; schoolId: string },
    id: string,
  ): Promise<SchoolNotificationListRow> {
    // Verify access before update — same NotFound shape on miss.
    const exists = await this.prisma.notification.findFirst({
      where: { id, ...this.buildSchoolAccessWhere(user) },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Notification not found.');

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return this.toSchoolListRow(updated, user.userId);
  }

  async markUnreadForSchoolUser(
    user: { userId: string; schoolId: string },
    id: string,
  ): Promise<SchoolNotificationListRow> {
    const exists = await this.prisma.notification.findFirst({
      where: { id, ...this.buildSchoolAccessWhere(user) },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Notification not found.');

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: null },
    });
    return this.toSchoolListRow(updated, user.userId);
  }

  /**
   * Bulk mark-read — flips every accessible unread notification to
   * read. Returns the count flipped. Used by the "Mark all read"
   * button on the school-side inbox.
   */
  async markAllReadForSchoolUser(user: {
    userId: string;
    schoolId: string;
  }): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { ...this.buildSchoolAccessWhere(user), readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }

  // -------------------------------------------------------------------------
  // Row builders.
  // -------------------------------------------------------------------------

  private toListRow(
    row: Notification & { deliveries: Array<{ status: string }> },
  ): NotificationListRow {
    return {
      id: row.id,
      templateKey: row.templateKey,
      title: row.title ?? row.templateKey,
      severity: row.severity,
      schoolId: row.schoolId,
      userId: row.userId,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lastDeliveryStatus: row.deliveries[0]?.status ?? null,
    };
  }

  /**
   * Render the notification body text using the template's
   * `renderInApp()` when available. Falls back to the title when the
   * template doesn't have an in-app renderer (older templates emit
   * email only).
   */
  private renderBody(row: Notification): string {
    const template = getTemplate(row.templateKey);
    if (template?.renderInApp) {
      try {
        const rendered = template.renderInApp(row.payload);
        return rendered.body;
      } catch {
        // Renderer threw — likely a payload schema mismatch from a
        // template version skew. Fall through to the safe default.
      }
    }
    return row.title ?? row.templateKey;
  }

  private toSchoolListRow(
    row: Notification,
    callingUserId: string,
  ): SchoolNotificationListRow {
    return {
      id: row.id,
      title: row.title ?? row.templateKey,
      body: this.renderBody(row),
      severity: row.severity,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      // True when the row was specifically addressed to this user
      // (vs a school-wide broadcast). UI uses this to mark
      // "personal" rows differently from announcements.
      targetedToMe: row.userId === callingUserId,
    };
  }

  private toSchoolDetailRow(
    row: Notification & {
      deliveries: Array<{ channel: string; status: string; sentAt: Date | null }>;
    },
    callingUserId: string,
  ): SchoolNotificationDetailRow {
    return {
      ...this.toSchoolListRow(row, callingUserId),
      templateKey: row.templateKey,
      payload: row.payload,
      deliveries: row.deliveries.map((d) => ({
        channel: d.channel,
        status: d.status,
        sentAt: d.sentAt?.toISOString() ?? null,
      })),
    };
  }
}

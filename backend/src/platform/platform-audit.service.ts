import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PlatformAuditAction, Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// PlatformAuditService — the only path that writes to platform_audit_events.
//
// Why one service:
//   • Single ingestion call site means every platform action lands
//     with the same shape, the same denormalisation rules, and the
//     same error-tolerance policy. Phase 4/5/7/9 will each grow the
//     `PlatformAuditAction` enum and add a corresponding `record*`
//     helper here, but the underlying write is one method.
//   • Lets us swap the storage layer (e.g. to a write-behind queue,
//     or to ship to a SIEM) without touching every caller.
//
// Error policy:
//   • A failure to RECORD must NEVER cause the underlying action to
//     fail. School suspension is more important than its audit row.
//   • So `record()` swallows errors and logs them via NestJS Logger.
//     A future Phase 9 will add a "missing audit" alert / DLQ for
//     audit failures, since they're a security signal.
// ---------------------------------------------------------------------------

export interface AuditActor {
  userId: string;
  email?: string | null;
  role?: Role | string | null;
}

export interface AuditTarget {
  type: string;
  id: string;
  /** Human-readable snapshot (e.g. school name) — frozen at audit time. */
  label?: string | null;
}

export interface AuditRecordInput {
  action: PlatformAuditAction;
  actor: AuditActor;
  target: AuditTarget;
  /** JSON-serialisable slice of the target before the change. */
  before?: unknown;
  /** JSON-serialisable slice of the target after the change. */
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface PlatformAuditRow {
  id: string;
  action: PlatformAuditAction;
  actorUserId: string;
  actorEmail: string | null;
  actorRole: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface PlatformAuditQuery {
  action?: PlatformAuditAction;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  /** Free-text — matches actor email + target label + reason. */
  q?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export interface PlatformAuditResponse {
  rows: PlatformAuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append one audit event. Errors are caught and logged — never
   * propagated to the caller. Returns the created row id when the
   * write succeeded, `null` otherwise. Most call sites ignore the
   * return value; surfacing the id lets a future "view this audit
   * row" affordance link straight to the entry.
   */
  async record(input: AuditRecordInput): Promise<string | null> {
    try {
      const created = await this.prisma.platformAuditEvent.create({
        data: {
          action: input.action,
          actorUserId: input.actor.userId,
          actorEmail: input.actor.email ?? null,
          actorRole:
            typeof input.actor.role === 'string' ? input.actor.role : null,
          targetType: input.target.type,
          targetId: input.target.id,
          targetLabel: input.target.label ?? null,
          before:
            input.before === undefined
              ? Prisma.JsonNull
              : (input.before as Prisma.InputJsonValue),
          after:
            input.after === undefined
              ? Prisma.JsonNull
              : (input.after as Prisma.InputJsonValue),
          reason: input.reason ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        select: { id: true },
      });
      return created.id;
    } catch (e) {
      // Audit failure is a SOFT failure — never blocks the action.
      // A repeated failure is a security signal but not a user-
      // facing error. Logging via NestJS Logger surfaces it in
      // stdout where ops can pick it up; Phase 9 will add an alert.
      this.logger.error(
        `Failed to record platform audit event ` +
          `action=${input.action} target=${input.target.type}:${input.target.id} ` +
          `actor=${input.actor.userId}`,
        e instanceof Error ? e.stack : String(e),
      );
      return null;
    }
  }

  /**
   * Paginated, filterable query for the /platform/audit page.
   *
   * Filter behaviour:
   *   • `action` / `actorUserId` / `targetType` / `targetId` are
   *     exact-match filters.
   *   • `q` is free-text contains across `actorEmail`,
   *     `targetLabel`, and `reason`. Case-insensitive.
   *   • `fromDate` / `toDate` bound the `createdAt` timestamp
   *     inclusively.
   */
  async list(query: PlatformAuditQuery): Promise<PlatformAuditResponse> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const where: Prisma.PlatformAuditEventWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.actorUserId) where.actorUserId = query.actorUserId;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.fromDate || query.toDate) {
      where.createdAt = {};
      if (query.fromDate)
        where.createdAt.gte = new Date(`${query.fromDate}T00:00:00.000Z`);
      if (query.toDate)
        where.createdAt.lte = new Date(`${query.toDate}T23:59:59.999Z`);
    }
    if (query.q && query.q.trim().length > 0) {
      const q = query.q.trim();
      where.OR = [
        { actorEmail: { contains: q, mode: 'insensitive' } },
        { targetLabel: { contains: q, mode: 'insensitive' } },
        { reason: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.platformAuditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.platformAuditEvent.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorUserId: r.actorUserId,
        actorEmail: r.actorEmail,
        actorRole: r.actorRole,
        targetType: r.targetType,
        targetId: r.targetId,
        targetLabel: r.targetLabel,
        before: r.before,
        after: r.after,
        reason: r.reason,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}

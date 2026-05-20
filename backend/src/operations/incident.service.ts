import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IncidentScope as PrismaIncidentScope,
  IncidentSeverity as PrismaIncidentSeverity,
  IncidentStatus as PrismaIncidentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { PlatformAuditService } from '../platform/platform-audit.service';
import { RequestContext } from '../common/observability/request-context';

// ---------------------------------------------------------------------------
// IncidentService — Phase 22 (persistent rewrite).
//
// Previous version stored the active set in memory; a process restart
// lost everything. This rewrite uses the platform_incidents table:
//
//   • broadcast() creates the row + fans out via NotificationService
//   • resolve() flips status to RESOLVED + stamps the resolver
//   • listActive() / list() read straight from the table
//   • Survives restart by definition — operators see the same active
//     set after a deploy.
//
// Audit:
//   Both broadcast + resolve write a SCHOOL_MAINTENANCE_TOGGLED audit
//   row with `targetType='PLATFORM_INCIDENT'`. The audit row carries
//   the full diff (severity, scope, fan-out counts) so the trail is
//   self-contained.
//
// Correlation:
//   Each fan-out Notification is tagged with the originating request's
//   `correlationId`. Operators can search all rows produced by an
//   incident broadcast via the Operations Center's correlation
//   inspector.
// ---------------------------------------------------------------------------

export type IncidentSeverity = PrismaIncidentSeverity;
export type IncidentStatus = PrismaIncidentStatus;
export type IncidentScope = PrismaIncidentScope;

export interface IncidentRow {
  id: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  body: string;
  targetScope: IncidentScope;
  targetSchoolIds: string[];
  createdById: string;
  resolvedById: string | null;
  resolvedAt: string | null;
  inAppFanOut: number;
  emailFanOut: number;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class IncidentService {
  private readonly logger = new Logger(IncidentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly audit: PlatformAuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Broadcast a new incident. Persists the row first, then fans out
   * one Notification per admin per target school. Fan-out failures
   * are logged + swallowed — one school's email blip should not
   * prevent the broadcast from reaching the others.
   */
  async broadcast(input: {
    severity: IncidentSeverity;
    title: string;
    body: string;
    targetScope: IncidentScope;
    targetSchoolIds: string[];
    actor: { userId: string; email: string | null };
  }): Promise<IncidentRow> {
    const correlationId = RequestContext.requestId();

    // Resolve the target set up front so we can record the fan-out
    // counts on the persistent row.
    const schoolWhere =
      input.targetScope === 'ALL_SCHOOLS'
        ? { status: { in: ['ACTIVE' as const, 'TRIAL' as const] } }
        : { id: { in: input.targetSchoolIds } };
    const schools = await this.prisma.school.findMany({
      where: schoolWhere,
      select: { id: true, name: true },
    });
    // Session 6c.1 — exclude soft-deleted admins from the
    // incident broadcast fan-out. They can't log in or receive
    // in-app notifications meaningfully.
    const admins = await this.prisma.user.findMany({
      where: {
        schoolId: { in: schools.map((s) => s.id) },
        role: 'ADMIN',
        deletedAt: null,
      },
      select: { id: true, email: true, schoolId: true },
    });

    // Persist the row BEFORE fan-out so a crash mid-fan-out leaves
    // the incident visible (operator can re-trigger; dedupe key
    // prevents double-send to admins who already got it).
    const incident = await this.prisma.platformIncident.create({
      data: {
        title: input.title,
        body: input.body,
        severity: input.severity,
        status: 'ACTIVE',
        targetScope: input.targetScope,
        targetSchoolIds:
          input.targetScope === 'ALL_SCHOOLS'
            ? Prisma.JsonNull
            : (input.targetSchoolIds as Prisma.InputJsonValue),
        createdById: input.actor.userId,
        correlationId,
      },
    });

    // Fan out.
    const brand = this.config.get<{
      productName: string;
      supportEmail: string;
      logoUrl?: string;
      footerAddress?: string;
    }>('mail.brand') ?? {
      productName: 'Scholaris',
      supportEmail: 'support@scholaris.local',
    };
    let inAppFanOut = 0;
    let emailFanOut = 0;
    for (const admin of admins) {
      try {
        const result = await this.notifications.enqueue({
          templateKey: 'platform.incident_broadcast',
          recipients: { email: admin.email, inApp: admin.id },
          payload: {
            brand,
            headline: input.title,
            body: input.body,
            severity: input.severity,
            broadcastAt: incident.createdAt.toISOString(),
            broadcastBy: input.actor.email,
          },
          dedupeKey: `${incident.id}:${admin.id}`,
          schoolId: admin.schoolId,
          userId: admin.id,
          severity:
            input.severity === 'CRITICAL'
              ? 'CRITICAL'
              : input.severity === 'WARNING'
                ? 'WARNING'
                : 'INFO',
          title: `[${input.severity}] ${input.title}`,
        });
        for (const d of result.deliveries) {
          if (d.channel === 'IN_APP') inAppFanOut += 1;
          if (d.channel === 'EMAIL') emailFanOut += 1;
        }
      } catch (e) {
        this.logger.error(
          `Failed to enqueue incident ${incident.id} for user=${admin.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Update the persistent row with the actual fan-out counts.
    const updated = await this.prisma.platformIncident.update({
      where: { id: incident.id },
      data: { inAppFanOut, emailFanOut },
    });

    void this.audit.record({
      action: 'SCHOOL_MAINTENANCE_TOGGLED',
      actor: { userId: input.actor.userId, email: input.actor.email },
      target: {
        type: 'PLATFORM_INCIDENT',
        id: incident.id,
        label: `[${input.severity}] ${input.title}`,
      },
      after: {
        scope: input.targetScope,
        schoolCount: schools.length,
        adminCount: admins.length,
        inAppFanOut,
        emailFanOut,
        correlationId,
      },
    });

    this.logger.warn(
      `[ops] incident broadcast id=${incident.id} severity=${input.severity} ` +
        `headline="${input.title}" schools=${schools.length} admins=${admins.length}`,
    );

    return toRow(updated);
  }

  async resolve(input: {
    incidentId: string;
    actor: { userId: string; email: string | null };
  }): Promise<IncidentRow> {
    const existing = await this.prisma.platformIncident.findUnique({
      where: { id: input.incidentId },
    });
    if (!existing) {
      throw new NotFoundException(`Incident ${input.incidentId} not found.`);
    }
    if (existing.status === 'RESOLVED') return toRow(existing);

    const updated = await this.prisma.platformIncident.update({
      where: { id: input.incidentId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: input.actor.userId,
      },
    });

    void this.audit.record({
      action: 'SCHOOL_MAINTENANCE_TOGGLED',
      actor: { userId: input.actor.userId, email: input.actor.email },
      target: {
        type: 'PLATFORM_INCIDENT',
        id: input.incidentId,
        label: `[RESOLVED] ${updated.title}`,
      },
      before: { status: existing.status },
      after: { status: 'RESOLVED' },
    });

    this.logger.warn(
      `[ops] incident resolved id=${input.incidentId} actor=${input.actor.userId}`,
    );

    return toRow(updated);
  }

  /** Active incidents only. Drives the cockpit banner. */
  async listActive(): Promise<IncidentRow[]> {
    const rows = await this.prisma.platformIncident.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRow);
  }

  /** Paginated history (all statuses), newest first. */
  async list(input: { limit?: number; activeOnly?: boolean } = {}): Promise<
    IncidentRow[]
  > {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const rows = await this.prisma.platformIncident.findMany({
      where: input.activeOnly ? { status: 'ACTIVE' } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toRow);
  }
}

type Persisted = Awaited<
  ReturnType<PrismaService['platformIncident']['findUnique']>
>;

function toRow(p: NonNullable<Persisted>): IncidentRow {
  return {
    id: p.id,
    severity: p.severity,
    status: p.status,
    title: p.title,
    body: p.body,
    targetScope: p.targetScope,
    targetSchoolIds: Array.isArray(p.targetSchoolIds)
      ? (p.targetSchoolIds as string[])
      : [],
    createdById: p.createdById,
    resolvedById: p.resolvedById,
    resolvedAt: p.resolvedAt?.toISOString() ?? null,
    inAppFanOut: p.inAppFanOut,
    emailFanOut: p.emailFanOut,
    correlationId: p.correlationId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

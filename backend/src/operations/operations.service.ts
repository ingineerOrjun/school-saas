import { Injectable } from '@nestjs/common';
import {
  PlatformAuditAction,
  Prisma,
  type JobStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  HealthService,
  type SubsystemHealth,
} from '../health/health.service';
import { JobQueueService } from '../common/jobs/job-queue.service';
import {
  RequestMetricsService,
  type EndpointWindowStat,
  type RpmBucket,
} from '../common/observability/request-metrics.middleware';
import { type CircuitSnapshot } from '../common/resilience/circuit-breaker';
import { EmailChannel } from '../notifications/channels/email.channel';
import { SessionService } from '../sessions/session.service';
import { IncidentService, type IncidentRow } from './incident.service';

// ---------------------------------------------------------------------------
// OperationsService — Phase 21 aggregator.
//
// One service that fans out to the existing operational data sources
// (HealthService, JobQueueService, RequestMetricsService, SessionService,
// PlatformAuditService, NotificationService, IncidentService) and
// produces the per-section payloads the Operations Center frontend
// renders.
//
// Why an aggregator (vs each section calling its own endpoint):
//   • The KPI overview pulls signals from FIVE different services in
//     one call. A single round-trip + Promise.all keeps the frontend's
//     polling cadence honest (8 stats refreshed at 15s = one HTTP
//     call per tab, not eight).
//   • Future trims/additions touch one place. The HTTP surface
//     (one endpoint per section) stays stable while the underlying
//     fan-out evolves.
//
// All windowed metrics use a `window` enum (`15m | 1h | 24h`) shared
// across the API surface — keeps the frontend's filter buttons simple.
// ---------------------------------------------------------------------------

export type OpsWindow = '15m' | '1h' | '24h';

export interface OpsOverview {
  generatedAt: string;
  /** Number of schools with status ACTIVE / TRIAL. */
  activeSchools: number;
  /** Sessions whose lastActiveAt is in the last 15 minutes. */
  onlineUsers: number;
  /** Active sessions across the platform (revokedAt IS NULL). */
  activeSessions: number;
  /** Requests/min — sample over the last 60s. */
  requestsPerMin: number;
  /** Pending + running jobs. */
  queueDepth: number;
  /** Failed jobs in the last hour. */
  failedJobsLastHour: number;
  /** Errors recorded by the global filter in the last 60 minutes. */
  errorsLastHour: number;
  /** Error rate % over the last 5 minutes. */
  errorRatePct5m: number;
  /** Average API latency over the last 5 minutes (ms). */
  avgLatencyMs5m: number;
  /** SUPER_ADMIN sessions currently in impersonation mode. */
  activeImpersonations: number;
  /** Active broadcast incidents. */
  activeIncidents: number;
  /** Worst subsystem status across all probes. */
  subsystemStatus: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  /** Per-section severity tones — used by the cockpit's status row. */
  severityTones: {
    requests: SeverityTone;
    queue: SeverityTone;
    errors: SeverityTone;
    incidents: SeverityTone;
  };
}

export type SeverityTone = 'green' | 'amber' | 'red';

export interface OpsRequestMonitoring {
  generatedAt: string;
  window: OpsWindow;
  totals: {
    requests: number;
    errors: number;
    throttled: number;
    avgDurationMs: number;
    errorRatePct: number;
  };
  topByVolume: EndpointWindowStat[];
  slowest: EndpointWindowStat[];
  mostThrottled: EndpointWindowStat[];
  errorHeavy: EndpointWindowStat[];
  rpmSeries: RpmBucket[];
}

export interface OpsJobMonitor {
  generatedAt: string;
  queue: Record<JobStatus, number>;
  perHandler: Awaited<ReturnType<JobQueueService['perHandlerStats']>>;
  recentFailed: Awaited<ReturnType<JobQueueService['listRecent']>>;
  recentPending: Awaited<ReturnType<JobQueueService['listRecent']>>;
}

export interface OpsHealth {
  generatedAt: string;
  subsystems: SubsystemHealth[];
  worstStatus: 'HEALTHY' | 'DEGRADED' | 'DOWN';
}

export interface OpsSecurityEvent {
  id: string;
  /**
   * Loose category — chosen so the UI can render an icon + tone
   * without inferring from the action enum. Maps:
   *   FAILED_LOGIN     — login bcrypt rejection
   *   FORCE_LOGOUT     — single-user or school-wide
   *   PASSWORD_RESET   — operator-driven
   *   IMPERSONATION    — start / end
   *   MAINTENANCE      — toggle
   *   ROLE_CHANGE      — feature override (closest enum we have)
   *   THROTTLE_SPIKE   — derived from RequestMetricsService throttle
   *                      counts; surfaced when a single user crosses
   *                      a threshold in the window
   */
  category:
    | 'FAILED_LOGIN'
    | 'FORCE_LOGOUT'
    | 'PASSWORD_RESET'
    | 'IMPERSONATION'
    | 'MAINTENANCE'
    | 'ROLE_CHANGE'
    | 'THROTTLE_SPIKE';
  severity: SeverityTone;
  at: string;
  actor: string | null;
  schoolName: string | null;
  description: string;
  /** Upstream id (audit row, login failure index, etc.) for drilldown. */
  sourceId: string | null;
}

export interface OpsSecurityFeed {
  generatedAt: string;
  events: OpsSecurityEvent[];
}

export interface OpsSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  ip: string | null;
  userAgent: string | null;
  user: { id: string; email: string; role: string };
  school: { id: string; name: string; slug: string } | null;
  /** True iff lastActiveAt is in the last 15 minutes. */
  online: boolean;
}

export interface OpsSessionMonitor {
  generatedAt: string;
  totals: { active: number; onlineLast15m: number };
  rows: OpsSession[];
}

export interface OpsSchoolHealthRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Currently-paying plan, when known. */
  plan: string | null;
  /** Sessions for this school where lastActiveAt < 15m ago. */
  onlineUsers: number;
  /** Audit + notification activity in the last 24h. Proxy for "is anything happening here?" */
  activityCount24h: number;
  /** Failed jobs in the last 24h whose payload references this school. */
  queueFailures24h: number;
  /** Most-recent CRITICAL or WARNING notification, when present. */
  latestCritical: {
    title: string;
    severity: string;
    createdAt: string;
  } | null;
}

export interface OpsSchoolHealth {
  generatedAt: string;
  rows: OpsSchoolHealthRow[];
}

export interface OpsEvent {
  id: string;
  at: string;
  /** AUDIT | FAILED_JOB | FAILED_DELIVERY | ERROR | LOGIN_FAIL | INCIDENT */
  kind:
    | 'AUDIT'
    | 'FAILED_JOB'
    | 'FAILED_DELIVERY'
    | 'ERROR'
    | 'LOGIN_FAIL'
    | 'INCIDENT';
  severity: SeverityTone;
  description: string;
  /** Optional supporting hint — small string surfaced in the ticker. */
  tag: string | null;
}

export interface OpsEventStream {
  generatedAt: string;
  events: OpsEvent[];
}

// Phase 22 — abuse detection -----------------------------------------------

export interface OpsAbuseDetection {
  generatedAt: string;
  topThrottledIps: Array<{ ip: string; count: number }>;
  topThrottledUsers: Array<{ userId: string; count: number }>;
  topThrottledRoutes: Array<{ routeKey: string; count: number }>;
  /** True when any IP / user / route count exceeds the abuse threshold. */
  abuseDetected: boolean;
}

// Phase 22 — circuit breaker snapshots -------------------------------------

export interface OpsBreakers {
  generatedAt: string;
  breakers: CircuitSnapshot[];
}

// Phase 22 — correlation lookup --------------------------------------------

export interface OpsCorrelationTrace {
  correlationId: string;
  generatedAt: string;
  audit: Array<{
    id: string;
    action: string;
    actor: string | null;
    target: string | null;
    at: string;
  }>;
  jobs: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string;
    lastError: string | null;
  }>;
  notifications: Array<{
    id: string;
    templateKey: string;
    severity: string;
    title: string | null;
    createdAt: string;
  }>;
  incidents: IncidentRow[];
}

@Injectable()
export class OperationsService {
  // The "active impersonations" KPI is derived from the existing
  // PlatformAuditEvent rows (IMPERSONATION_STARTED without a matching
  // IMPERSONATION_ENDED in the same 12h window) read straight off
  // PrismaService — no need to inject either ImpersonationService
  // or PlatformAuditService here.
  //
  // EmailChannel is injected so the cockpit can read its circuit-
  // breaker snapshot (Phase 22 — Section 3 + Section 13).
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
    private readonly metrics: RequestMetricsService,
    private readonly queue: JobQueueService,
    private readonly sessions: SessionService,
    private readonly incidents: IncidentService,
    private readonly email: EmailChannel,
  ) {}

  // ---------------------------------------------------------------------------
  // Section 1 — Live system overview
  // ---------------------------------------------------------------------------

  async getOverview(): Promise<OpsOverview> {
    const now = new Date();

    const [
      schoolStatusGroups,
      sessionTotals,
      queueStats,
      failedJobsLastHour,
      errorsLastHour,
      activeImpersonations,
      subsystems,
    ] = await Promise.all([
      this.prisma.school.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.sessions.countActiveAcrossPlatform(),
      this.queue.stats(),
      this.prisma.job.count({
        where: {
          status: 'FAILED',
          completedAt: { gte: new Date(now.getTime() - 60 * 60_000) },
        },
      }),
      (() => {
        const errs = this.health.recentErrors();
        const cutoff = now.getTime() - 60 * 60_000;
        let n = 0;
        for (const e of errs) {
          if (Date.parse(e.at) < cutoff) break;
          n += 1;
        }
        return Promise.resolve(n);
      })(),
      this.countActiveImpersonations(now),
      this.health.getSubsystems(),
    ]);

    const fiveMin = this.metrics.windowSummary(5 * 60_000);
    const oneMin = this.metrics.currentRpm();

    const activeSchools =
      (schoolStatusGroups.find((g) => g.status === 'ACTIVE')?._count._all ??
        0) +
      (schoolStatusGroups.find((g) => g.status === 'TRIAL')?._count._all ?? 0);

    const queueDepth =
      (queueStats.PENDING ?? 0) + (queueStats.RUNNING ?? 0);

    const activeIncidentRows = await this.incidents.listActive();
    const activeIncidents = activeIncidentRows.length;

    const subsystemStatus = this.health.rollupSubsystemStatus(subsystems);

    return {
      generatedAt: now.toISOString(),
      activeSchools,
      onlineUsers: sessionTotals.onlineLast15m,
      activeSessions: sessionTotals.active,
      requestsPerMin: oneMin,
      queueDepth,
      failedJobsLastHour,
      errorsLastHour,
      errorRatePct5m: round(fiveMin.errorRatePct),
      avgLatencyMs5m: round(fiveMin.avgDurationMs),
      activeImpersonations,
      activeIncidents,
      subsystemStatus,
      severityTones: {
        requests: tone(oneMin, 300, 600),
        queue: tone(queueStats.FAILED ?? 0, 5, 20),
        errors: tone(errorsLastHour, 20, 50),
        incidents: tone(activeIncidents, 1, 3),
      },
    };
  }

  /**
   * Approximate count of impersonation sessions in flight.
   * Definition: IMPERSONATION_STARTED audit rows in the last 12h
   * with no matching IMPERSONATION_ENDED row for the same target.
   * Best-effort — the only definitive source would be parsing every
   * live JWT, which we don't store. The audit-based approximation
   * is good enough for an operator KPI.
   */
  private async countActiveImpersonations(now: Date): Promise<number> {
    const since = new Date(now.getTime() - 12 * 60 * 60_000);
    const events = await this.prisma.platformAuditEvent.findMany({
      where: {
        action: { in: ['IMPERSONATION_STARTED', 'IMPERSONATION_ENDED'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      select: { action: true, targetId: true, actorUserId: true },
    });
    // Count "open" pairs: each STARTED that doesn't have a matching
    // ENDED row from the same actor + target after it.
    const openByKey = new Set<string>();
    for (const e of events) {
      const key = `${e.actorUserId}:${e.targetId}`;
      if (e.action === 'IMPERSONATION_STARTED') openByKey.add(key);
      if (e.action === 'IMPERSONATION_ENDED') openByKey.delete(key);
    }
    return openByKey.size;
  }

  // ---------------------------------------------------------------------------
  // Section 2 — Request monitoring
  // ---------------------------------------------------------------------------

  getRequestMonitoring(window: OpsWindow): OpsRequestMonitoring {
    const windowMs = windowToMs(window);
    const totals = this.metrics.windowSummary(windowMs);
    return {
      generatedAt: new Date().toISOString(),
      window,
      totals: {
        requests: totals.requests,
        errors: totals.errors,
        throttled: totals.throttled,
        avgDurationMs: round(totals.avgDurationMs),
        errorRatePct: round(totals.errorRatePct),
      },
      topByVolume: this.metrics.topByWindow({
        windowMs,
        sortBy: 'volume',
        n: 10,
      }),
      slowest: this.metrics.topByWindow({
        windowMs,
        sortBy: 'latency',
        n: 10,
      }),
      mostThrottled: this.metrics.topByWindow({
        windowMs,
        sortBy: 'throttled',
        n: 10,
      }),
      errorHeavy: this.metrics.topByWindow({
        windowMs,
        sortBy: 'errors',
        n: 10,
      }),
      rpmSeries: this.metrics.rpmSeries({
        windowMs,
        bucketMs: bucketSizeForWindow(windowMs),
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Section 3 — Job queue monitor
  // ---------------------------------------------------------------------------

  async getJobMonitor(): Promise<OpsJobMonitor> {
    const [queue, perHandler, recentFailed, recentPending] = await Promise.all([
      this.queue.stats(),
      this.queue.perHandlerStats(24),
      this.queue.listRecent({ status: 'FAILED', limit: 20 }),
      this.queue.listRecent({ status: 'PENDING', limit: 20 }),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      queue,
      perHandler,
      recentFailed,
      recentPending,
    };
  }

  // ---------------------------------------------------------------------------
  // Section 4 — Subsystem health
  // ---------------------------------------------------------------------------

  async getHealth(): Promise<OpsHealth> {
    const subsystems = await this.health.getSubsystems();
    return {
      generatedAt: new Date().toISOString(),
      subsystems,
      worstStatus: this.health.rollupSubsystemStatus(subsystems),
    };
  }

  // ---------------------------------------------------------------------------
  // Section 5 — Security feed
  // ---------------------------------------------------------------------------

  async getSecurityFeed(input: {
    limit?: number;
    schoolId?: string;
  }): Promise<OpsSecurityFeed> {
    const limit = Math.min(100, Math.max(10, input.limit ?? 50));
    const since = new Date(Date.now() - 24 * 60 * 60_000);

    // Pull security-flavoured audit rows.
    const securityActions: PlatformAuditAction[] = [
      'USER_FORCE_LOGOUT',
      'SCHOOL_FORCE_LOGOUT',
      'ADMIN_PASSWORD_RESET',
      'IMPERSONATION_STARTED',
      'IMPERSONATION_ENDED',
      'SCHOOL_MAINTENANCE_TOGGLED',
      'FEATURE_FLAG_CHANGED',
      'SCHOOL_STATUS_CHANGED',
    ];
    const where: Prisma.PlatformAuditEventWhereInput = {
      action: { in: securityActions },
      createdAt: { gte: since },
    };
    if (input.schoolId) {
      // Audit rows store target details in JSON. The school-scoped
      // ones use targetType='SCHOOL' with targetId=schoolId; for
      // user-targeted rows we drop them when a school filter is set
      // (best-effort — the alternative is a join on user.schoolId
      // which we can add later if operators ask for it).
      where.OR = [{ targetType: 'SCHOOL', targetId: input.schoolId }];
    }
    const auditRows = await this.prisma.platformAuditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        actorEmail: true,
        targetLabel: true,
        targetType: true,
        targetId: true,
        createdAt: true,
        reason: true,
      },
    });

    // Recent failed-login summary from the in-memory ring.
    const loginEvents: OpsSecurityEvent[] = this.health
      .recentLoginFailures()
      .slice(0, 25)
      .map((f, idx) => ({
        id: `login:${idx}:${f.at}`,
        category: 'FAILED_LOGIN',
        severity: 'amber',
        at: f.at,
        actor: f.email,
        schoolName: null,
        description: `Failed login attempt (${f.reason})`,
        sourceId: null,
      }));

    // Throttle spikes — top throttled users with > 50 events.
    const throttleSpikes: OpsSecurityEvent[] = this.metrics
      .topThrottledUsers(10)
      .filter((row) => row.count >= 50)
      .map((row) => ({
        id: `throttle:${row.userId}`,
        category: 'THROTTLE_SPIKE',
        severity: 'red',
        at: new Date().toISOString(),
        actor: row.userId,
        schoolName: null,
        description: `${row.count} throttled requests since process start`,
        sourceId: row.userId,
      }));

    const auditEvents: OpsSecurityEvent[] = auditRows.map((r) => ({
      id: `audit:${r.id}`,
      category: categoryFor(r.action),
      severity: severityFor(r.action),
      at: r.createdAt.toISOString(),
      actor: r.actorEmail,
      schoolName: r.targetType === 'SCHOOL' ? r.targetLabel : null,
      description: descriptionFor(r),
      sourceId: r.id,
    }));

    const events = [...auditEvents, ...loginEvents, ...throttleSpikes].sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at),
    );

    return {
      generatedAt: new Date().toISOString(),
      events: events.slice(0, limit),
    };
  }

  // ---------------------------------------------------------------------------
  // Section 6 — Session monitor
  // ---------------------------------------------------------------------------

  async getSessionMonitor(input: {
    q?: string;
    schoolId?: string;
    onlyOnline?: boolean;
    limit?: number;
  }): Promise<OpsSessionMonitor> {
    const [totals, rows] = await Promise.all([
      this.sessions.countActiveAcrossPlatform(),
      this.sessions.listActiveForOps(input),
    ]);
    const cutoff = Date.now() - 15 * 60_000;
    return {
      generatedAt: new Date().toISOString(),
      totals,
      rows: rows.map((r) => ({
        ...r,
        online: Date.parse(r.lastActiveAt) >= cutoff,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Section 7 — School health grid
  // ---------------------------------------------------------------------------

  async getSchoolHealthGrid(): Promise<OpsSchoolHealth> {
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);
    const cutoff15m = new Date(Date.now() - 15 * 60_000);

    // Pull every school + its current subscription via the most-
    // recent SchoolSubscription row. We use raw SQL instead of
    // Prisma's `include` because we need ONE subscription per
    // school (DISTINCT ON) and Prisma's API doesn't express that
    // cleanly.
    const schools = await this.prisma.school.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { plan: true, endDate: true },
        },
      },
    });

    const schoolIds = schools.map((s) => s.id);

    const [onlineGroups, notifAgg, jobAgg, latestCriticals] = await Promise.all(
      [
        // Online users per school — group sessions by user.schoolId.
        // Two-step: pull active session userIds, group by that user's
        // schoolId. Prisma can't `groupBy` across a join in one call,
        // so we do it in JS over a small projection.
        this.prisma.session
          .findMany({
            where: { revokedAt: null, lastActiveAt: { gte: cutoff15m } },
            select: { user: { select: { schoolId: true } } },
          })
          .then((rows) => {
            const map = new Map<string, number>();
            for (const r of rows) {
              if (!r.user.schoolId) continue;
              map.set(r.user.schoolId, (map.get(r.user.schoolId) ?? 0) + 1);
            }
            return map;
          }),
        // Recent activity proxy = notification rows in the last 24h.
        this.prisma.notification.groupBy({
          by: ['schoolId'],
          where: {
            schoolId: { in: schoolIds },
            createdAt: { gte: since24h },
          },
          _count: { _all: true },
        }),
        // Failed-job count per school. Job payloads carry `schoolId`
        // for handlers that need it; we count via a JSON path
        // predicate — works on Postgres JSONB, which is the project's
        // backing store.
        this.prisma.$queryRaw<Array<{ schoolId: string; count: bigint }>>`
          SELECT (payload->>'schoolId') as "schoolId", COUNT(*) as count
          FROM jobs
          WHERE status = 'FAILED'
            AND "completedAt" >= ${since24h}
            AND payload ? 'schoolId'
          GROUP BY (payload->>'schoolId')
        `,
        // Most-recent CRITICAL/WARNING notification per school. Done
        // in JS over a single bounded query so we don't fan out one
        // SELECT per school.
        this.prisma.notification.findMany({
          where: {
            schoolId: { in: schoolIds },
            severity: { in: ['CRITICAL', 'WARNING'] },
            createdAt: { gte: since24h },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            schoolId: true,
            title: true,
            severity: true,
            createdAt: true,
          },
        }),
      ],
    );

    const notifMap = new Map<string, number>();
    for (const g of notifAgg) {
      if (g.schoolId) notifMap.set(g.schoolId, g._count._all);
    }
    const jobMap = new Map<string, number>();
    for (const r of jobAgg) {
      jobMap.set(r.schoolId, Number(r.count));
    }
    const latestMap = new Map<
      string,
      { title: string; severity: string; createdAt: string }
    >();
    for (const n of latestCriticals) {
      if (!n.schoolId) continue;
      if (latestMap.has(n.schoolId)) continue; // already have the newest
      latestMap.set(n.schoolId, {
        title: n.title ?? '',
        severity: n.severity,
        createdAt: n.createdAt.toISOString(),
      });
    }

    const rows: OpsSchoolHealthRow[] = schools.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      status: s.status,
      plan: s.subscriptions[0]?.plan ?? null,
      onlineUsers: onlineGroups.get(s.id) ?? 0,
      activityCount24h: notifMap.get(s.id) ?? 0,
      queueFailures24h: jobMap.get(s.id) ?? 0,
      latestCritical: latestMap.get(s.id) ?? null,
    }));

    return {
      generatedAt: new Date().toISOString(),
      rows,
    };
  }

  // ---------------------------------------------------------------------------
  // Section 8 — Real-time event stream
  // ---------------------------------------------------------------------------

  async getEventStream(input: { limit?: number }): Promise<OpsEventStream> {
    const limit = Math.min(80, Math.max(10, input.limit ?? 30));
    const since = new Date(Date.now() - 6 * 60 * 60_000);

    const [auditRows, failedJobs, failedDeliveries] = await Promise.all([
      this.prisma.platformAuditEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          action: true,
          actorEmail: true,
          targetLabel: true,
          targetType: true,
          createdAt: true,
        },
      }),
      this.prisma.job.findMany({
        where: { status: 'FAILED', completedAt: { gte: since } },
        orderBy: { completedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          name: true,
          completedAt: true,
          lastError: true,
        },
      }),
      this.prisma.notificationDelivery.findMany({
        where: { status: 'FAILED', updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          channel: true,
          recipient: true,
          updatedAt: true,
          errorMessage: true,
        },
      }),
    ]);

    // In-memory error + login-failure rings.
    const errors = this.health.recentErrors();
    const loginFails = this.health.recentLoginFailures();
    const incidents = await this.incidents.list({ limit: 25 });

    const events: OpsEvent[] = [
      ...auditRows.map((r) => ({
        id: `audit:${r.id}`,
        at: r.createdAt.toISOString(),
        kind: 'AUDIT' as const,
        severity: severityFor(r.action) as SeverityTone,
        description: descriptionFor(r),
        tag: r.actorEmail,
      })),
      ...failedJobs.map((j) => ({
        id: `job:${j.id}`,
        at: (j.completedAt ?? new Date()).toISOString(),
        kind: 'FAILED_JOB' as const,
        severity: 'red' as SeverityTone,
        description: `Job ${j.name} failed: ${truncate(j.lastError ?? 'unknown', 80)}`,
        tag: j.name,
      })),
      ...failedDeliveries.map((d) => ({
        id: `delivery:${d.id}`,
        at: d.updatedAt.toISOString(),
        kind: 'FAILED_DELIVERY' as const,
        severity: 'amber' as SeverityTone,
        description: `${d.channel} delivery to ${d.recipient} failed: ${truncate(d.errorMessage ?? '', 60)}`,
        tag: d.channel,
      })),
      ...errors.slice(0, 20).map((e, i) => ({
        id: `error:${i}:${e.at}`,
        at: e.at,
        kind: 'ERROR' as const,
        severity: 'red' as SeverityTone,
        description: `${e.method} ${e.route} → ${e.status}`,
        tag: 'server-error',
      })),
      ...loginFails.slice(0, 20).map((l, i) => ({
        id: `login:${i}:${l.at}`,
        at: l.at,
        kind: 'LOGIN_FAIL' as const,
        severity: 'amber' as SeverityTone,
        description: `Login failed for ${l.email} (${l.reason})`,
        tag: 'auth',
      })),
      ...incidents.map((inc: IncidentRow) => ({
        id: `incident:${inc.id}`,
        at: inc.createdAt,
        kind: 'INCIDENT' as const,
        severity: incidentSeverity(inc.severity),
        description: `[${inc.severity}] ${inc.title}`,
        tag: inc.targetScope === 'ALL_SCHOOLS' ? 'all-schools' : 'targeted',
      })),
    ]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, limit);

    return { generatedAt: new Date().toISOString(), events };
  }

  // ---------------------------------------------------------------------------
  // Phase 22 — Abuse detection (Section 8 + 13)
  // ---------------------------------------------------------------------------

  getAbuseDetection(): OpsAbuseDetection {
    const ips = this.metrics.topThrottledIps(10);
    const users = this.metrics.topThrottledUsers(10);
    const routes = this.metrics.topThrottledRoutes(10);
    // "Abuse" threshold — any single IP / user / route over 100 429s
    // since process start. Tunable; conservative on the low side so
    // ops sees a signal early rather than missing one.
    const abuseDetected =
      ips.some((r) => r.count >= 100) ||
      users.some((r) => r.count >= 100) ||
      routes.some((r) => r.count >= 100);
    return {
      generatedAt: new Date().toISOString(),
      topThrottledIps: ips,
      topThrottledUsers: users,
      topThrottledRoutes: routes,
      abuseDetected,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 22 — Dead letter queue (Section 2)
  // ---------------------------------------------------------------------------

  async getDeadLetterQueue(input: { name?: string; limit?: number } = {}) {
    const rows = await this.queue.listDeadLetters(input);
    return {
      generatedAt: new Date().toISOString(),
      rows,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 22 — Circuit breaker snapshots (Section 3 + 13)
  // ---------------------------------------------------------------------------

  getBreakers(): OpsBreakers {
    return {
      generatedAt: new Date().toISOString(),
      breakers: [this.email.circuit.snapshot()],
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 22 — Correlation lookup (Section 5 + 13)
  // ---------------------------------------------------------------------------

  /**
   * Pull every recorded artifact tagged with a given correlation
   * id: audit rows, jobs, notifications, incidents. Drives the
   * Operations Center "trace this request" inspector — operator
   * pastes an `x-request-id` from a customer report and gets the
   * full causal chain.
   */
  async getCorrelationTrace(
    correlationId: string,
  ): Promise<OpsCorrelationTrace> {
    const [audit, jobs, notifications, incidents] = await Promise.all([
      this.prisma.platformAuditEvent.findMany({
        where: { correlationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          actorEmail: true,
          targetLabel: true,
          createdAt: true,
        },
      }),
      this.prisma.job.findMany({
        where: { correlationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          lastError: true,
        },
      }),
      this.prisma.notification.findMany({
        where: { correlationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          templateKey: true,
          severity: true,
          title: true,
          createdAt: true,
        },
      }),
      this.prisma.platformIncident.findMany({
        where: { correlationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      correlationId,
      generatedAt: new Date().toISOString(),
      audit: audit.map((r) => ({
        id: r.id,
        action: r.action,
        actor: r.actorEmail,
        target: r.targetLabel,
        at: r.createdAt.toISOString(),
      })),
      jobs: jobs.map((j) => ({
        id: j.id,
        name: j.name,
        status: j.status as string,
        createdAt: j.createdAt.toISOString(),
        lastError: j.lastError,
      })),
      notifications: notifications.map((n) => ({
        id: n.id,
        templateKey: n.templateKey,
        severity: n.severity as string,
        title: n.title,
        createdAt: n.createdAt.toISOString(),
      })),
      incidents: incidents.map((p) => ({
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
      })),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function windowToMs(w: OpsWindow): number {
  switch (w) {
    case '15m':
      return 15 * 60_000;
    case '1h':
      return 60 * 60_000;
    case '24h':
      return 24 * 60 * 60_000;
  }
}

/** Sensible chart bucket sizes — about 30 buckets per window. */
function bucketSizeForWindow(windowMs: number): number {
  return Math.max(1_000, Math.floor(windowMs / 30));
}

function tone(value: number, amber: number, red: number): SeverityTone {
  if (value >= red) return 'red';
  if (value >= amber) return 'amber';
  return 'green';
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function categoryFor(action: PlatformAuditAction): OpsSecurityEvent['category'] {
  switch (action) {
    case 'USER_FORCE_LOGOUT':
    case 'SCHOOL_FORCE_LOGOUT':
      return 'FORCE_LOGOUT';
    case 'ADMIN_PASSWORD_RESET':
      return 'PASSWORD_RESET';
    case 'IMPERSONATION_STARTED':
    case 'IMPERSONATION_ENDED':
      return 'IMPERSONATION';
    case 'SCHOOL_MAINTENANCE_TOGGLED':
      return 'MAINTENANCE';
    case 'FEATURE_FLAG_CHANGED':
    case 'SCHOOL_STATUS_CHANGED':
    case 'SCHOOL_CODE_ASSIGNED':
    case 'SCHOOL_CODE_UPDATED':
      return 'ROLE_CHANGE';
    case 'SUBSCRIPTION_CREATED':
      return 'ROLE_CHANGE';
  }
}

function severityFor(action: PlatformAuditAction): SeverityTone {
  switch (action) {
    case 'SCHOOL_FORCE_LOGOUT':
    case 'IMPERSONATION_STARTED':
      return 'red';
    case 'USER_FORCE_LOGOUT':
    case 'ADMIN_PASSWORD_RESET':
    case 'SCHOOL_MAINTENANCE_TOGGLED':
    case 'FEATURE_FLAG_CHANGED':
    case 'SCHOOL_STATUS_CHANGED':
      return 'amber';
    default:
      return 'green';
  }
}

function descriptionFor(r: {
  action: PlatformAuditAction;
  actorEmail: string | null;
  targetLabel: string | null;
}): string {
  const actor = r.actorEmail ?? '<unknown>';
  const target = r.targetLabel ?? '';
  switch (r.action) {
    case 'USER_FORCE_LOGOUT':
      return `${actor} force-logged-out ${target}`;
    case 'SCHOOL_FORCE_LOGOUT':
      return `${actor} force-logged-out every user at ${target}`;
    case 'ADMIN_PASSWORD_RESET':
      return `${actor} reset password for ${target}`;
    case 'IMPERSONATION_STARTED':
      return `${actor} started impersonating ${target}`;
    case 'IMPERSONATION_ENDED':
      return `${actor} ended impersonation of ${target}`;
    case 'SCHOOL_MAINTENANCE_TOGGLED':
      return `${actor} toggled maintenance for ${target}`;
    case 'FEATURE_FLAG_CHANGED':
      return `${actor} updated feature flags for ${target}`;
    case 'SCHOOL_STATUS_CHANGED':
      return `${actor} changed status for ${target}`;
    case 'SUBSCRIPTION_CREATED':
      return `${actor} created subscription for ${target}`;
    case 'SCHOOL_CODE_ASSIGNED':
      return `${actor} assigned School ID for ${target}`;
    case 'SCHOOL_CODE_UPDATED':
      return `${actor} changed School ID for ${target}`;
  }
}

function incidentSeverity(s: 'INFO' | 'WARNING' | 'CRITICAL'): SeverityTone {
  switch (s) {
    case 'INFO':
      return 'green';
    case 'WARNING':
      return 'amber';
    case 'CRITICAL':
      return 'red';
  }
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}


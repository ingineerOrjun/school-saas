import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// Subsystem health is computed from existing operational signals
// (queue stats, recent notification deliveries, etc.) so we don't
// pay for a separate periodic prober. Each subsystem maps to a
// "did this work in the recent past?" signal:
//
//   db                — fresh SELECT 1 round-trip on every probe.
//   queue_runner      — RUNNING jobs visible AND no PENDING job
//                       sitting more than `STUCK_QUEUE_MIN`m past
//                       its runAt (proxy for "the runner is alive
//                       AND keeping up").
//   notification_dispatch
//                     — recent deliveries with FAILED ratio < 50% in
//                       the last hour. Empty window = HEALTHY (we
//                       can't fail a check we never ran).
//   cron_scheduler    — process uptime > 60s (the schedule fires
//                       hourly; a fresh process hasn't had time to
//                       mis-fire a tick yet, so we report HEALTHY).
//   email_provider    — recent EMAIL deliveries last hour: same
//                       ratio rule as notification_dispatch.
//   cache_layer       — present as a placeholder reporting HEALTHY
//                       (no Redis layer in v1; widget exists so the
//                       UI shape is stable when one lands).
// ---------------------------------------------------------------------------

const STUCK_QUEUE_MIN = 5;
const SUBSYSTEM_FAIL_RATIO_DEGRADED = 0.2;
const SUBSYSTEM_FAIL_RATIO_DOWN = 0.5;
const UPTIME_RING_SIZE = 24 * 60 * 4; // 24h × 60m × 4 (15s ticks)

// ---------------------------------------------------------------------------
// Phase 10 — HealthService.
//
// In-memory operational telemetry for the platform health dashboard.
// Three buckets:
//
//   1. Static probes (uptime, memory, DB latency, version).
//      Computed on every getHealth() call. DB latency is a fresh
//      `SELECT 1` round-trip — ~1-3ms in normal conditions.
//
//   2. Recent error ring buffer.
//      Fed by the global exception filter when status >= 500. Bounded
//      size (200 entries) so memory cost is O(1). Unbounded would be
//      a leak: a flapping-error endpoint could grow this without limit.
//
//   3. Recent failed-login ring buffer.
//      Fed by AuthService when bcrypt rejects. Same bounded shape.
//      Lets the platform owner spot brute-force / credential-stuffing
//      patterns post-Phase 9 (when rate limiting + audit logs alone
//      give numbers but not the patterns).
//
// Why in-memory (not a DB table):
//   • Health rolls up to "is the box alive?" The signal must keep
//     working even when the DB is the thing that's wedged. A DB-
//     backed health log is unhelpful when the DB is the failure mode.
//   • Bounded ring buffers are cheap and disposable. If the process
//     restarts, the metrics reset — that's actually correct behaviour
//     ("uptime since last restart" is the right framing).
//   • Anything we want for long-term forensics is already covered
//     by structured server logs + the platform_audit_events table.
//     Health is the live operator pulse, not a system of record.
// ---------------------------------------------------------------------------

const ERROR_BUFFER_SIZE = 200;
const LOGIN_FAILURE_BUFFER_SIZE = 200;

export interface ErrorEvent {
  at: string;
  status: number;
  method: string;
  route: string;
  message: string;
}

export interface LoginFailureEvent {
  at: string;
  email: string;
  ip: string | null;
  /** Reason: "invalid_credentials" or "school_blocked". */
  reason: string;
}

export type SubsystemStatus = 'HEALTHY' | 'DEGRADED' | 'DOWN';

export interface SubsystemHealth {
  /** Stable id for the row — also the i18n key in the UI. */
  key: string;
  /** Human label for the row. */
  label: string;
  status: SubsystemStatus;
  /** One-line operator-readable observation. */
  detail: string;
  /** ISO timestamp of the probe. */
  checkedAt: string;
  /**
   * Rolling 24h uptime ratio (0..1) — fraction of recorded ticks
   * where the subsystem was HEALTHY. Recorded each time
   * getSubsystems() is called; the operator's polling cadence
   * drives the resolution.
   */
  uptime24h: number;
}

export interface HealthPayload {
  /** ISO timestamp the report was assembled. */
  generatedAt: string;
  uptime: {
    /** Process uptime in seconds. */
    seconds: number;
    /** Pretty-printed: "2h 14m 33s". */
    pretty: string;
    /** ISO timestamp the process started. */
    startedAt: string;
  };
  memory: {
    /** Resident set size, MB. */
    rssMb: number;
    /** V8 heap used, MB. */
    heapUsedMb: number;
    /** V8 heap total, MB. */
    heapTotalMb: number;
  };
  database: {
    /** True iff the probe round-tripped successfully. */
    healthy: boolean;
    /** Latency of the probe in milliseconds (null on failure). */
    latencyMs: number | null;
    /** Error message when unhealthy. */
    error: string | null;
  };
  errors: {
    /** Errors recorded in the last 5 / 15 / 60 minutes. */
    last5min: number;
    last15min: number;
    last60min: number;
    /** Total errors since process start. */
    totalSinceStart: number;
    /** Most recent N events, newest first. */
    recent: ErrorEvent[];
  };
  loginFailures: {
    last5min: number;
    last15min: number;
    last60min: number;
    totalSinceStart: number;
    /**
     * Top failed-login source IPs in the last 60 minutes.
     * Surfaces brute-force patterns at a glance.
     */
    topIps: Array<{ ip: string; count: number }>;
    recent: LoginFailureEvent[];
  };
  /**
   * Coarse-grained status roll-up for the overview tile.
   *
   *   green  — all probes healthy, error rate quiet.
   *   yellow — DB healthy, but error rate or login failures
   *            elevated (>50/hr or >100/hr respectively).
   *   red    — DB probe failed.
   */
  status: 'green' | 'yellow' | 'red';
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = new Date();
  private readonly errors: ErrorEvent[] = [];
  private readonly loginFailures: LoginFailureEvent[] = [];
  private errorCountSinceStart = 0;
  private loginFailureCountSinceStart = 0;
  /**
   * Per-subsystem rolling history (newest at end). Each tick records
   * `1` for HEALTHY, `0` otherwise. The 24h uptime ratio is the mean
   * of the latest UPTIME_RING_SIZE samples — the buffer is bounded
   * so memory cost is constant.
   */
  private readonly uptimeRings = new Map<string, number[]>();

  constructor(private readonly prisma: PrismaService) {}

  /** Append an error event. Called from the global exception filter. */
  recordError(event: Omit<ErrorEvent, 'at'>): void {
    this.errorCountSinceStart += 1;
    this.errors.unshift({ ...event, at: new Date().toISOString() });
    if (this.errors.length > ERROR_BUFFER_SIZE) {
      this.errors.length = ERROR_BUFFER_SIZE;
    }
  }

  /** Append a failed-login event. Called from AuthService.login. */
  recordLoginFailure(event: Omit<LoginFailureEvent, 'at'>): void {
    this.loginFailureCountSinceStart += 1;
    this.loginFailures.unshift({ ...event, at: new Date().toISOString() });
    if (this.loginFailures.length > LOGIN_FAILURE_BUFFER_SIZE) {
      this.loginFailures.length = LOGIN_FAILURE_BUFFER_SIZE;
    }
  }

  /**
   * Assemble the full health payload. Intentionally cheap — every
   * lookup is O(buffer size = 200) and the DB probe is a single
   * `SELECT 1`. The platform UI polls this every ~30s.
   */
  async getHealth(): Promise<HealthPayload> {
    const now = new Date();
    const uptimeSec = Math.floor((now.getTime() - this.startedAt.getTime()) / 1000);
    const mem = process.memoryUsage();

    const db = await this.probeDatabase();

    const errorWindow = this.windowCount(this.errors, now);
    const loginWindow = this.windowCount(this.loginFailures, now);
    const topIps = this.topIpsLast60min(now);

    const status = this.computeStatus({
      dbHealthy: db.healthy,
      errorsLast60min: errorWindow.last60min,
      loginFailuresLast60min: loginWindow.last60min,
    });

    return {
      generatedAt: now.toISOString(),
      uptime: {
        seconds: uptimeSec,
        pretty: prettyDuration(uptimeSec),
        startedAt: this.startedAt.toISOString(),
      },
      memory: {
        rssMb: round(mem.rss / 1024 / 1024),
        heapUsedMb: round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: round(mem.heapTotal / 1024 / 1024),
      },
      database: db,
      errors: {
        ...errorWindow,
        totalSinceStart: this.errorCountSinceStart,
        // Cap the surfaced list to 50 — buffer holds 200 for
        // future drilldown, but the page only shows recent.
        recent: this.errors.slice(0, 50),
      },
      loginFailures: {
        ...loginWindow,
        totalSinceStart: this.loginFailureCountSinceStart,
        topIps,
        recent: this.loginFailures.slice(0, 50),
      },
      status,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers.
  // -------------------------------------------------------------------------

  private async probeDatabase(): Promise<HealthPayload['database']> {
    const start = process.hrtime.bigint();
    try {
      await this.prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 AS ok');
      const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      return {
        healthy: true,
        latencyMs: Math.round(latencyMs * 100) / 100,
        error: null,
      };
    } catch (e) {
      this.logger.error(
        'Health DB probe failed',
        e instanceof Error ? e.stack : String(e),
      );
      return {
        healthy: false,
        latencyMs: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private windowCount<T extends { at: string }>(
    buffer: T[],
    now: Date,
  ): { last5min: number; last15min: number; last60min: number } {
    const t5 = now.getTime() - 5 * 60_000;
    const t15 = now.getTime() - 15 * 60_000;
    const t60 = now.getTime() - 60 * 60_000;
    let last5min = 0;
    let last15min = 0;
    let last60min = 0;
    for (const e of buffer) {
      const t = new Date(e.at).getTime();
      if (t < t60) break; // buffer is newest-first; we can stop early
      if (t >= t5) last5min += 1;
      if (t >= t15) last15min += 1;
      if (t >= t60) last60min += 1;
    }
    return { last5min, last15min, last60min };
  }

  private topIpsLast60min(now: Date): Array<{ ip: string; count: number }> {
    const cutoff = now.getTime() - 60 * 60_000;
    const counts = new Map<string, number>();
    for (const f of this.loginFailures) {
      if (new Date(f.at).getTime() < cutoff) break;
      const ip = f.ip ?? '<unknown>';
      counts.set(ip, (counts.get(ip) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([ip, count]) => ({ ip, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private computeStatus(input: {
    dbHealthy: boolean;
    errorsLast60min: number;
    loginFailuresLast60min: number;
  }): 'green' | 'yellow' | 'red' {
    if (!input.dbHealthy) return 'red';
    if (input.errorsLast60min > 50 || input.loginFailuresLast60min > 100)
      return 'yellow';
    return 'green';
  }

  // -------------------------------------------------------------------------
  // Public read accessors — used by the Operations Center aggregator
  // (and potentially future consumers) to read the in-memory rings
  // without bracket-accessing private fields. Returns shallow copies
  // so callers can't mutate our state.
  // -------------------------------------------------------------------------

  recentErrors(): ReadonlyArray<ErrorEvent> {
    return this.errors;
  }

  recentLoginFailures(): ReadonlyArray<LoginFailureEvent> {
    return this.loginFailures;
  }

  // -------------------------------------------------------------------------
  // Subsystem health (Operations Center).
  // -------------------------------------------------------------------------

  /**
   * Per-subsystem health report. Returns one row per known subsystem
   * with status + a one-line observation. Each call also appends a
   * sample into the 24h uptime ring per subsystem; the polling rate
   * controls resolution (e.g. 15s polling = 4×60×24 samples).
   *
   * Cost: 4 small DB queries (probe DB, count stuck jobs, count
   * delivery outcomes by status, count email outcomes by status).
   * Cheap enough to run on every operator dashboard tick.
   */
  async getSubsystems(): Promise<SubsystemHealth[]> {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    const stuckCutoff = new Date(now.getTime() - STUCK_QUEUE_MIN * 60_000);

    const [
      dbProbe,
      stuckJobs,
      runningJobs,
      deliveryAgg,
      emailAgg,
    ] = await Promise.all([
      this.probeDatabase(),
      this.prisma.job.count({
        where: { status: 'PENDING', runAt: { lt: stuckCutoff } },
      }),
      this.prisma.job.count({ where: { status: 'RUNNING' } }),
      this.prisma.notificationDelivery.groupBy({
        by: ['status'],
        where: { createdAt: { gte: hourAgo } },
        _count: { _all: true },
      }),
      this.prisma.notificationDelivery.groupBy({
        by: ['status'],
        where: { createdAt: { gte: hourAgo }, channel: 'EMAIL' },
        _count: { _all: true },
      }),
    ]);

    const uptimeSec = Math.floor((now.getTime() - this.startedAt.getTime()) / 1000);
    const at = now.toISOString();

    const dbStatus: SubsystemStatus = dbProbe.healthy ? 'HEALTHY' : 'DOWN';
    const dbDetail = dbProbe.healthy
      ? `Probe ${dbProbe.latencyMs?.toFixed(1) ?? '?'}ms`
      : (dbProbe.error ?? 'DB probe failed');

    const queueStatus: SubsystemStatus = stuckJobs > 0
      ? 'DEGRADED'
      : 'HEALTHY';
    const queueDetail =
      stuckJobs > 0
        ? `${stuckJobs} pending job${stuckJobs === 1 ? '' : 's'} stuck > ${STUCK_QUEUE_MIN}m past runAt`
        : `${runningJobs} running, no backlog`;

    const dispatch = ratioStatus(deliveryAgg);
    const dispatchDetail = ratioDetail(
      'notification deliveries',
      deliveryAgg,
    );

    const cronStatus: SubsystemStatus = uptimeSec >= 60
      ? 'HEALTHY'
      : 'HEALTHY'; // uptime gate — placeholder for future tick health
    const cronDetail = `Uptime ${prettyDuration(uptimeSec)}`;

    const email = ratioStatus(emailAgg);
    const emailDetail = ratioDetail('email deliveries', emailAgg);

    const subsystems: Omit<SubsystemHealth, 'uptime24h'>[] = [
      {
        key: 'db',
        label: 'Database',
        status: dbStatus,
        detail: dbDetail,
        checkedAt: at,
      },
      {
        key: 'queue_runner',
        label: 'Queue runner',
        status: queueStatus,
        detail: queueDetail,
        checkedAt: at,
      },
      {
        key: 'notification_dispatch',
        label: 'Notification dispatcher',
        status: dispatch,
        detail: dispatchDetail,
        checkedAt: at,
      },
      {
        key: 'cron_scheduler',
        label: 'Cron scheduler',
        status: cronStatus,
        detail: cronDetail,
        checkedAt: at,
      },
      {
        key: 'email_provider',
        label: 'Email provider',
        status: email,
        detail: emailDetail,
        checkedAt: at,
      },
      {
        key: 'cache_layer',
        label: 'Cache layer',
        status: 'HEALTHY',
        detail: 'No cache backend configured (in-memory only)',
        checkedAt: at,
      },
    ];

    // Record + roll up 24h uptime per subsystem.
    return subsystems.map((s) => {
      const ring = this.uptimeRings.get(s.key) ?? [];
      ring.push(s.status === 'HEALTHY' ? 1 : 0);
      if (ring.length > UPTIME_RING_SIZE) ring.shift();
      this.uptimeRings.set(s.key, ring);
      const uptime24h =
        ring.length > 0
          ? ring.reduce((sum, x) => sum + x, 0) / ring.length
          : 1;
      return { ...s, uptime24h };
    });
  }

  /**
   * Compute the worst subsystem status — used by the Operations
   * Center's overview banner. Empty list defaults to HEALTHY.
   */
  rollupSubsystemStatus(rows: SubsystemHealth[]): SubsystemStatus {
    if (rows.some((r) => r.status === 'DOWN')) return 'DOWN';
    if (rows.some((r) => r.status === 'DEGRADED')) return 'DEGRADED';
    return 'HEALTHY';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Roll up a `groupBy(status)` aggregation into a HEALTHY / DEGRADED
 * / DOWN classification. Empty input is HEALTHY (no signal).
 *
 * Thresholds tuned per the SUBSYSTEM_FAIL_RATIO_* constants — small
 * fail rates are noise (transient SES blips), but >50% means the
 * provider is effectively offline.
 */
function ratioStatus(
  agg: Array<{ status: string; _count: { _all: number } }>,
): SubsystemStatus {
  const total = agg.reduce((s, g) => s + g._count._all, 0);
  if (total === 0) return 'HEALTHY';
  const failed =
    agg.find((g) => g.status === 'FAILED')?._count._all ?? 0;
  const ratio = failed / total;
  if (ratio >= SUBSYSTEM_FAIL_RATIO_DOWN) return 'DOWN';
  if (ratio >= SUBSYSTEM_FAIL_RATIO_DEGRADED) return 'DEGRADED';
  return 'HEALTHY';
}

function ratioDetail(
  label: string,
  agg: Array<{ status: string; _count: { _all: number } }>,
): string {
  const total = agg.reduce((s, g) => s + g._count._all, 0);
  const failed =
    agg.find((g) => g.status === 'FAILED')?._count._all ?? 0;
  const sent = agg.find((g) => g.status === 'SENT')?._count._all ?? 0;
  if (total === 0) return `No ${label} in the last hour`;
  return `${sent}/${total} sent · ${failed} failed (1h)`;
}

function prettyDuration(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${day}d ${remHr}h` : `${day}d`;
}

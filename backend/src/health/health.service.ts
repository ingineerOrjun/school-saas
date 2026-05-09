import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(n: number): number {
  return Math.round(n * 100) / 100;
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

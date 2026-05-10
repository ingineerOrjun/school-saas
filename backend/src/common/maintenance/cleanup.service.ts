import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// CleanupService — Phase 22 (Section 4).
//
// Scheduled cleanup of operational tables. Each cleanup runs daily at
// the same off-peak hour; the sweepers don't fight over locks because
// they each touch a different table.
//
// Retention defaults (overridable via env):
//
//   • RETENTION_NOTIFICATION_DAYS     (default 90)
//     Notifications older than this are deleted. Audit info is in
//     the platform_audit_events table; notifications are operational
//     copy that doesn't need long-term retention.
//
//   • RETENTION_SESSION_DAYS          (default 30)
//     Revoked sessions older than this are deleted. Active sessions
//     are NEVER touched.
//
//   • RETENTION_INCIDENT_DAYS         (default 60)
//     RESOLVED incidents older than this are deleted. Active ones
//     are NEVER touched.
//
//   • RETENTION_JOB_DAYS              (default 14)
//     SUCCEEDED / DEAD / FAILED_PERMANENT jobs older than this are
//     deleted. PENDING / RUNNING / FAILED rows (still in flight) are
//     NEVER touched.
//
// Scheduling:
//   Daily at 03:30 UTC (CronExpression.EVERY_DAY_AT_3AM is 03:00).
//   30-minute offset prevents overlap with hourly subscription jobs.
//   Each method protects itself with try/catch — one failure
//   doesn't stop the others.
//
// Bounded delete:
//   `take` is enforced via a candidate list + `deleteMany({ id: in })`
//   so a single cron tick can never delete more than `MAX_PER_TICK`
//   rows. Builds in over months without ever blocking the DB.
// ---------------------------------------------------------------------------

const MAX_PER_TICK = 5_000;

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cron entry — runs daily at 03:30 UTC. Public so the
   * Operations Center can trigger a manual sweep on demand.
   */
  @Cron('30 3 * * *', { name: 'cleanup-daily' })
  async runAll(): Promise<{
    notifications: number;
    sessions: number;
    incidents: number;
    jobs: number;
  }> {
    const [notifications, sessions, incidents, jobs] = await Promise.all([
      this.guard(() => this.archiveOldNotifications()),
      this.guard(() => this.deleteExpiredSessions()),
      this.guard(() => this.purgeOldResolvedIncidents()),
      this.guard(() => this.purgeOldTerminalJobs()),
    ]);
    this.logger.log(
      `[cleanup] daily sweep complete — notifications=${notifications} sessions=${sessions} incidents=${incidents} jobs=${jobs}`,
    );
    return { notifications, sessions, incidents, jobs };
  }

  // -------------------------------------------------------------------------
  // Individual sweepers
  // -------------------------------------------------------------------------

  async archiveOldNotifications(): Promise<number> {
    const days = this.numEnv('RETENTION_NOTIFICATION_DAYS', 90);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
    return this.boundedDelete('notification', { createdAt: { lt: cutoff } });
  }

  async deleteExpiredSessions(): Promise<number> {
    const days = this.numEnv('RETENTION_SESSION_DAYS', 30);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
    // ONLY revoked rows. Active sessions stay forever (or until the
    // user logs out / a SUPER_ADMIN revokes / the watermark evicts).
    return this.boundedDelete('session', {
      revokedAt: { not: null, lt: cutoff },
    });
  }

  async purgeOldResolvedIncidents(): Promise<number> {
    const days = this.numEnv('RETENTION_INCIDENT_DAYS', 60);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
    return this.boundedDelete('platformIncident', {
      status: 'RESOLVED',
      resolvedAt: { lt: cutoff },
    });
  }

  async purgeOldTerminalJobs(): Promise<number> {
    const days = this.numEnv('RETENTION_JOB_DAYS', 14);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
    return this.boundedDelete('job', {
      status: { in: ['SUCCEEDED', 'DEAD', 'FAILED_PERMANENT'] },
      completedAt: { lt: cutoff },
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private numEnv(key: string, fallback: number): number {
    const raw = this.config.get<string>(key) ?? process.env[key];
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /**
   * Per-table cleanup bounded at MAX_PER_TICK. Uses a candidate
   * SELECT to drive `deleteMany({ id: in })` so we never run an
   * unbounded delete (which could lock the table on big retention
   * sweeps after a long pause).
   */
  private async boundedDelete(
    model:
      | 'notification'
      | 'session'
      | 'platformIncident'
      | 'job',
    where: Record<string, unknown>,
  ): Promise<number> {
    // The Prisma client's per-model API is generic but its types
    // don't unify — we resolve the model proxy via a typed map.
    const proxy = this.modelProxy(model);
    const candidates = (await proxy.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: MAX_PER_TICK,
      select: { id: true },
    })) as Array<{ id: string }>;
    if (candidates.length === 0) return 0;
    const result = await proxy.deleteMany({
      where: { id: { in: candidates.map((c) => c.id) } },
    });
    return result.count;
  }

  private modelProxy(name: string): {
    findMany: (args: unknown) => Promise<unknown>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  } {
    // Cast through unknown — Prisma's runtime model accessors all
    // share this shape; the specific types differ. Tested at runtime
    // by the bounded-delete contract.
    return (this.prisma as unknown as Record<string, unknown>)[
      name
    ] as {
      findMany: (args: unknown) => Promise<unknown>;
      deleteMany: (args: unknown) => Promise<{ count: number }>;
    };
  }

  private async guard(fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (e) {
      this.logger.error(
        `[cleanup] sweeper failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 0;
    }
  }

  /**
   * Suppress the unused-cron warning in tests where the runner isn't
   * registered. The decorator references nothing at module init —
   * this is just a paranoid no-op so removal of CronExpression is
   * a safe refactor later.
   */
  static {
    void CronExpression;
  }
}

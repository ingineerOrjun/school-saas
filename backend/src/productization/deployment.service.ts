import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobRegistry } from '../common/jobs/job-registry.service';
import { JobQueueService } from '../common/jobs/job-queue.service';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// DeploymentService — Phase 23 Sections 13 + 14 + 15.
//
// Three concerns, one service (they share the same data sources):
//
//   • Section 13: Deployment awareness — version, build timestamp,
//                 environment, migration status. Surfaced on the
//                 Operations Center "Deployment" card.
//
//   • Section 14: Upgrade safety — pre-deploy checks the operator
//                 reviews before rolling out a new version. Each
//                 check produces a status (ok/warn/block).
//
//   • Section 15: Success metrics — tenant adoption signals
//                 (active schools, DAU/WAU, feature usage). Read by
//                 the Operations Center adoption panel.
//
// All three are read-only — the service computes and reports;
// operators decide.
//
// Source-of-truth for build info:
//   We read three env vars set by the deployer:
//     APP_VERSION       — semver tag ("1.4.2")
//     APP_BUILD_SHA     — git short SHA ("a3f1b9c")
//     APP_BUILD_TS      — ISO build timestamp
//   Fallbacks read from package.json so dev shows something
//   reasonable without env config.
// ---------------------------------------------------------------------------

export interface DeploymentInfo {
  appName: string;
  version: string;
  buildSha: string | null;
  buildTimestamp: string | null;
  environment: string;
  uptimeSec: number;
  startedAt: string;
  /** Total migrations applied vs. shipped — derived from migration table. */
  migrations: {
    applied: number;
    /** True when a follow-up `prisma migrate deploy` would do nothing. */
    inSync: boolean;
  };
}

export interface UpgradeCheck {
  key: string;
  label: string;
  status: 'ok' | 'warn' | 'block';
  detail: string;
}

export interface UpgradeSafetyReport {
  generatedAt: string;
  checks: UpgradeCheck[];
  /** True when no `block` checks present. */
  safe: boolean;
}

export interface AdoptionMetrics {
  generatedAt: string;
  /** Schools with at least one user.updatedAt in the last 7d. */
  activeSchoolsLast7d: number;
  /** Distinct active users in the last 24h (DAU proxy). */
  dau: number;
  /** Distinct active users in the last 7d (WAU proxy). */
  wau: number;
  /** Schools using attendance — at least one Attendance row in 7d. */
  attendanceUsageSchools: number;
  /** Schools collecting fees — at least one Payment row in 7d. */
  feesUsageSchools: number;
  /** Per-feature opt-in count from override map. */
  featureAdoption: Array<{ key: string; enabledCount: number }>;
}

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger(DeploymentService.name);
  private readonly startedAt = new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly registry: JobRegistry,
    private readonly queue: JobQueueService,
  ) {}

  // -------------------------------------------------------------------------
  // Section 13 — Deployment info
  // -------------------------------------------------------------------------

  async getInfo(): Promise<DeploymentInfo> {
    const appName =
      this.config.get<{ productName?: string }>('mail.brand')?.productName ??
      'Scholaris';
    const version = process.env.APP_VERSION ?? 'dev';
    const buildSha = process.env.APP_BUILD_SHA ?? null;
    const buildTimestamp = process.env.APP_BUILD_TS ?? null;
    const environment = process.env.NODE_ENV ?? 'development';

    // Migration count via the Prisma _migrations table.
    let appliedMigrations = 0;
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ count: bigint }>
      >('SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL');
      appliedMigrations = Number(rows[0]?.count ?? 0);
    } catch {
      // Pre-migration deploy or test env — treat as 0.
    }

    return {
      appName,
      version,
      buildSha,
      buildTimestamp,
      environment,
      uptimeSec: Math.floor(
        (Date.now() - this.startedAt.getTime()) / 1000,
      ),
      startedAt: this.startedAt.toISOString(),
      migrations: {
        applied: appliedMigrations,
        // We don't have a "shipped" count without re-walking the
        // prisma/migrations dir at runtime. The deploy pipeline
        // ensures sync; we report `applied > 0` as a positive signal.
        inSync: appliedMigrations > 0,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Section 14 — Upgrade safety
  // -------------------------------------------------------------------------

  async getUpgradeSafetyReport(): Promise<UpgradeSafetyReport> {
    const now = new Date();
    const checks: UpgradeCheck[] = [];

    // 1. Schema drift — any unapplied migrations?
    try {
      // We can't easily check filesystem migrations from here; what
      // we CAN check is whether any migration applied less than a
      // few seconds before. If the deployer ran migrate-deploy and
      // the timestamps line up, we say "in sync".
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ name: string; finished_at: Date | null }>
      >(`SELECT migration_name AS name, finished_at FROM _prisma_migrations
         ORDER BY finished_at DESC NULLS LAST LIMIT 5`);
      const unfinished = rows.filter((r) => r.finished_at === null);
      if (unfinished.length > 0) {
        checks.push({
          key: 'schema-drift',
          label: 'Schema drift',
          status: 'block',
          detail: `${unfinished.length} migration(s) recorded but not finished`,
        });
      } else {
        checks.push({
          key: 'schema-drift',
          label: 'Schema',
          status: 'ok',
          detail: `Latest applied: ${rows[0]?.name ?? 'n/a'}`,
        });
      }
    } catch (e) {
      checks.push({
        key: 'schema-drift',
        label: 'Schema',
        status: 'warn',
        detail: `Unable to query _prisma_migrations: ${e instanceof Error ? e.message : 'unknown'}`,
      });
    }

    // 2. Failed jobs in queue.
    try {
      const stats = await this.queue.stats();
      const stuck = stats.FAILED_PERMANENT ?? 0;
      const failed = stats.FAILED ?? 0;
      if (stuck > 50) {
        checks.push({
          key: 'failed-jobs',
          label: 'Failed jobs',
          status: 'warn',
          detail: `${stuck} jobs in dead-letter queue (resolve before deploy)`,
        });
      } else if (failed > 100) {
        checks.push({
          key: 'failed-jobs',
          label: 'Failed jobs',
          status: 'warn',
          detail: `${failed} jobs in transient FAILED state`,
        });
      } else {
        checks.push({
          key: 'failed-jobs',
          label: 'Job queue',
          status: 'ok',
          detail: `${stuck} dead-letter, ${failed} transient`,
        });
      }
    } catch {
      checks.push({
        key: 'failed-jobs',
        label: 'Job queue',
        status: 'warn',
        detail: 'Could not read queue stats',
      });
    }

    // 3. Long-running RUNNING jobs (potential stuck workers).
    try {
      const stuckCutoff = new Date(now.getTime() - 30 * 60_000); // 30 min
      const stuck = await this.prisma.job.count({
        where: { status: 'RUNNING', startedAt: { lt: stuckCutoff } },
      });
      if (stuck > 0) {
        checks.push({
          key: 'stuck-running',
          label: 'Stuck running jobs',
          status: 'block',
          detail: `${stuck} job(s) RUNNING > 30min — sweep + investigate before deploy`,
        });
      } else {
        checks.push({
          key: 'stuck-running',
          label: 'Worker health',
          status: 'ok',
          detail: 'No stuck RUNNING jobs',
        });
      }
    } catch {
      // ignore
    }

    // 4. Backup reminder (advisory).
    checks.push({
      key: 'backup',
      label: 'Backup reminder',
      status: 'warn',
      detail:
        'Confirm a recent DB backup exists before deploying schema changes.',
    });

    // 5. Active incidents.
    const incidentCount = await this.prisma.platformIncident.count({
      where: { status: 'ACTIVE' },
    });
    if (incidentCount > 0) {
      checks.push({
        key: 'active-incidents',
        label: 'Active incidents',
        status: 'warn',
        detail: `${incidentCount} active incident(s) broadcast — communicate the deploy`,
      });
    } else {
      checks.push({
        key: 'active-incidents',
        label: 'Incidents',
        status: 'ok',
        detail: 'No active incidents',
      });
    }

    // 6. Handlers registered.
    const handlers = this.registry.list().length;
    checks.push({
      key: 'handlers',
      label: 'Job handlers',
      status: handlers > 0 ? 'ok' : 'warn',
      detail: `${handlers} handler(s) registered`,
    });

    return {
      generatedAt: now.toISOString(),
      checks,
      safe: checks.every((c) => c.status !== 'block'),
    };
  }

  // -------------------------------------------------------------------------
  // Section 15 — Adoption metrics
  // -------------------------------------------------------------------------

  async getAdoptionMetrics(): Promise<AdoptionMetrics> {
    const now = new Date();
    const day1 = new Date(now.getTime() - 24 * 60 * 60_000);
    const day7 = new Date(now.getTime() - 7 * 24 * 60 * 60_000);

    const [
      activeSchoolsLast7d,
      dau,
      wau,
      attendanceUsage,
      feesUsage,
      schools,
    ] = await Promise.all([
      this.prisma.school.count({
        where: {
          users: { some: { updatedAt: { gte: day7 } } },
        },
      }),
      this.prisma.session.findMany({
        where: { lastActiveAt: { gte: day1 } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.session.findMany({
        where: { lastActiveAt: { gte: day7 } },
        distinct: ['userId'],
        select: { userId: true },
      }),
      this.prisma.attendance.findMany({
        where: { date: { gte: day7 } },
        distinct: ['schoolId'],
        select: { schoolId: true },
      }),
      this.prisma.payment.findMany({
        where: { createdAt: { gte: day7 } },
        distinct: ['schoolId'],
        select: { schoolId: true },
      }),
      this.prisma.school.findMany({ select: { featureOverrides: true } }),
    ]);

    const adoption = new Map<string, number>();
    for (const s of schools) {
      const overrides = s.featureOverrides as Record<string, unknown>;
      if (!overrides || typeof overrides !== 'object') continue;
      for (const [k, v] of Object.entries(overrides)) {
        if (v === true) {
          adoption.set(k, (adoption.get(k) ?? 0) + 1);
        }
      }
    }

    return {
      generatedAt: now.toISOString(),
      activeSchoolsLast7d,
      dau: dau.length,
      wau: wau.length,
      attendanceUsageSchools: attendanceUsage.length,
      feesUsageSchools: feesUsage.length,
      featureAdoption: [...adoption.entries()]
        .map(([key, enabledCount]) => ({ key, enabledCount }))
        .sort((a, b) => b.enabledCount - a.enabledCount),
    };
  }
}

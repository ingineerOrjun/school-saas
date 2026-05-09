import { Injectable } from '@nestjs/common';
import { JobStatus, SchoolStatus, SubscriptionPlan } from '@prisma/client';
import { JobQueueService } from '../common/jobs/job-queue.service';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// PlatformAnalyticsService — Phase 16.
//
// Cross-cutting platform metrics that operators read on the
// `/platform/operations` cockpit + (eventually) the analytics
// expansion sections of `/platform`.
//
// Four buckets:
//
//   1. Revenue   — MRR / ARR / active-subscription count + plan
//                  distribution. MRR is derived from a code-level
//                  price-per-plan map (PLAN_MONTHLY_PRICE_NPR below)
//                  because the Subscription model doesn't yet
//                  carry a price column. When a real billing
//                  integration lands, the constants come out and a
//                  `priceMonthly` column on `school_subscriptions`
//                  takes over — same service interface.
//
//   2. Growth    — schools-by-month for the last 12 months. Raw
//                  count, no smoothing. The series-shape mirrors
//                  the existing `/platform/overview` schoolGrowthTrend
//                  so the frontend can render with the same Sparkline.
//
//   3. System    — queue depth + failed jobs + notification volume.
//                  Aggregated from the `jobs` + `notifications`
//                  tables.
//
//   4. Risk      — schools that need operator attention: expiring
//                  soon, suspended, expired, or inactive (no
//                  user.updatedAt activity in 30 days as a proxy
//                  for login activity since we don't track sessions
//                  yet).
//
// Why ONE service (not four):
//   The analytics page + the ops dashboard each consume a SUBSET of
//   these buckets, and many calls share row scans (e.g. counting
//   schools by status feeds both Revenue's "active-sub count" and
//   Risk's "suspended count"). Co-locating them keeps the scan
//   logic DRY. Public API exposes per-bucket methods so callers
//   pull only what they need.
// ---------------------------------------------------------------------------

/**
 * Plan price per month, in NPR. Hard-coded for v1 because the
 * `school_subscriptions` table doesn't carry a `priceMonthly`
 * column yet — adding one is a future migration tied to a real
 * billing integration. Numbers picked as plausible Nepal-market
 * SaaS tiers; adjust when the platform owner sets actual pricing.
 *
 * TRIAL = 0 because trials are unpriced.
 * UNLIMITED is a one-shot lifetime license; it doesn't contribute
 * to monthly recurring revenue, so it's also 0 here.
 */
const PLAN_MONTHLY_PRICE_NPR: Record<SubscriptionPlan, number> = {
  TRIAL: 0,
  MONTHLY: 5_000,
  YEARLY: 4_000, // monthly equivalent of 48,000 NPR / year (20% off)
  UNLIMITED: 0,
};

export interface RevenueAnalytics {
  /** Monthly recurring revenue (sum of monthly-equivalent prices). */
  mrrNpr: number;
  /** Annual recurring revenue = MRR × 12. */
  arrNpr: number;
  /** Number of schools with a current subscription (excludes TRIAL). */
  activePaidSubscriptions: number;
  /** Number of schools currently on TRIAL. */
  activeTrials: number;
  /** Plan distribution across all schools' CURRENT subscription. */
  planDistribution: Array<{ plan: SubscriptionPlan; count: number }>;
}

export interface GrowthAnalytics {
  /** Schools created in the last 30 days. */
  newSchools30d: number;
  /** Schools created in the prior 30-day window (for comparison). */
  newSchoolsPrior30d: number;
  /** Last 12 months — schools-per-month, oldest first. */
  schoolsPerMonth: Array<{ month: string; count: number }>;
  /** Feature adoption — what fraction of schools have each flag on. */
  featureAdoption: Array<{ key: string; enabledCount: number; ratio: number }>;
}

export interface SystemAnalytics {
  jobQueue: Record<JobStatus, number>;
  /** Jobs that failed within the last 24h. Operator's "what's broken?" list. */
  recentFailedJobs: Array<{
    id: string;
    name: string;
    attempts: number;
    lastError: string | null;
    completedAt: string;
  }>;
  /** Notifications produced in the last 24h, by severity. */
  notifications24h: {
    total: number;
    bySeverity: Array<{ severity: string; count: number }>;
    failedDeliveries: number;
  };
}

export interface RiskAnalytics {
  /** Currently SUSPENDED tenants. */
  suspendedSchools: number;
  /** Currently EXPIRED tenants. */
  expiredSchools: number;
  /** Schools whose plan ends in the next 14 days (and aren't suspended). */
  expiringSoon: number;
  /**
   * Schools with no user activity (max users.updatedAt) in 30+ days.
   * Proxy for "logged-in users" — when we add a per-session table,
   * this metric can switch over without changing the contract.
   */
  inactiveSchools: number;
}

export interface PlatformAnalyticsPayload {
  generatedAt: string;
  revenue: RevenueAnalytics;
  growth: GrowthAnalytics;
  system: SystemAnalytics;
  risk: RiskAnalytics;
}

@Injectable()
export class PlatformAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
  ) {}

  /**
   * Single-call payload for the ops dashboard. Each section runs
   * in parallel; total wall-clock time is bounded by the slowest
   * (typically the 12-month growth scan).
   */
  async getAll(): Promise<PlatformAnalyticsPayload> {
    const [revenue, growth, system, risk] = await Promise.all([
      this.getRevenue(),
      this.getGrowth(),
      this.getSystem(),
      this.getRisk(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      revenue,
      growth,
      system,
      risk,
    };
  }

  // -------------------------------------------------------------------------
  // Revenue
  // -------------------------------------------------------------------------

  async getRevenue(): Promise<RevenueAnalytics> {
    const now = new Date();

    // Pull every CURRENT subscription. Definition: most recent
    // subscription per school where endDate is in the future or null.
    // Done in JS (vs window function) because we already have an
    // index on (schoolId, createdAt DESC) and the row count is
    // bounded by school count.
    const allSubs = await this.prisma.schoolSubscription.findMany({
      orderBy: [{ schoolId: 'asc' }, { createdAt: 'desc' }],
      select: {
        schoolId: true,
        plan: true,
        endDate: true,
      },
    });

    const seen = new Set<string>();
    const current: Array<{ plan: SubscriptionPlan; endDate: Date | null }> = [];
    for (const s of allSubs) {
      if (seen.has(s.schoolId)) continue;
      seen.add(s.schoolId);
      // "Current" = endDate in future OR null (UNLIMITED).
      if (!s.endDate || s.endDate > now) {
        current.push({ plan: s.plan, endDate: s.endDate });
      }
    }

    let mrr = 0;
    let activePaid = 0;
    let activeTrials = 0;
    const dist = new Map<SubscriptionPlan, number>();
    for (const c of current) {
      dist.set(c.plan, (dist.get(c.plan) ?? 0) + 1);
      if (c.plan === 'TRIAL') {
        activeTrials += 1;
      } else {
        activePaid += 1;
        mrr += PLAN_MONTHLY_PRICE_NPR[c.plan];
      }
    }

    return {
      mrrNpr: mrr,
      arrNpr: mrr * 12,
      activePaidSubscriptions: activePaid,
      activeTrials,
      planDistribution: [...dist.entries()]
        .map(([plan, count]) => ({ plan, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  // -------------------------------------------------------------------------
  // Growth
  // -------------------------------------------------------------------------

  async getGrowth(): Promise<GrowthAnalytics> {
    const now = new Date();
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const day60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [new30, newPrior30, schoolsForGrowth, allSchools] = await Promise.all([
      this.prisma.school.count({ where: { createdAt: { gte: day30 } } }),
      this.prisma.school.count({
        where: { createdAt: { gte: day60, lt: day30 } },
      }),
      this.prisma.school.findMany({ select: { createdAt: true } }),
      // For feature-adoption ratios: read overrides + merge against
      // each school's most-recent subscription enabledFeatures map.
      // We only need the OVERRIDE column today since the ops
      // dashboard's interest is "what's the operator-tier opt-in
      // rate per feature." Subscription-level enables can be
      // layered in later if the metric is needed.
      this.prisma.school.findMany({
        select: { id: true, featureOverrides: true },
      }),
    ]);

    // 12-month bucket of school creations.
    const monthBuckets = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCMonth(d.getUTCMonth() - i);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthBuckets.set(key, 0);
    }
    for (const s of schoolsForGrowth) {
      const key = `${s.createdAt.getUTCFullYear()}-${String(s.createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
      if (monthBuckets.has(key)) {
        monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + 1);
      }
    }

    // Feature adoption.
    const adoption = new Map<string, number>();
    for (const sch of allSchools) {
      const overrides = sanitizeFlagMap(sch.featureOverrides);
      for (const [k, v] of Object.entries(overrides)) {
        if (v) adoption.set(k, (adoption.get(k) ?? 0) + 1);
      }
    }
    const total = allSchools.length;
    const featureAdoption = [...adoption.entries()]
      .map(([key, enabledCount]) => ({
        key,
        enabledCount,
        ratio: total > 0 ? enabledCount / total : 0,
      }))
      .sort((a, b) => b.enabledCount - a.enabledCount);

    return {
      newSchools30d: new30,
      newSchoolsPrior30d: newPrior30,
      schoolsPerMonth: [...monthBuckets.entries()].map(([month, count]) => ({
        month,
        count,
      })),
      featureAdoption,
    };
  }

  // -------------------------------------------------------------------------
  // System
  // -------------------------------------------------------------------------

  async getSystem(): Promise<SystemAnalytics> {
    const day1Ago = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [queueStats, failedJobs, notifAgg, failedDeliveriesCount] =
      await Promise.all([
        this.queue.stats(),
        this.prisma.job.findMany({
          where: { status: 'FAILED', completedAt: { gte: day1Ago } },
          orderBy: { completedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            name: true,
            attempts: true,
            lastError: true,
            completedAt: true,
          },
        }),
        this.prisma.notification.groupBy({
          by: ['severity'],
          where: { createdAt: { gte: day1Ago } },
          _count: { _all: true },
        }),
        this.prisma.notificationDelivery.count({
          where: {
            status: 'FAILED',
            createdAt: { gte: day1Ago },
          },
        }),
      ]);

    const total = notifAgg.reduce((s, g) => s + g._count._all, 0);

    return {
      jobQueue: queueStats,
      recentFailedJobs: failedJobs.map((j) => ({
        id: j.id,
        name: j.name,
        attempts: j.attempts,
        lastError: j.lastError,
        completedAt: j.completedAt!.toISOString(),
      })),
      notifications24h: {
        total,
        bySeverity: notifAgg
          .map((g) => ({
            severity: g.severity as string,
            count: g._count._all,
          }))
          .sort((a, b) => b.count - a.count),
        failedDeliveries: failedDeliveriesCount,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Risk
  // -------------------------------------------------------------------------

  async getRisk(): Promise<RiskAnalytics> {
    const now = new Date();
    const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const day14Ahead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [statusCounts, expiringSoon, inactiveCount] = await Promise.all([
      this.prisma.school.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      // Schools with expiresAt in the next 14 days, NOT already
      // suspended. Suspended schools are already "lost" from a
      // renewal perspective; expiring-soon is the operator's
      // "chase this for renewal" list.
      this.prisma.school.count({
        where: {
          status: { in: ['ACTIVE', 'TRIAL'] },
          expiresAt: { gte: now, lte: day14Ahead },
        },
      }),
      // Inactive: no user.updatedAt activity in the last 30 days.
      // We don't track per-session logins; updatedAt bumps on every
      // domain write a user does. This is a permissive proxy —
      // tightens once a real "lastSeenAt" lands.
      this.prisma.school.count({
        where: {
          status: { in: ['ACTIVE', 'TRIAL'] },
          users: {
            // Every user at the school is below the cutoff.
            // Using `every` instead of `none + max(updatedAt)` so
            // Prisma can express it without a raw query.
            every: { updatedAt: { lt: day30Ago } },
          },
        },
      }),
    ]);

    const statusCount = (s: SchoolStatus): number =>
      statusCounts.find((g) => g.status === s)?._count._all ?? 0;

    return {
      suspendedSchools: statusCount('SUSPENDED'),
      expiredSchools: statusCount('EXPIRED'),
      expiringSoon,
      inactiveSchools: inactiveCount,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Drop non-string keys + non-boolean values from a stored JSON
 * override map. Mirrors FeatureFlagsService — keep tolerant of
 * legacy / typo data so the metric stays correct.
 */
function sanitizeFlagMap(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

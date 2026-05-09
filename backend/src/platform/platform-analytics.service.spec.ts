import { SubscriptionPlan } from '@prisma/client';
import { PlatformAnalyticsService } from './platform-analytics.service';
import type { PrismaService } from '../database/prisma.service';
import type { JobQueueService } from '../common/jobs/job-queue.service';

// ---------------------------------------------------------------------------
// PlatformAnalyticsService — Phase 16 tests.
//
// The two interesting branches are:
//   1. Revenue.MRR — picks the most-recent CURRENT subscription per
//      school, multiplies by the price-per-plan map, ignores TRIAL +
//      UNLIMITED. Operator-visible numbers; correctness here drives
//      decisions.
//   2. Risk — counts must be derived from the right tables (statuses
//      from `schools.status`, not from subscription expiry).
//
// Growth + System are mostly Prisma plumbing; the meaningful logic
// they have (12-month bucketing, queue stat shape) is already covered
// by the platform overview tests + JobQueueService unit tests.
// Adding redundant tests here would just bloat the suite.
// ---------------------------------------------------------------------------

interface SubRow {
  schoolId: string;
  plan: SubscriptionPlan;
  endDate: Date | null;
  createdAt: Date;
}

function buildHarness(input: {
  subscriptions: SubRow[];
  schools?: Array<{
    createdAt: Date;
    status?: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'EXPIRED';
  }>;
  groupedSchoolStatusCounts?: Record<string, number>;
  expiringSoon?: number;
  inactive?: number;
  jobStats?: Record<string, number>;
}) {
  const prisma = {
    schoolSubscription: {
      findMany: jest.fn(async () => input.subscriptions),
    },
    school: {
      count: jest.fn(async (args: any) => {
        // Discriminate by where-clause shape.
        if (args?.where?.expiresAt) return input.expiringSoon ?? 0;
        if (args?.where?.users) return input.inactive ?? 0;
        if (args?.where?.createdAt) return 0;
        return 0;
      }),
      findMany: jest.fn(async () => input.schools ?? []),
      groupBy: jest.fn(async () => {
        const counts = input.groupedSchoolStatusCounts ?? {};
        return Object.entries(counts).map(([status, count]) => ({
          status,
          _count: { _all: count },
        }));
      }),
    },
    notification: {
      groupBy: jest.fn(async () => []),
    },
    notificationDelivery: {
      count: jest.fn(async () => 0),
    },
    job: {
      findMany: jest.fn(async () => []),
    },
  } as unknown as PrismaService;

  const queue = {
    stats: jest.fn(async () => input.jobStats ?? {
      PENDING: 0,
      SCHEDULED: 0,
      RUNNING: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      DEAD: 0,
    }),
  } as unknown as JobQueueService;

  return new PlatformAnalyticsService(prisma, queue);
}

const FAR_FUTURE = new Date('2099-01-01');
const PAST = new Date('2000-01-01');

describe('PlatformAnalyticsService.getRevenue', () => {
  it('returns zero MRR when there are no subscriptions', async () => {
    const svc = buildHarness({ subscriptions: [] });
    const r = await svc.getRevenue();
    expect(r.mrrNpr).toBe(0);
    expect(r.arrNpr).toBe(0);
    expect(r.activePaidSubscriptions).toBe(0);
    expect(r.activeTrials).toBe(0);
  });

  it('multiplies plan price × count for paid plans', async () => {
    // 2 MONTHLY @ 5,000 + 1 YEARLY @ 4,000 = 14,000 MRR.
    const svc = buildHarness({
      subscriptions: [
        { schoolId: 's1', plan: 'MONTHLY', endDate: FAR_FUTURE, createdAt: new Date() },
        { schoolId: 's2', plan: 'MONTHLY', endDate: FAR_FUTURE, createdAt: new Date() },
        { schoolId: 's3', plan: 'YEARLY', endDate: FAR_FUTURE, createdAt: new Date() },
      ],
    });
    const r = await svc.getRevenue();
    expect(r.mrrNpr).toBe(14_000);
    expect(r.arrNpr).toBe(14_000 * 12);
    expect(r.activePaidSubscriptions).toBe(3);
  });

  it('TRIAL + UNLIMITED contribute 0 to MRR but are counted separately', async () => {
    const svc = buildHarness({
      subscriptions: [
        { schoolId: 's1', plan: 'TRIAL', endDate: FAR_FUTURE, createdAt: new Date() },
        { schoolId: 's2', plan: 'TRIAL', endDate: FAR_FUTURE, createdAt: new Date() },
        { schoolId: 's3', plan: 'UNLIMITED', endDate: null, createdAt: new Date() },
        { schoolId: 's4', plan: 'MONTHLY', endDate: FAR_FUTURE, createdAt: new Date() },
      ],
    });
    const r = await svc.getRevenue();
    expect(r.mrrNpr).toBe(5_000); // only the MONTHLY counts
    expect(r.activeTrials).toBe(2);
    expect(r.activePaidSubscriptions).toBe(2); // UNLIMITED is paid (not trial), even though MRR=0
  });

  it('skips EXPIRED subscriptions (endDate in the past)', async () => {
    const svc = buildHarness({
      subscriptions: [
        // School 1 had MONTHLY but it expired.
        { schoolId: 's1', plan: 'MONTHLY', endDate: PAST, createdAt: new Date() },
        // School 2 has a current MONTHLY.
        { schoolId: 's2', plan: 'MONTHLY', endDate: FAR_FUTURE, createdAt: new Date() },
      ],
    });
    const r = await svc.getRevenue();
    expect(r.mrrNpr).toBe(5_000);
    expect(r.activePaidSubscriptions).toBe(1);
  });

  it('uses ONLY the most-recent subscription per school', async () => {
    // School 1 had a MONTHLY then upgraded to YEARLY. Only YEARLY
    // should count — the older row is appended-only history, not
    // active state.
    const svc = buildHarness({
      subscriptions: [
        // findMany ordering: schoolId asc, createdAt desc — so the
        // newer YEARLY comes first for s1.
        {
          schoolId: 's1',
          plan: 'YEARLY',
          endDate: FAR_FUTURE,
          createdAt: new Date('2025-06-01'),
        },
        {
          schoolId: 's1',
          plan: 'MONTHLY',
          endDate: FAR_FUTURE,
          createdAt: new Date('2025-01-01'),
        },
      ],
    });
    const r = await svc.getRevenue();
    expect(r.mrrNpr).toBe(4_000); // YEARLY price, not MONTHLY
    expect(r.activePaidSubscriptions).toBe(1);
    expect(r.planDistribution).toEqual([{ plan: 'YEARLY', count: 1 }]);
  });
});

describe('PlatformAnalyticsService.getRisk', () => {
  it('returns zero counts when no schools exist', async () => {
    const svc = buildHarness({ subscriptions: [] });
    const r = await svc.getRisk();
    expect(r.suspendedSchools).toBe(0);
    expect(r.expiredSchools).toBe(0);
    expect(r.expiringSoon).toBe(0);
    expect(r.inactiveSchools).toBe(0);
  });

  it('reads SUSPENDED + EXPIRED counts from the schools.status group-by', async () => {
    const svc = buildHarness({
      subscriptions: [],
      groupedSchoolStatusCounts: {
        ACTIVE: 10,
        SUSPENDED: 3,
        EXPIRED: 2,
        TRIAL: 1,
      },
      expiringSoon: 4,
      inactive: 5,
    });
    const r = await svc.getRisk();
    expect(r.suspendedSchools).toBe(3);
    expect(r.expiredSchools).toBe(2);
    expect(r.expiringSoon).toBe(4);
    expect(r.inactiveSchools).toBe(5);
  });
});

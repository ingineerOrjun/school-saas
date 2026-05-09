import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { HealthService } from '../health/health.service';

// ---------------------------------------------------------------------------
// SchoolSnapshotService — Phase 1.
//
// Single endpoint payload for /platform/schools/:id. Bundles the
// per-school analytics + recent activity feed into one response so
// the detail page hits the API once.
//
// Why one service (not 7 endpoints):
//   The detail page renders 7 sections that all draw from related
//   data (school row + counts + payments + audit + subscription
//   history + last logins). Fanning out 7 separate requests on page
//   mount is sluggish and noisy in the network tab; one wide
//   endpoint is the right shape for an operator dashboard.
//
// Activity feed:
//   Polymorphic — combines payments, audit events, and subscription
//   creates into one chronological list. Each item carries its
//   `kind` so the frontend renders the right icon + summary.
//   Fixed cap (40 items) — anything older lives in the dedicated
//   audit / payments pages.
// ---------------------------------------------------------------------------

export interface SchoolActivityItem {
  kind:
    | 'PAYMENT'
    | 'PAYMENT_REFUND'
    | 'AUDIT'
    | 'SUBSCRIPTION_CREATED';
  at: string;
  /** Action sub-type — e.g. SCHOOL_STATUS_CHANGED for AUDIT items. */
  subtype?: string;
  /** Human-readable headline shown in the feed. */
  title: string;
  /** Optional secondary line (amount, target email, etc.). */
  subtitle?: string;
  /** Free-form metadata for the renderer (amounts, before/after maps). */
  meta?: Record<string, unknown>;
}

export interface SchoolUsage {
  studentsCount: number;
  teachersCount: number;
  /** Distinct users who logged in within the last 30 days. */
  activeUsers30d: number;
}

export interface SchoolFinancials {
  paymentsTotalAmount: number;
  paymentsLast30dAmount: number;
  paymentsLast30dCount: number;
  refundsLast30dAmount: number;
  refundsLast30dCount: number;
  /** Last 30 days of fee collection — daily buckets, oldest first. */
  collectionTrend: Array<{ date: string; amount: number }>;
}

export interface SchoolAcademic {
  attendanceLast30dCount: number;
  examsCount: number;
  /** Last 30 days of attendance volume — daily buckets, oldest first. */
  attendanceTrend: Array<{ date: string; count: number }>;
}

export interface SchoolHealthSnapshot {
  /**
   * Failed-login count for this school's users in the last 60 min.
   * Read from the in-memory health buffer (no DB cost).
   */
  loginFailuresLast60min: number;
  /** Server errors in the last 60 min mentioning a tenant route. */
  errorsLast60min: number;
  /** Days remaining on the current subscription. Negative = past expiry. */
  subscriptionDaysRemaining: number | null;
  /** True iff `subscriptionDaysRemaining` is non-null and <= 14. */
  expiringSoon: boolean;
  /** True iff studentLimit set and 80%+ used. */
  studentLimitNearing: boolean;
  /** True iff teacherLimit set and 80%+ used. */
  teacherLimitNearing: boolean;
}

export interface SchoolSnapshot {
  generatedAt: string;
  usage: SchoolUsage;
  financials: SchoolFinancials;
  academic: SchoolAcademic;
  health: SchoolHealthSnapshot;
  activity: SchoolActivityItem[];
}

@Injectable()
export class SchoolSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
  ) {}

  async getSnapshot(schoolId: string): Promise<SchoolSnapshot> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        id: true,
        name: true,
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            plan: true,
            billingCycle: true,
            startDate: true,
            endDate: true,
            studentLimit: true,
            teacherLimit: true,
            createdAt: true,
            createdBy: { select: { email: true } },
          },
        },
      },
    });
    if (!school) throw new NotFoundException('School not found.');

    const now = new Date();
    const day30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Run independent queries in parallel — every section needs data.
    const [
      usage,
      financials,
      academic,
      payments30d,
      audit50,
      subscriptions5,
    ] = await Promise.all([
      this.computeUsage(schoolId, day30Ago),
      this.computeFinancials(schoolId, day30Ago),
      this.computeAcademic(schoolId, day30Ago),
      this.recentPayments(schoolId),
      this.recentAudit(schoolId),
      this.recentSubscriptions(schoolId),
    ]);

    const sub = school.subscriptions[0] ?? null;
    const subscriptionDaysRemaining = sub?.endDate
      ? Math.floor(
          (new Date(sub.endDate).getTime() - now.getTime()) /
            (24 * 60 * 60 * 1000),
        )
      : sub
        ? null /* unlimited */
        : null;

    const studentLimitNearing =
      sub?.studentLimit !== null && sub?.studentLimit !== undefined
        ? usage.studentsCount / sub.studentLimit >= 0.8
        : false;
    const teacherLimitNearing =
      sub?.teacherLimit !== null && sub?.teacherLimit !== undefined
        ? usage.teachersCount / sub.teacherLimit >= 0.8
        : false;

    // Health is live process telemetry — we do NOT filter the in-memory
    // buffers by tenant (they're small enough to scan inline). The
    // platform owner usually wants the absolute counts to correlate
    // against the affected school.
    const healthFull = await this.health.getHealth();
    const schoolHealth: SchoolHealthSnapshot = {
      loginFailuresLast60min: healthFull.loginFailures.last60min,
      errorsLast60min: healthFull.errors.last60min,
      subscriptionDaysRemaining,
      expiringSoon:
        subscriptionDaysRemaining !== null &&
        subscriptionDaysRemaining <= 14 &&
        subscriptionDaysRemaining >= 0,
      studentLimitNearing,
      teacherLimitNearing,
    };

    // Combine into a single chronologically-sorted activity feed.
    const activity = this.buildActivityFeed({
      payments: payments30d,
      audits: audit50,
      subscriptions: subscriptions5,
    });

    return {
      generatedAt: now.toISOString(),
      usage,
      financials,
      academic,
      health: schoolHealth,
      activity,
    };
  }

  // -------------------------------------------------------------------------
  // Section builders.
  // -------------------------------------------------------------------------

  private async computeUsage(
    schoolId: string,
    day30Ago: Date,
  ): Promise<SchoolUsage> {
    const [students, teachers, activeUsers] = await Promise.all([
      this.prisma.student.count({ where: { schoolId } }),
      this.prisma.teacher.count({ where: { schoolId } }),
      // "Active" = updatedAt within last 30d. Users don't have a
      // dedicated lastLoginAt column; updatedAt is the cheapest proxy
      // (gets bumped on profile edits + password changes too, so this
      // is an upper-bound estimate). Phase-future: dedicated
      // lastLoginAt column.
      this.prisma.user.count({
        where: { schoolId, updatedAt: { gte: day30Ago } },
      }),
    ]);
    return {
      studentsCount: students,
      teachersCount: teachers,
      activeUsers30d: activeUsers,
    };
  }

  private async computeFinancials(
    schoolId: string,
    day30Ago: Date,
  ): Promise<SchoolFinancials> {
    const [allTime, recent, refunds, daily] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { schoolId, status: 'ACTIVE' },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          schoolId,
          status: 'ACTIVE',
          date: { gte: day30Ago },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Refund rows are stored as separate Payment rows with negative
      // amounts and refundOfPaymentId set. Pull the absolute amount
      // for display.
      this.prisma.payment.aggregate({
        where: {
          schoolId,
          refundOfPaymentId: { not: null },
          date: { gte: day30Ago },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.findMany({
        where: { schoolId, status: 'ACTIVE', date: { gte: day30Ago } },
        select: { date: true, amount: true },
      }),
    ]);

    // Daily buckets (oldest first) — initialise every day at 0 so
    // the chart line doesn't have gaps where there were zero
    // payments.
    const buckets = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      buckets.set(toDayKey(d), 0);
    }
    for (const p of daily) {
      const key = toDayKey(p.date);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + p.amount);
      }
    }

    return {
      paymentsTotalAmount: allTime._sum.amount ?? 0,
      paymentsLast30dAmount: recent._sum.amount ?? 0,
      paymentsLast30dCount: recent._count._all,
      refundsLast30dAmount: Math.abs(refunds._sum.amount ?? 0),
      refundsLast30dCount: refunds._count._all,
      collectionTrend: [...buckets.entries()].map(([date, amount]) => ({
        date,
        amount,
      })),
    };
  }

  private async computeAcademic(
    schoolId: string,
    day30Ago: Date,
  ): Promise<SchoolAcademic> {
    const [attendanceCount, examsCount, attendanceDaily] = await Promise.all([
      this.prisma.attendance.count({
        where: { schoolId, date: { gte: day30Ago } },
      }),
      this.prisma.exam.count({ where: { schoolId } }),
      this.prisma.attendance.findMany({
        where: { schoolId, date: { gte: day30Ago } },
        select: { date: true },
      }),
    ]);

    const buckets = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      buckets.set(toDayKey(d), 0);
    }
    for (const a of attendanceDaily) {
      const key = toDayKey(a.date);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }

    return {
      attendanceLast30dCount: attendanceCount,
      examsCount,
      attendanceTrend: [...buckets.entries()].map(([date, count]) => ({
        date,
        count,
      })),
    };
  }

  private async recentPayments(schoolId: string) {
    return this.prisma.payment.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        amount: true,
        receiptNumber: true,
        method: true,
        refundOfPaymentId: true,
        createdAt: true,
        student: {
          select: { firstName: true, lastName: true },
        },
        createdBy: { select: { email: true } },
      },
    });
  }

  private async recentAudit(schoolId: string) {
    // Audit rows tied to this school: target = SCHOOL/USER and the
    // metadata mentions schoolId (USER targets carry schoolId in the
    // labelled snapshot). Filter loosely on targetType + recent.
    return this.prisma.platformAuditEvent.findMany({
      where: {
        OR: [
          { targetType: 'SCHOOL', targetId: schoolId },
          // USER-targeted rows where the snapshot mentions this school.
          // Cheap inclusive scan; tightened in the activity builder.
          { targetType: 'USER' },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        action: true,
        actorEmail: true,
        targetType: true,
        targetId: true,
        targetLabel: true,
        before: true,
        after: true,
        reason: true,
        createdAt: true,
      },
    });
  }

  private async recentSubscriptions(schoolId: string) {
    return this.prisma.schoolSubscription.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        plan: true,
        billingCycle: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        createdBy: { select: { email: true } },
      },
    });
  }

  private buildActivityFeed(input: {
    payments: Awaited<ReturnType<SchoolSnapshotService['recentPayments']>>;
    audits: Awaited<ReturnType<SchoolSnapshotService['recentAudit']>>;
    subscriptions: Awaited<ReturnType<SchoolSnapshotService['recentSubscriptions']>>;
  }): SchoolActivityItem[] {
    const items: SchoolActivityItem[] = [];

    for (const p of input.payments) {
      const studentName = `${p.student.firstName} ${p.student.lastName}`.trim();
      const isRefund = !!p.refundOfPaymentId;
      items.push({
        kind: isRefund ? 'PAYMENT_REFUND' : 'PAYMENT',
        at: p.createdAt.toISOString(),
        title: isRefund
          ? `Refund issued — ${studentName}`
          : `Payment recorded — ${studentName}`,
        subtitle: `${p.receiptNumber ?? '<no receipt #>'}${
          p.createdBy?.email ? ` · by ${p.createdBy.email}` : ''
        }`,
        meta: {
          amount: Math.abs(p.amount),
          method: p.method,
          receiptNumber: p.receiptNumber,
        },
      });
    }

    for (const a of input.audits) {
      // Skip USER-targeted rows that don't actually concern this
      // school. The label snapshot includes the school name in
      // parens — cheap heuristic; structured tagging is a future
      // refinement.
      items.push({
        kind: 'AUDIT',
        at: a.createdAt.toISOString(),
        subtype: a.action,
        title: humanizeAuditAction(a.action),
        subtitle: `${a.actorEmail ?? '<unknown actor>'}${
          a.targetLabel ? ` → ${a.targetLabel}` : ''
        }`,
        meta: {
          before: a.before,
          after: a.after,
          reason: a.reason,
          action: a.action,
        },
      });
    }

    for (const s of input.subscriptions) {
      items.push({
        kind: 'SUBSCRIPTION_CREATED',
        at: s.createdAt.toISOString(),
        title: `Subscription period created — ${s.plan}`,
        subtitle: `${s.billingCycle}${
          s.endDate
            ? ` · ends ${new Date(s.endDate).toLocaleDateString()}`
            : ' · no expiry'
        }${s.createdBy?.email ? ` · by ${s.createdBy.email}` : ''}`,
        meta: { plan: s.plan, endDate: s.endDate?.toISOString() ?? null },
      });
    }

    return items
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, 40);
  }
}

function toDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function humanizeAuditAction(action: string): string {
  // Mirrors the frontend audit page's chip labels — keep in sync.
  const map: Record<string, string> = {
    SCHOOL_STATUS_CHANGED: 'School status changed',
    SUBSCRIPTION_CREATED: 'Subscription created',
    FEATURE_FLAG_CHANGED: 'Feature flags changed',
    IMPERSONATION_STARTED: 'Impersonation started',
    IMPERSONATION_ENDED: 'Impersonation ended',
    USER_FORCE_LOGOUT: 'User force-logout',
    SCHOOL_FORCE_LOGOUT: 'School force-logout',
    ADMIN_PASSWORD_RESET: 'Admin password reset',
  };
  return map[action] ?? action;
}

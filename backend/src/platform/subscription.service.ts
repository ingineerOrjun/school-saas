import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingCycle,
  Prisma,
  Role,
  SchoolSubscription,
  SchoolStatus,
  SubscriptionPlan,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { PlatformAuditService } from './platform-audit.service';

// ---------------------------------------------------------------------------
// SubscriptionService — manage school subscription periods.
//
// Append-only. Every plan change, renewal, or extension is a new
// row. The "current" subscription is always the most-recent row by
// createdAt where endDate >= now() OR endDate IS NULL.
//
// Status integration:
//   • Creating a TRIAL → school.status flips to TRIAL.
//   • Creating any non-TRIAL with a future endDate (or null) →
//     school.status flips to ACTIVE, BUT only if currently
//     EXPIRED. SUSPENDED is never auto-overridden — that's an
//     operator-tier signal that takes precedence.
//   • school.expiresAt is the denormalized cache of the new
//     endDate, always written.
//
// Why we don't auto-flip SUSPENDED → ACTIVE on renewal: SUSPENDED
// usually means "we caught fraud / the school is in dispute /
// payment bounced." Renewing the subscription doesn't undo that
// concern. The platform owner reactivates SUSPENDED schools
// explicitly, with a reason, via the existing /status endpoint.
// ---------------------------------------------------------------------------

export interface CreateSubscriptionInput {
  schoolId: string;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  startDate: Date;
  /** Required for non-UNLIMITED plans. Ignored for UNLIMITED. */
  endDate?: Date | null;
  studentLimit?: number | null;
  teacherLimit?: number | null;
  enabledFeatures?: Record<string, boolean>;
  notes?: string | null;
}

export interface SubscriptionRow {
  id: string;
  schoolId: string;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  startDate: string;
  endDate: string | null;
  studentLimit: number | null;
  teacherLimit: number | null;
  enabledFeatures: Record<string, boolean>;
  notes: string | null;
  createdById: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a new subscription period. Validates the plan/cycle/date
   * triple, persists, updates the school's status + expiresAt, and
   * records a SUBSCRIPTION_CREATED audit row.
   */
  async create(
    input: CreateSubscriptionInput,
    actor: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<SubscriptionRow> {
    // 1. Validate the school exists.
    const school = await this.prisma.school.findUnique({
      where: { id: input.schoolId },
      select: { id: true, name: true, status: true },
    });
    if (!school) throw new NotFoundException('School not found.');

    // 2. Validate plan/cycle/dates.
    if (input.plan === 'UNLIMITED') {
      // UNLIMITED ignores any passed endDate — perpetual by definition.
      input.endDate = null;
    } else {
      if (!input.endDate) {
        throw new BadRequestException(
          `endDate is required for ${input.plan} plans.`,
        );
      }
      if (input.endDate <= input.startDate) {
        throw new BadRequestException(
          'endDate must be after startDate.',
        );
      }
    }

    if (input.plan === 'TRIAL' && input.billingCycle !== 'ONE_TIME') {
      // Soft warning, not a hard error: the operator can record any
      // billing cycle they like, but trial-with-monthly-cycle is
      // operationally weird. Log it for visibility.
      this.logger.warn(
        `Subscription created with plan=TRIAL but cycle=${input.billingCycle}; expected ONE_TIME.`,
      );
    }
    if (input.plan === 'UNLIMITED' && input.billingCycle !== 'PERPETUAL') {
      this.logger.warn(
        `Subscription created with plan=UNLIMITED but cycle=${input.billingCycle}; expected PERPETUAL.`,
      );
    }

    // 2.5. Capture the previous plan BEFORE we insert the new row,
    // so the post-create notification can decide between
    // "renewed" vs "plan_changed". Null when this is the school's
    // first subscription period.
    const priorRow = await this.prisma.schoolSubscription.findFirst({
      where: { schoolId: input.schoolId },
      orderBy: { createdAt: 'desc' },
      select: { plan: true },
    });
    const priorPlan = priorRow?.plan ?? null;

    // 3. Persist + update school in one transaction.
    const newStatus = computeNextStatus({
      plan: input.plan,
      endDate: input.endDate ?? null,
      currentStatus: school.status,
    });

    const [created] = await this.prisma.$transaction([
      this.prisma.schoolSubscription.create({
        data: {
          schoolId: input.schoolId,
          plan: input.plan,
          billingCycle: input.billingCycle,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          studentLimit: input.studentLimit ?? null,
          teacherLimit: input.teacherLimit ?? null,
          enabledFeatures:
            (input.enabledFeatures as Prisma.InputJsonValue | undefined) ??
            ({} as Prisma.InputJsonValue),
          notes: input.notes ?? null,
          createdById: actor.userId,
        },
        include: {
          createdBy: { select: { email: true } },
        },
      }),
      this.prisma.school.update({
        where: { id: input.schoolId },
        data: {
          expiresAt: input.endDate ?? null,
          // Only flip status when computeNextStatus returned a
          // different value. Identity updates are harmless but
          // muddy the audit log.
          ...(newStatus !== school.status ? { status: newStatus } : {}),
        },
      }),
    ]);

    // 4. Audit.
    await this.audit.record({
      action: 'SUBSCRIPTION_CREATED',
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: {
        type: 'SCHOOL',
        id: input.schoolId,
        label: school.name,
      },
      after: {
        plan: input.plan,
        billingCycle: input.billingCycle,
        startDate: input.startDate.toISOString(),
        endDate: input.endDate ? input.endDate.toISOString() : null,
        studentLimit: input.studentLimit ?? null,
        teacherLimit: input.teacherLimit ?? null,
        statusFlippedTo: newStatus !== school.status ? newStatus : null,
      },
      reason: input.notes ?? null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    this.logger.log(
      `[platform] subscription created school=${school.name}(${input.schoolId}) ` +
        `plan=${input.plan} cycle=${input.billingCycle} ` +
        `endsAt=${input.endDate?.toISOString() ?? 'never'} ` +
        `actor=${actor.userId}`,
    );

    // Phase 13 — fire the appropriate notice. Distinguish:
    //   • plan changed (different plan than the previous most-
    //     recent subscription) → platform.plan_changed.
    //   • plan unchanged       → platform.subscription_renewed.
    // First-ever subscription (no prior plan) → renewed (operator
    // perspective: "we now have a paying period").
    void this.notifySubscriptionEvent({
      schoolId: input.schoolId,
      schoolName: school.name,
      newPlan: input.plan,
      billingCycle: input.billingCycle,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      previousPlan: priorPlan,
    }).catch((e) => {
      this.logger.error(
        `[platform] subscription email failed for school=${school.name}(${input.schoolId}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    });

    return rowToDto(created);
  }

  /**
   * Side-effect: fan out the right post-create notification to the
   * school's primary admin. Called from `create()` as fire-and-
   * forget so a delivery failure does NOT void the subscription.
   *
   * Selection rules:
   *   • previousPlan === null   → "renewed" (first paid period).
   *   • previousPlan !== input  → "plan_changed".
   *   • previousPlan === input  → "renewed" (same-plan renewal).
   */
  private async notifySubscriptionEvent(input: {
    schoolId: string;
    schoolName: string;
    newPlan: SubscriptionPlan;
    billingCycle: BillingCycle;
    startDate: Date;
    endDate: Date | null;
    previousPlan: SubscriptionPlan | null;
  }): Promise<void> {
    const admin = await this.prisma.user.findFirst({
      where: { schoolId: input.schoolId, role: Role.ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    });
    if (!admin) return;

    const isPlanChange =
      input.previousPlan !== null && input.previousPlan !== input.newPlan;

    if (isPlanChange) {
      await this.notifications.enqueue({
        templateKey: 'platform.plan_changed',
        recipients: { email: admin.email },
        dedupeKey: `school:${input.schoolId}:plan:${input.previousPlan}->${input.newPlan}:${input.startDate.getTime()}`,
        schoolId: input.schoolId,
        userId: admin.id,
        payload: {
          brand: this.config.get('mail.brand'),
          schoolName: input.schoolName,
          adminEmail: admin.email,
          fromPlan: input.previousPlan ?? 'NONE',
          toPlan: input.newPlan,
          endDate: input.endDate ? input.endDate.toISOString() : null,
          // Plan tier ordering — higher index = higher tier.
          isUpgrade: PLAN_TIER[input.newPlan] > PLAN_TIER[input.previousPlan!],
        },
      });
    } else {
      await this.notifications.enqueue({
        templateKey: 'platform.subscription_renewed',
        recipients: { email: admin.email },
        dedupeKey: `school:${input.schoolId}:renewed:${input.startDate.getTime()}`,
        schoolId: input.schoolId,
        userId: admin.id,
        payload: {
          brand: this.config.get('mail.brand'),
          schoolName: input.schoolName,
          adminEmail: admin.email,
          plan: input.newPlan,
          billingCycle: input.billingCycle,
          startDate: input.startDate.toISOString(),
          endDate: input.endDate ? input.endDate.toISOString() : null,
        },
      });
    }
  }

  /**
   * Most recent subscription for a school. Returns null when the
   * school has none (legacy / pre-platform schools). Doesn't filter
   * by expiry — caller decides whether endDate matters.
   */
  async getLatestForSchool(schoolId: string): Promise<SubscriptionRow | null> {
    const row = await this.prisma.schoolSubscription.findFirst({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { email: true } },
      },
    });
    return row ? rowToDto(row) : null;
  }

  async listForSchool(schoolId: string): Promise<SubscriptionRow[]> {
    const rows = await this.prisma.schoolSubscription.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { email: true } },
      },
    });
    return rows.map(rowToDto);
  }

  /**
   * Bulk-fetch latest subscription per school for the cross-tenant
   * `/platform/subscriptions` view. Returns a Map keyed by schoolId
   * so the caller can join cheaply against an existing school list.
   *
   * Implementation: one query that pulls all rows ordered by
   * (schoolId, createdAt DESC), then we walk and keep the first row
   * for each schoolId. Postgres' DISTINCT ON would be cheaper at
   * scale but Prisma doesn't expose it cleanly; this approach is
   * fine until we hit 10k+ subscriptions.
   */
  async getLatestForAllSchools(): Promise<Map<string, SubscriptionRow>> {
    const rows = await this.prisma.schoolSubscription.findMany({
      orderBy: [{ schoolId: 'asc' }, { createdAt: 'desc' }],
      include: {
        createdBy: { select: { email: true } },
      },
    });
    const seen = new Map<string, SubscriptionRow>();
    for (const r of rows) {
      if (!seen.has(r.schoolId)) {
        seen.set(r.schoolId, rowToDto(r));
      }
    }
    return seen;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the school's next status given a new subscription's
 * plan + endDate + the school's current status.
 *
 * Rules (in order):
 *   1. SUSPENDED is never auto-overridden — operator-tier signal.
 *   2. TRIAL plan → status TRIAL.
 *   3. Endless or future-ending plan → status ACTIVE.
 *   4. Past-ending plan → status EXPIRED (rare — usually a backfill).
 */
function computeNextStatus(input: {
  plan: SubscriptionPlan;
  endDate: Date | null;
  currentStatus: SchoolStatus;
}): SchoolStatus {
  if (input.currentStatus === 'SUSPENDED') return 'SUSPENDED';
  if (input.plan === 'TRIAL') return 'TRIAL';
  if (input.endDate === null || input.endDate > new Date()) return 'ACTIVE';
  return 'EXPIRED';
}

function rowToDto(
  row: SchoolSubscription & { createdBy: { email: string } | null },
): SubscriptionRow {
  return {
    id: row.id,
    schoolId: row.schoolId,
    plan: row.plan,
    billingCycle: row.billingCycle,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate ? row.endDate.toISOString() : null,
    studentLimit: row.studentLimit,
    teacherLimit: row.teacherLimit,
    enabledFeatures: (row.enabledFeatures as Record<string, boolean>) ?? {},
    notes: row.notes,
    createdById: row.createdById,
    createdByEmail: row.createdBy?.email ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Plan tier ordering — higher index = higher tier. Used by the
// plan-changed notification to decide between "upgraded" vs
// "changed" copy.
const PLAN_TIER: Record<SubscriptionPlan, number> = {
  TRIAL: 0,
  MONTHLY: 1,
  YEARLY: 2,
  UNLIMITED: 3,
};

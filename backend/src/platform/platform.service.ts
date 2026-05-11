import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BillingCycle,
  Prisma,
  Role,
  SchoolStatus,
  SubscriptionPlan,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SchoolCodeService } from './services/school-code.service';
import { NotificationService } from '../notifications/notification.service';
import { PlatformAuditService } from './platform-audit.service';

// ---------------------------------------------------------------------------
// PlatformService — the cross-tenant operations that SUPER_ADMINs run.
//
// Multi-tenancy bypass:
//   Every other service in this codebase scopes by `schoolId` to keep
//   tenant data isolated. PlatformService deliberately doesn't —
//   every method here either lists across all schools or operates on
//   a school by id alone. The boundary that prevents abuse is the
//   `@Roles(SUPER_ADMIN)` guard at the controller layer; this
//   service trusts that the caller is allowed to see everything.
//
// Audit:
//   Phase 8 will add a platform_audit_events table and wire every
//   write path here through it. For now we log to stdout via NestJS
//   `Logger`, which gives an operator the trail in CloudWatch /
//   Docker logs without requiring the audit schema.
// ---------------------------------------------------------------------------

export interface PlatformOverview {
  schoolsTotal: number;
  schoolsActive: number;
  schoolsTrial: number;
  schoolsSuspended: number;
  schoolsExpired: number;
  studentsTotal: number;
  teachersTotal: number;
  paymentsTotalAmount: number;
  paymentsTotalCount: number;
  /** Last 12 months of school growth (oldest-first). */
  schoolGrowthTrend: Array<{ month: string; count: number }>;
  generatedAt: string;
}

export interface PlatformSchoolRow {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  status: SchoolStatus;
  /** Phase 17 — soft read-only flag distinct from SUSPENDED. */
  maintenanceMode: boolean;
  expiresAt: string | null;
  studentCount: number;
  teacherCount: number;
  /** Total payments ever recorded (positive sum, refunds included). */
  paymentsTotalAmount: number;
  /**
   * Latest subscription summary, denormalised into the row so the
   * /platform/schools table can show plan + limits without a fan-
   * out query. Null when the school has no subscriptions yet
   * (legacy / pre-platform schools).
   */
  currentSubscription: {
    id: string;
    plan: SubscriptionPlan;
    billingCycle: BillingCycle;
    startDate: string;
    endDate: string | null;
    studentLimit: number | null;
    teacherLimit: number | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSchoolsQuery {
  /** Free-text search against school name + slug + email. */
  q?: string;
  status?: SchoolStatus;
  /** 1-indexed page; defaults to 1. */
  page?: number;
  /** Capped server-side at 100; defaults to 25. */
  pageSize?: number;
}

export interface PlatformSchoolsResponse {
  rows: PlatformSchoolRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateSchoolStatusInput {
  status: SchoolStatus;
  /** Free-form audit note — required for SUSPENDED/EXPIRED transitions. */
  reason?: string;
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
    private readonly schoolCodes: SchoolCodeService,
  ) {}

  // -------------------------------------------------------------------------
  // Overview — KPIs across the entire platform.
  // -------------------------------------------------------------------------

  async getOverview(): Promise<PlatformOverview> {
    // Single round-trip rollups. Status counts go through groupBy
    // (one query, one trip) instead of fanning out four count
    // queries.
    const [
      schools,
      statusGroup,
      studentsTotal,
      teachersTotal,
      paymentsAgg,
      schoolsForGrowth,
    ] = await Promise.all([
      this.prisma.school.count(),
      this.prisma.school.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.student.count(),
      this.prisma.teacher.count(),
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.school.findMany({
        select: { createdAt: true },
      }),
    ]);

    const statusCount = (s: SchoolStatus): number =>
      statusGroup.find((g) => g.status === s)?._count._all ?? 0;

    // Build a 12-month bucket of school creations for the growth
    // chart. Same shape as `/fees/summary.monthlyTrend` so the
    // platform UI can reuse the same Sparkline component.
    const today = new Date();
    const monthBuckets = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today);
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

    return {
      schoolsTotal: schools,
      schoolsActive: statusCount('ACTIVE'),
      schoolsTrial: statusCount('TRIAL'),
      schoolsSuspended: statusCount('SUSPENDED'),
      schoolsExpired: statusCount('EXPIRED'),
      studentsTotal,
      teachersTotal,
      paymentsTotalAmount: paymentsAgg._sum.amount ?? 0,
      paymentsTotalCount: paymentsAgg._count._all,
      schoolGrowthTrend: [...monthBuckets.entries()].map(
        ([month, count]) => ({ month, count }),
      ),
      generatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Schools — paginated, filterable list of every tenant.
  // -------------------------------------------------------------------------

  async listSchools(
    query: PlatformSchoolsQuery,
  ): Promise<PlatformSchoolsResponse> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const where: Parameters<typeof this.prisma.school.findMany>[0] extends
      | undefined
      | { where?: infer W }
      ? W
      : never = {};
    if (query.status) (where as { status?: SchoolStatus }).status = query.status;
    if (query.q && query.q.trim().length > 0) {
      const q = query.q.trim();
      (where as { OR?: unknown[] }).OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [schools, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        // _count nicely scales — Prisma does the count alongside the
        // school rows in one query, no N+1.
        include: {
          _count: {
            select: { students: true, teachers: true },
          },
        },
      }),
      this.prisma.school.count({ where }),
    ]);

    // Payment totals don't fit naturally into _count — fetch them in
    // one aggregate query keyed by schoolId. Two trips total, both
    // bounded by pageSize.
    const ids = schools.map((s) => s.id);
    const paymentTotals =
      ids.length > 0
        ? await this.prisma.payment.groupBy({
            by: ['schoolId'],
            where: { schoolId: { in: ids } },
            _sum: { amount: true },
          })
        : [];
    const paymentBySchool = new Map<string, number>(
      paymentTotals.map((p) => [p.schoolId, p._sum.amount ?? 0]),
    );

    // Latest subscription per school in the visible page. We pull
    // ALL their subscriptions ordered by (schoolId, createdAt DESC)
    // and keep the first row per school in JS — same pattern as
    // SubscriptionService.getLatestForAllSchools but scoped to
    // current page so the cost stays bounded by pageSize.
    const subsRows =
      ids.length > 0
        ? await this.prisma.schoolSubscription.findMany({
            where: { schoolId: { in: ids } },
            orderBy: [{ schoolId: 'asc' }, { createdAt: 'desc' }],
          })
        : [];
    const subsBySchool = new Map<string, (typeof subsRows)[number]>();
    for (const sub of subsRows) {
      if (!subsBySchool.has(sub.schoolId)) {
        subsBySchool.set(sub.schoolId, sub);
      }
    }

    return {
      rows: schools.map((s) => {
        const sub = subsBySchool.get(s.id) ?? null;
        return {
          id: s.id,
          name: s.name,
          slug: s.slug,
          email: s.email,
          phone: s.phone,
          status: s.status,
          maintenanceMode: s.maintenanceMode,
          expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
          studentCount: s._count.students,
          teacherCount: s._count.teachers,
          paymentsTotalAmount: paymentBySchool.get(s.id) ?? 0,
          currentSubscription: sub
            ? {
                id: sub.id,
                plan: sub.plan,
                billingCycle: sub.billingCycle,
                startDate: sub.startDate.toISOString(),
                endDate: sub.endDate ? sub.endDate.toISOString() : null,
                studentLimit: sub.studentLimit,
                teacherLimit: sub.teacherLimit,
              }
            : null,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async getSchool(schoolId: string): Promise<PlatformSchoolRow> {
    const s = await this.prisma.school.findUnique({
      where: { id: schoolId },
      include: {
        _count: { select: { students: true, teachers: true } },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!s) throw new NotFoundException('School not found.');

    const paymentAgg = await this.prisma.payment.aggregate({
      where: { schoolId },
      _sum: { amount: true },
    });

    const sub = s.subscriptions[0] ?? null;

    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      email: s.email,
      phone: s.phone,
      status: s.status,
      maintenanceMode: s.maintenanceMode,
      expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
      studentCount: s._count.students,
      teacherCount: s._count.teachers,
      paymentsTotalAmount: paymentAgg._sum.amount ?? 0,
      currentSubscription: sub
        ? {
            id: sub.id,
            plan: sub.plan,
            billingCycle: sub.billingCycle,
            startDate: sub.startDate.toISOString(),
            endDate: sub.endDate ? sub.endDate.toISOString() : null,
            studentLimit: sub.studentLimit,
            teacherLimit: sub.teacherLimit,
          }
        : null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Status mutations — the dangerous-action surface.
  //
  // SUSPENDED and EXPIRED transitions REQUIRE a non-empty reason
  // string. The platform UI enforces this with a confirmation modal;
  // we re-enforce server-side because client guards lie under
  // adversarial conditions.
  //
  // Reactivating (back to ACTIVE) doesn't need a reason — it's a
  // restore-to-default action. TRIAL is a soft state that's
  // operationally similar to ACTIVE; a reason is encouraged but not
  // required.
  //
  // Audit: today logs to stdout. Phase 8 will replace this with a
  // platform_audit_events row containing actor, target, before+after
  // status, reason, IP, and timestamp.
  // -------------------------------------------------------------------------

  /**
   * SUPER_ADMIN-only — change a school's public schoolCode after
   * creation. Validates format + uniqueness via SchoolCodeService,
   * persists the new value, and writes a SCHOOL_CODE_UPDATED audit
   * row carrying both the old and new codes. School admins cannot
   * call this; the controller layer enforces that with @Roles.
   *
   * Operator UX consequence: after this call lands, the school's
   * users must use the new code on the login form. Existing
   * sessions remain valid (the JWT carries `schoolId`, not the
   * code).
   */
  async updateSchoolCode(
    schoolId: string,
    input: { schoolCode: string; reason?: string | null },
    actor: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<PlatformSchoolRow> {
    const normalized = this.schoolCodes.normalize(input.schoolCode);
    this.schoolCodes.validate(normalized);

    const before = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, schoolCode: true, name: true },
    });
    if (!before) throw new NotFoundException('School not found.');

    if (before.schoolCode === normalized) {
      // No-op write — nothing changed, no audit row, no event.
      return this.getSchool(schoolId);
    }

    // Check uniqueness BEFORE the update so we can surface a clean
    // ConflictException instead of a P2002. The DB unique index is
    // still the authoritative guard against the race.
    if (await this.schoolCodes.exists(normalized)) {
      throw new ConflictException('This School ID is already assigned.');
    }

    try {
      await this.prisma.school.update({
        where: { id: schoolId },
        data: { schoolCode: normalized },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('This School ID is already assigned.');
      }
      throw err;
    }

    await this.audit.record({
      action: 'SCHOOL_CODE_UPDATED',
      // Tenant scope is the target school — surfaces on that
      // school's admin audit feed even though the actor is a
      // SUPER_ADMIN from the platform school.
      schoolId,
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: {
        type: 'School',
        id: schoolId,
        label: before.name,
      },
      before: { schoolCode: before.schoolCode },
      after: { schoolCode: normalized },
      reason: input.reason ?? null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    this.logger.warn(
      `[platform] school code changed ` +
        `school=${before.name}(${schoolId}) ` +
        `from=${before.schoolCode} to=${normalized} ` +
        `actor=${actor.userId}`,
    );

    return this.getSchool(schoolId);
  }

  async updateSchoolStatus(
    schoolId: string,
    input: UpdateSchoolStatusInput,
    actor: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<PlatformSchoolRow> {
    if (
      (input.status === 'SUSPENDED' || input.status === 'EXPIRED') &&
      (!input.reason || input.reason.trim().length === 0)
    ) {
      throw new BadRequestException(
        `A reason is required to mark a school as ${input.status}.`,
      );
    }

    const before = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, status: true, name: true },
    });
    if (!before) throw new NotFoundException('School not found.');

    if (before.status === input.status) {
      // No-op write. Return the current row instead of issuing an
      // identity UPDATE — keeps audit logs clean (no fake "status
      // changed from ACTIVE to ACTIVE" entries).
      return this.getSchool(schoolId);
    }

    await this.prisma.school.update({
      where: { id: schoolId },
      data: { status: input.status },
    });

    // Phase 8 — persist the audit event. The audit service swallows
    // its own errors (a logged failure to record never blocks the
    // status change), so this fire-and-forget is safe. We `await`
    // so that the response carries an audit-row id when needed by
    // a future "view audit entry" affordance, but a thrown error
    // here would be a bug in the audit service, not in the action.
    await this.audit.record({
      action: 'SCHOOL_STATUS_CHANGED',
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: {
        type: 'SCHOOL',
        id: schoolId,
        // Snapshot the school name at audit time — if the school
        // is later renamed, the audit row still says what was
        // suspended.
        label: before.name,
      },
      before: { status: before.status },
      after: { status: input.status },
      reason: input.reason ?? null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    // Keep the stdout breadcrumb too — useful in dev when you
    // don't want to round-trip to the audit page to see what
    // happened. Production might drop this once the audit table
    // is the source of truth.
    this.logger.warn(
      `[platform] school status changed ` +
        `school=${before.name}(${schoolId}) ` +
        `from=${before.status} to=${input.status} ` +
        `actor=${actor.userId}`,
    );

    // Phase 3 (maturity) — fire status-change notices.
    //
    //   • SUSPENDED  → school_suspended  (warns the admin + reason)
    //   • → ACTIVE   → school_reactivated (the recovery confirmation)
    //
    // Best-effort: a delivery failure does NOT roll back the
    // status change. Each call dedupes per (school, transition event)
    // so a same-millisecond double-click won't double-send.
    try {
      const admin = await this.prisma.user.findFirst({
        where: { schoolId, role: Role.ADMIN },
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true },
      });
      if (admin) {
        if (input.status === 'SUSPENDED' && before.status !== 'SUSPENDED') {
          await this.notifications.enqueue({
            templateKey: 'platform.school_suspended',
            recipients: { email: admin.email },
            dedupeKey: `school:${schoolId}:suspended:${Date.now()}`,
            schoolId,
            userId: admin.id,
            payload: {
              brand: this.config.get('mail.brand'),
              schoolName: before.name,
              adminEmail: admin.email,
              reason: input.reason ?? '(no reason provided)',
              suspendedAt: new Date().toISOString(),
            },
          });
        } else if (
          input.status === 'ACTIVE' &&
          (before.status === 'SUSPENDED' || before.status === 'EXPIRED')
        ) {
          // Phase 13 — reactivation notice. Only sent when coming
          // FROM a blocked state; flips between ACTIVE/TRIAL aren't
          // operationally interesting.
          await this.notifications.enqueue({
            templateKey: 'platform.school_reactivated',
            recipients: { email: admin.email },
            dedupeKey: `school:${schoolId}:reactivated:${Date.now()}`,
            schoolId,
            userId: admin.id,
            payload: {
              brand: this.config.get('mail.brand'),
              schoolName: before.name,
              adminEmail: admin.email,
              loginUrl: `${this.config.get('appUrl')}/login`,
            },
          });
        }
      }
    } catch (e) {
      this.logger.error(
        `[platform] status-change email failed for school=${before.name}(${schoolId}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    return this.getSchool(schoolId);
  }

  // -------------------------------------------------------------------------
  // Maintenance mode (Phase 17) — soft read-only flag distinct from
  // SUSPENDED. Toggled via the school detail page; enforced by
  // MaintenanceModeGuard.
  // -------------------------------------------------------------------------

  async setMaintenanceMode(
    schoolId: string,
    enabled: boolean,
    actor: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
      reason?: string | null;
    },
  ): Promise<PlatformSchoolRow> {
    const before = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, maintenanceMode: true },
    });
    if (!before) throw new NotFoundException('School not found.');

    if (before.maintenanceMode === enabled) {
      // No-op — same value, return current row without churning audit.
      return this.getSchool(schoolId);
    }

    await this.prisma.school.update({
      where: { id: schoolId },
      data: { maintenanceMode: enabled },
    });

    const toggledAt = new Date();

    await this.audit.record({
      action: 'SCHOOL_MAINTENANCE_TOGGLED',
      actor: {
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
      },
      target: { type: 'SCHOOL', id: schoolId, label: before.name },
      before: { maintenanceMode: before.maintenanceMode },
      after: { maintenanceMode: enabled },
      reason: actor.reason ?? null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    this.logger.warn(
      `[platform] maintenance mode ${enabled ? 'ENABLED' : 'DISABLED'} ` +
        `school=${before.name}(${schoolId}) actor=${actor.userId}`,
    );

    // Phase 20 — fire a school-wide in-app notification on every
    // toggle so users see the state in their inbox + bell badge.
    // School-wide = userId omitted; the school-side access filter
    // surfaces these to every user at the tenant via the
    // "userId IS NULL" branch.
    //
    // Best-effort: a delivery failure does NOT roll back the toggle.
    try {
      await this.notifications.enqueue({
        templateKey: enabled
          ? 'platform.maintenance_enabled'
          : 'platform.maintenance_disabled',
        // School-wide IN_APP only — fanning out an email per
        // admin would be noisy at v1; the SUPER_ADMIN already
        // knows what they did.
        recipients: {},
        // Dedupe per (school, transition timestamp) so a same-
        // millisecond double-click won't double-write the row.
        dedupeKey: `school:${schoolId}:maintenance:${enabled ? 'on' : 'off'}:${toggledAt.getTime()}`,
        schoolId,
        // No userId → school-wide broadcast.
        severity: enabled ? 'WARNING' : 'INFO',
        title: enabled
          ? 'Maintenance mode enabled'
          : 'Maintenance mode disabled',
        payload: enabled
          ? {
              brand: this.config.get('mail.brand'),
              schoolName: before.name,
              reason: actor.reason ?? null,
              enabledAt: toggledAt.toISOString(),
            }
          : {
              brand: this.config.get('mail.brand'),
              schoolName: before.name,
              disabledAt: toggledAt.toISOString(),
            },
      });
    } catch (e) {
      this.logger.error(
        `[platform] maintenance notification failed for school=${before.name}(${schoolId}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    return this.getSchool(schoolId);
  }

  // -------------------------------------------------------------------------
  // School users — used by the platform's "Sign in as admin" picker.
  //
  // Lists all NON-SUPER_ADMIN users for a given school. The
  // SUPER_ADMIN exclusion is the same one UserService.list applies
  // for school admins, just at a different boundary; here it
  // guarantees the impersonation target picker can never offer
  // another SUPER_ADMIN as a candidate.
  // -------------------------------------------------------------------------

  async listSchoolUsers(
    schoolId: string,
  ): Promise<
    Array<{
      id: string;
      email: string;
      role: string;
      createdAt: string;
    }>
  > {
    const exists = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('School not found.');

    const users = await this.prisma.user.findMany({
      where: {
        schoolId,
        role: { not: Role.SUPER_ADMIN },
      },
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // Helpers that also serve school-side login enforcement.
  // -------------------------------------------------------------------------

  /**
   * Throw a 403 if a school's status forbids logins. Called from the
   * auth service's login path. SUPER_ADMINs aren't tied to a school
   * and never hit this check.
   */
  static assertSchoolCanLogin(status: SchoolStatus): void {
    if (status === 'SUSPENDED' || status === 'EXPIRED') {
      throw new BadRequestException(
        status === 'SUSPENDED'
          ? 'This school account has been suspended. Contact support to restore access.'
          : 'This school account has expired. Renew the subscription to restore access.',
      );
    }
  }
}

// `Role` import kept silent for future use when the controller adds
// "list super-admins" / "demote super-admin" management.
void Role;

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PlatformAuditAction, Role, SchoolStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { HealthService } from '../health/health.service';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { PlatformService } from './platform.service';
import { PlatformAuditService } from './platform-audit.service';
import { SchoolSnapshotService } from './school-snapshot.service';
import { SecurityService } from './security.service';
import { SubscriptionService } from './subscription.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ForceLogoutSchoolDto } from './dto/force-logout-school.dto';
import { SecurityActionDto } from './dto/security-action.dto';
import { SetMaintenanceModeDto } from './dto/set-maintenance-mode.dto';
import { UpdateFeatureOverridesDto } from './dto/update-feature-overrides.dto';
import { UpdateSchoolStatusDto } from './dto/update-school-status.dto';

// ---------------------------------------------------------------------------
// PlatformController — every route here is SUPER_ADMIN only.
//
// Why a single controller-level role gate instead of per-route:
//   • The whole `/platform` surface is owner-tier. There's no
//     "platform-list-but-not-platform-write" use case worth a
//     separate role. Adding @Roles to every method invites the
//     mistake of adding a method without one.
//   • A future Phase 9 might add a "PLATFORM_VIEWER" read-only role.
//     When that lands, the guard moves per-method; today single
//     gate keeps the surface minimal.
//
// Path prefix `/platform` deliberately distinct from `/admin`,
// `/settings`, etc. — that's the "completely separate" requirement
// from the spec. Frontend routes the matching prefix; the page layer
// enforces its own role gate at the layout level.
// ---------------------------------------------------------------------------

@Controller('platform')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly audit: PlatformAuditService,
    private readonly subscriptions: SubscriptionService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly security: SecurityService,
    private readonly health: HealthService,
    private readonly snapshot: SchoolSnapshotService,
    private readonly analytics: PlatformAnalyticsService,
  ) {}

  /** Cross-platform overview: school + user counts, growth trend. */
  @Get('overview')
  getOverview() {
    return this.platform.getOverview();
  }

  /** Paginated, searchable schools list. */
  @Get('schools')
  listSchools(
    @Query('q') q?: string,
    @Query('status') status?: SchoolStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.platform.listSchools({
      q,
      status,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  /** Single-school detail for the per-school drilldown view. */
  @Get('schools/:id')
  getSchool(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getSchool(id);
  }

  /**
   * Per-school snapshot — analytics + activity feed in one payload.
   * Powers the /platform/schools/:id detail page.
   */
  @Get('schools/:id/snapshot')
  getSchoolSnapshot(@Param('id', ParseUUIDPipe) id: string) {
    return this.snapshot.getSnapshot(id);
  }

  /**
   * List the school's users (excluding SUPER_ADMINs). Powers the
   * impersonation target picker on /platform/schools/:id. Returning
   * SUPER_ADMINs would let an attacker who compromised one
   * SUPER_ADMIN account discover other SUPER_ADMIN emails — Phase 7
   * spec rule "cannot impersonate another SUPER_ADMIN" is enforced
   * at the service level too.
   */
  @Get('schools/:id/users')
  listSchoolUsers(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.listSchoolUsers(id);
  }

  // ---------- Subscriptions ----------

  /**
   * Full subscription history for a school, newest-first. Drives
   * the "previous plans" section of the manage-subscription view.
   */
  @Get('schools/:id/subscriptions')
  listSubscriptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.listForSchool(id);
  }

  /**
   * Create a new subscription period. Append-only — every renewal /
   * extension / plan change posts a new row. Updates school.status
   * + school.expiresAt as a side effect (see SubscriptionService).
   */
  @Post('schools/:id/subscriptions')
  @HttpCode(HttpStatus.CREATED)
  createSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.subscriptions.create(
      {
        schoolId: id,
        plan: dto.plan,
        billingCycle: dto.billingCycle,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        studentLimit: dto.studentLimit ?? null,
        teacherLimit: dto.teacherLimit ?? null,
        enabledFeatures: dto.enabledFeatures,
        notes: dto.notes ?? null,
      },
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    );
  }

  /**
   * Change a school's lifecycle status. Reason is required when
   * moving to SUSPENDED or EXPIRED — both are dangerous-action
   * transitions that need an audit-trail justification.
   *
   * The platform UI surfaces this as "Suspend school" / "Mark as
   * expired" / "Reactivate" buttons; this single endpoint is the
   * one write path behind all three.
   */
  @Patch('schools/:id/status')
  @HttpCode(HttpStatus.OK)
  updateSchoolStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSchoolStatusDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.platform.updateSchoolStatus(
      id,
      { status: dto.status, reason: dto.reason },
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        // `req.ip` honors the trust-proxy setting if it's been
        // configured at the Nest bootstrap level; otherwise it's
        // the direct connection IP. Either way it's a best-effort
        // value — audit-trail context, not a security control.
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
    );
  }

  // ---------- Feature flags (Phase 5) ----------

  /**
   * The catalog — every feature the platform knows about, with its
   * default and "coming soon" flag. Drives the platform UI's matrix
   * column header.
   */
  @Get('features/catalog')
  getFeatureCatalog() {
    return this.featureFlags.getCatalog();
  }

  /**
   * Cross-tenant feature matrix. One row per school with the
   * resolved feature set + the override / subscription / default
   * layers exposed for the UI's "why is this on?" tooltip.
   */
  @Get('features')
  async listFeatures() {
    const { rows } = await this.platform.listSchools({
      page: 1,
      pageSize: 100,
    });
    const ids = rows.map((r) => r.id);
    const sets = await this.featureFlags.resolveForSchools(ids);
    return {
      catalog: this.featureFlags.getCatalog(),
      schools: rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        currentPlan: r.currentSubscription?.plan ?? null,
        features: sets.get(r.id)?.features ?? {},
        overrides: sets.get(r.id)?.overrides ?? {},
        subscription: sets.get(r.id)?.subscription ?? null,
      })),
    };
  }

  /**
   * Resolved + layered feature set for one school. The layers are
   * exposed so the platform UI can show "this is on because the
   * override forces it" vs. "this is on because the subscription
   * includes it" vs. "this is on because the catalog default".
   */
  @Get('schools/:id/features')
  async getSchoolFeatures(@Param('id', ParseUUIDPipe) id: string) {
    return this.featureFlags.resolveForSchool(id);
  }

  /**
   * Replace the school-level override map. Empty `overrides` clears
   * every override (subscription + defaults take over).
   *
   * Audit emission lives here (not inside FeatureFlagsService) to
   * avoid a circular module dep — FeatureFlagsModule is @Global and
   * mustn't import PlatformModule. The service hands back the
   * before/after diff so this controller can record the audit row
   * with full request context.
   */
  @Patch('schools/:id/features')
  @HttpCode(HttpStatus.OK)
  async setSchoolFeatures(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeatureOverridesDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const result = await this.featureFlags.setOverrides(id, dto.overrides);
    if (result.changed) {
      await this.audit.record({
        action: 'FEATURE_FLAG_CHANGED',
        actor: {
          userId: user.id,
          email: user.email,
          role: user.role,
        },
        target: {
          type: 'SCHOOL',
          id,
          label: result.schoolName,
        },
        before: { overrides: result.before },
        after: { overrides: result.set.overrides },
        reason: dto.reason ?? null,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
    }
    return result.set;
  }

  // ---------- Maintenance mode (Phase 17) ----------

  /**
   * Toggle the school's `maintenanceMode` flag. When ON, the
   * MaintenanceModeGuard rejects writes from school users with 503;
   * reads continue to work; SUPER_ADMINs bypass entirely. Audited
   * via SCHOOL_MAINTENANCE_TOGGLED.
   */
  @Patch('schools/:id/maintenance')
  @HttpCode(HttpStatus.OK)
  setMaintenanceMode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetMaintenanceModeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.platform.setMaintenanceMode(id, dto.enabled, {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      reason: dto.reason ?? null,
    });
  }

  // ---------- Security controls (Phase 9) ----------

  /**
   * List a user's sessions. Operator-tier read into the same data
   * the school-side `/me/sessions` exposes — for any user. Used by
   * the SecurityDialog to render per-session revoke affordances.
   */
  @Get('users/:id/sessions')
  listUserSessions(@Param('id', ParseUUIDPipe) id: string) {
    return this.security.listUserSessions(id);
  }

  /**
   * Revoke one specific session for a user. Granular alternative to
   * the watermark-based force-logout below — useful when the
   * operator only wants to kill ONE token (e.g. the one from a
   * known-bad IP) and leave the rest intact.
   */
  @Post('users/:userId/sessions/:sessionId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeUserSession(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: SecurityActionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.security.revokeUserSession({
      userId,
      sessionId,
      actor: {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
      reason: dto.reason ?? null,
    });
  }

  /**
   * Force-logout a single user. Their existing JWTs are rejected
   * by the auth strategy until they sign in again. The platform
   * UI exposes this as an icon-button on the user row.
   */
  @Post('users/:id/force-logout')
  @HttpCode(HttpStatus.OK)
  forceLogoutUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SecurityActionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.security.forceLogoutUser(
      id,
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
      dto.reason ?? null,
    );
  }

  /**
   * Force-logout every NON-SUPER_ADMIN user at a school. Reason is
   * required — see ForceLogoutSchoolDto. Used during incident
   * response (e.g. credential leak) where the operator wants every
   * open session at the tenant terminated immediately.
   */
  @Post('schools/:id/force-logout')
  @HttpCode(HttpStatus.OK)
  forceLogoutSchool(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ForceLogoutSchoolDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.security.forceLogoutSchool(
      id,
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
      dto.reason,
    );
  }

  /**
   * Reset a school user's password to a generated temporary one.
   * The plaintext is in the response — once. The platform UI is
   * expected to copy it to the operator's clipboard, surface a
   * "share this with the user out-of-band" warning, and never
   * persist it.
   *
   * Side effect: bumps the user's `tokensValidAfter` watermark so
   * any sessions opened with the previous password are evicted.
   */
  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetUserPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SecurityActionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.security.resetPassword(
      id,
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      },
      dto.reason ?? null,
    );
  }

  // ---------- Platform analytics (Phase 16) ----------

  /**
   * Cross-cutting analytics payload — revenue, growth, system,
   * risk. Powers the ops dashboard + future analytics expansion
   * sections. Each bucket runs in parallel; total cost is bounded
   * by the slowest scan (~ schools × 12 months for growth).
   */
  @Get('analytics')
  getAnalytics() {
    return this.analytics.getAll();
  }

  // ---------- System health (Phase 10) ----------

  /**
   * Operator pulse — uptime, memory, DB probe, recent error rate,
   * recent failed-login summary. Cheap to call (one SELECT 1
   * round-trip + in-memory rollups), so the platform UI polls this
   * every ~30s for a live "is the box alive?" view.
   *
   * `@SkipThrottle()`:
   *   The endpoint is BY DESIGN polled at a fixed cadence by the
   *   operator's open browser tab. The /platform overview also
   *   includes a one-shot health pull. Together with React's
   *   StrictMode double-firing in dev + multiple platform tabs
   *   open during incident response, the call rate easily exceeds
   *   the default 60/min/IP bucket.
   *
   *   Throttling an operational pulse endpoint is a footgun: when
   *   the operator most needs to see what's happening (during an
   *   incident, refreshing aggressively), the throttle would lock
   *   them out. The endpoint is already SUPER_ADMIN-gated, which
   *   is a far stronger access control than rate limiting.
   */
  @Get('health')
  @SkipThrottle()
  getHealth() {
    return this.health.getHealth();
  }

  // ---------- Audit log ----------

  /**
   * Paginated list of platform audit events. Filterable by action,
   * actor, target, date range, and free-text (across actor email,
   * target label, and reason).
   */
  @Get('audit')
  listAudit(
    @Query('action') action?: PlatformAuditAction,
    @Query('actorUserId') actorUserId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('q') q?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.list({
      action,
      actorUserId,
      targetType,
      targetId,
      q,
      fromDate,
      toDate,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }
}

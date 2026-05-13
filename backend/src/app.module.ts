import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { JobsModule } from './common/jobs/jobs.module';
import { MaintenanceModeGuard } from './common/maintenance/maintenance-mode.guard';
import { ObservabilityModule } from './common/observability/observability.module';
import { RequestIdMiddleware } from './common/observability/request-id.middleware';
import { RequestMetricsMiddleware } from './common/observability/request-metrics.middleware';
import { UserAwareThrottlerGuard } from './common/throttle/user-aware-throttler.guard';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OperationsModule } from './operations/operations.module';
import { SystemModule } from './system/system.module';
import { ExperienceModule } from './experience/experience.module';
import { ProductizationModule } from './productization/productization.module';
import { SessionsModule } from './sessions/sessions.module';
import { AcademicSessionModule } from './academic-session/academic-session.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { AuthModule } from './auth/auth.module';
import { TeacherScopeModule } from './common/auth/teacher-scope.module';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AttendanceModule } from './attendance/attendance.module';
import { ClassModule } from './class/class.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExamsModule } from './exams/exams.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { FeesModule } from './fees/fees.module';
import { GradingModule } from './grading/grading.module';
import { PlatformModule } from './platform/platform.module';
import { PromotionModule } from './promotion/promotion.module';
import { SchoolModule } from './school/school.module';
import { SectionModule } from './section/section.module';
import { StudentModule } from './student/student.module';
import { SubjectModule } from './subject/subject.module';
import { TeacherModule } from './teacher/teacher.module';
import { TeachingAssignmentModule } from './teaching-assignment/teaching-assignment.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Serve uploaded school logos at /uploads/* so the frontend can
    // <img src="http://api/uploads/logos/<file>" /> them. Path resolves
    // from the project root regardless of how Nest was started.
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: {
        // Logos rarely change once set; cache aggressively but allow
        // revalidation so a re-upload appears within minutes.
        maxAge: '1h',
        index: false,
      },
    }),
    // Phase 9 — global rate limiter.
    //
    // Named throttle buckets — each surface gets its own budget
    // so traffic from one (e.g. notification polling) doesn't
    // exhaust the user's allowance for another (e.g. dashboard
    // navigation).
    //
    // CRITICAL: every named bucket listed here is evaluated on
    // EVERY request. There is no "this bucket only applies to
    // this route" mechanism at the module level. If you add a
    // bucket with limit=5 here, EVERY authenticated request burns
    // a slot, and the 6th request anywhere in the app gets 429.
    //
    // Buckets that should only apply to specific endpoints (login,
    // register) live on the controller as
    //   @Throttle({ default: { limit, ttl, blockDuration } })
    // which OVERRIDES the `default` bucket's values for that one
    // route while leaving every other endpoint on the wide 600/min
    // budget. See `auth.controller.ts` for the canonical pattern.
    //
    // Sizing rationale for the three globally-evaluated buckets:
    //   • default        — 600/min/user. Wide safety net for the
    //     long tail of dashboard endpoints. Per-user keying via
    //     UserAwareThrottlerGuard means one busy admin doesn't
    //     starve another at the same NAT. A page load fanout (5-10
    //     reads × React StrictMode × polled endpoints × multiple
    //     tabs) needs comfortable headroom; 600/min covers it.
    //   • notifications  — 120/min/user. Per spec. Handles polling
    //     (1/min unread + list fetches) plus optimistic mutations.
    //   • platform       — 300/min/user. SUPER_ADMIN traffic is
    //     bursty (open the ops cockpit + drill into a school +
    //     check audit log + open notifications all in one minute).
    //
    // What's NOT here (intentionally):
    //   • `auth` and `register` — these used to be globally-
    //     evaluated buckets with very small limits (10/min, 5/hour).
    //     Because every named bucket runs on every request, the
    //     `register` bucket was blocking the entire app for an
    //     hour after just 5 dashboard loads. Phase RELIABILITY-IV
    //     moved both to per-route @Throttle decorators in
    //     auth.controller.ts. Adding them back here will re-break
    //     dashboard traffic — DO NOT.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 600,
      },
      {
        name: 'notifications',
        ttl: 60_000,
        limit: 120,
      },
      {
        name: 'platform',
        ttl: 60_000,
        limit: 300,
      },
    ]),
    DatabaseModule,
    // Phase α fix — @Global() observability primitives. Holds
    // RequestMetricsService + StructuredLogger + the two middleware
    // classes that AppModule.configure() references. Mounted early
    // so every downstream module can inject from it.
    ObservabilityModule,
    AuthModule,
    TeacherScopeModule,
    AcademicSessionModule,
    StudentModule,
    TeacherModule,
    ClassModule,
    SectionModule,
    SubjectModule,
    TeachingAssignmentModule,
    AttendanceModule,
    GradingModule,
    ExamsModule,
    FeesModule,
    DashboardModule,
    SchoolModule,
    UserModule,
    AnnouncementModule,
    PromotionModule,
    // Platform Control Layer — SUPER_ADMIN-only, multi-tenant
    // operations. Mounted here at the AppModule level (not nested
    // under SchoolModule) because its surface deliberately bypasses
    // school scoping.
    PlatformModule,
    // Feature flags — Phase 5. @Global() so feature gating works
    // from any controller without an explicit import. Mounted AFTER
    // PlatformModule because it depends on PlatformAuditService for
    // FEATURE_FLAG_CHANGED audit rows.
    FeatureFlagsModule,
    // Health — Phase 10. @Global() so the global exception filter,
    // AuthService, and PlatformController can all inject
    // HealthService without explicit imports. Holds in-memory
    // ring buffers + the DB probe.
    HealthModule,
    // Notifications — maturity Phase 2/3. @Global() so any feature
    // service (security, subscription, auth) can call
    // NotificationService.enqueue without an explicit import. Owns
    // the channel + email-provider DI.
    NotificationsModule,
    // Jobs — Phase 15. @Global() so any module can schedule async
    // work via JobQueueService.enqueue and register handlers at
    // boot. Boots the in-process runner (poll loop) at app start.
    JobsModule,
    // Sessions — Phase 17 follow-up. @Global() so AuthService /
    // JwtStrategy can inject SessionService for per-token tracking
    // (login creates, strategy looks up + touches, logout revokes).
    SessionsModule,
    // Operations Center — Phase 21. SUPER_ADMIN-only cockpit
    // surface (request monitoring, queue monitor, subsystem health,
    // security feed, session monitor, school health grid, event
    // ticker, incident broadcast). Mounted AFTER PlatformModule +
    // SessionsModule + NotificationsModule because it consumes
    // SecurityService, SessionService, and NotificationService.
    OperationsModule,
    // Productization — Phase 23. School-side onboarding wizard,
    // staff invitations, per-tenant branding, support notes,
    // announcement banners, guardian foundations, data exports +
    // imports, deployment + adoption telemetry. Independent of
    // OperationsModule (no shared state); mounted last because
    // it consumes the broadest set of global services.
    ProductizationModule,
    // Experience — Phase 24. Tenant-side UX polish surface
    // (unified /me/search powering the Cmd+K palette). Pure
    // read-side; no new schema, no new dependencies.
    ExperienceModule,
    // System — Phase PLATFORM STABILIZATION (Parts 4+6+7). School-
    // admin facing operational health surface (backup freshness +
    // tenant integrity report). Distinct from OperationsModule
    // (SUPER_ADMIN cockpit) and HealthModule (unauthenticated probes).
    SystemModule,
    // Future feature modules will be added here
  ],
  controllers: [],
  providers: [
    // Phase 9 — global rate limiter guard. Applies the "default"
    // ThrottlerModule bucket to every route. Sensitive endpoints
    // can override with @Throttle({ <named-bucket>: { ... } }) to
    // pull from a tighter bucket — see auth.controller.ts.
    //
    // Custom UserAwareThrottlerGuard (not the stock ThrottlerGuard)
    // keys buckets by user id when req.user is set, so dashboard
    // fan-out from one logged-in user doesn't burn quota shared
    // with everyone else on the same IP.
    {
      provide: APP_GUARD,
      useClass: UserAwareThrottlerGuard,
    },
    // Phase 10 — register the global exception filter via DI so it
    // can inject HealthService. main.ts no longer instantiates it
    // manually — the APP_FILTER token is the framework-supported
    // path for getting DI into a global filter.
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Phase 17 — global maintenance-mode guard. Runs after the
    // throttler; rejects mutating requests for tenants whose
    // maintenanceMode flag is on. SUPER_ADMINs and platform-tier
    // routes bypass; reads always pass through.
    {
      provide: APP_GUARD,
      useClass: MaintenanceModeGuard,
    },
    // RequestMetricsService + StructuredLogger + the two middleware
    // classes were moved to ObservabilityModule (@Global). The
    // previous "AppModule providers are global" assumption was wrong
    // — child modules (Operations, Productization) couldn't inject
    // them, breaking boot. The @Global module makes them visible
    // everywhere.
  ],
})
export class AppModule implements NestModule {
  // Middleware order matters:
  //   1. RequestIdMiddleware — must run FIRST so the rest of the
  //      pipeline (auth, throttler, metrics, controllers, services)
  //      observes a populated RequestContext via AsyncLocalStorage.
  //   2. RequestMetricsMiddleware — runs second, captures duration +
  //      status on `res.on('finish')`, stamps the matched route /
  //      userId / schoolId onto the active context.
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, RequestMetricsMiddleware)
      .forRoutes('*');
  }
}

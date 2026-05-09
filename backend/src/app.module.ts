import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { JobsModule } from './common/jobs/jobs.module';
import { MaintenanceModeGuard } from './common/maintenance/maintenance-mode.guard';
import { UserAwareThrottlerGuard } from './common/throttle/user-aware-throttler.guard';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
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
    // Buckets:
    //   • default — wide safety net (600/min). Keyed PER-USER for
    //     authenticated requests (see UserAwareThrottlerGuard) and
    //     per-IP for the unauthenticated tail. Each logged-in user
    //     gets their own quota, so a busy dashboard tab can't burn
    //     another user's allowance even when both share an IP.
    //   • auth    — login bucket. 10/min. Keyed per-IP (the user
    //     isn't authenticated yet by definition).
    //   • register — tenant-creation bucket. 5/hour per-IP.
    //
    // Why 600/min on the default:
    //   Authenticated dashboards fan out hard. A single page load
    //   triggers 5-10 reads, React StrictMode double-fires in dev,
    //   polled endpoints (/platform/health, /me/features, /dashboard/*)
    //   add a steady baseline, and the operator may have multiple
    //   tabs open during incident response. 600/min/user is comfortably
    //   above legitimate usage and still catches a runaway client.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 60s
        limit: 600,
      },
      {
        name: 'auth',
        ttl: 60_000, // 60s
        limit: 10, // login attempts per IP per minute
      },
      {
        name: 'register',
        ttl: 60 * 60_000, // 1h
        limit: 5, // tenant registrations per IP per hour
      },
    ]),
    DatabaseModule,
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
  ],
})
export class AppModule {}

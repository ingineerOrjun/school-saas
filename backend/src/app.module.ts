import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'node:path';
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
    // Phase 9 — global rate limiter. The default bucket is generous
    // (60/min) so it never blocks normal app traffic; sensitive
    // endpoints (login + register) declare their own tighter
    // buckets via @Throttle() in their controllers. Registered
    // globally via APP_GUARD below so the limit applies even to
    // routes that don't opt into UseGuards.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000, // 60s
        limit: 60,
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
    // Future feature modules will be added here
  ],
  controllers: [],
  providers: [
    // Phase 9 — global rate limiter guard. Applies the "default"
    // ThrottlerModule bucket to every route. Sensitive endpoints
    // can override with @Throttle({ <named-bucket>: { ... } }) to
    // pull from a tighter bucket — see auth.controller.ts.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

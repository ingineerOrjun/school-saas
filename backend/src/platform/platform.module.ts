import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { SignOptions } from 'jsonwebtoken';
import { ScheduleModule } from '@nestjs/schedule';
import { HashingModule } from '../common/hashing/hashing.module';
import { JobRegistry } from '../common/jobs/job-registry.service';
import { DatabaseModule } from '../database/database.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformAuditService } from './platform-audit.service';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { SchoolSnapshotService } from './school-snapshot.service';
import { SecurityService } from './security.service';
import { SubscriptionExpiringJob } from './subscription-expiring.job';
import { SubscriptionExpiringNoticeHandler } from './jobs/subscription-expiring-notice.handler';
import { SubscriptionService } from './subscription.service';

/**
 * Platform Control Layer module.
 *
 * Composition:
 *   • PlatformService — schools list, status mutations, school-user
 *     listing for the impersonation picker.
 *   • PlatformAuditService — single-source audit ingestion + query.
 *   • ImpersonationService — token swap for the Phase 7 flow.
 *
 * Why JwtModule is registered here (and not just imported from
 * AuthModule):
 *   AuthService depends on PlatformService (for the SUSPENDED-login
 *   check). Importing AuthModule into PlatformModule to get
 *   JwtService would create a circular module dependency. We
 *   register JwtModule directly with the same factory used in
 *   AuthModule — both registrations resolve to the same secret +
 *   TTL because they read from the same ConfigService.
 *
 *   PassportModule is imported for the JwtAuthGuard transitively;
 *   AuthModule already exports it but we don't import AuthModule, so
 *   we pull PassportModule in here too.
 */
@Module({
  imports: [
    DatabaseModule,
    HashingModule,
    // Phase 3 (maturity) — register the platform-side cron jobs
    // (subscription-expiring notice for now). ScheduleModule is
    // forRoot here so PlatformModule owns its own scheduler context;
    // a future shared schedule across modules can hoist this to
    // AppModule once we have a second job.
    ScheduleModule.forRoot(),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: {
          expiresIn: (config.get<string>('auth.jwtExpiresIn') ??
            '7d') as SignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [PlatformController, ImpersonationController],
  providers: [
    PlatformService,
    PlatformAnalyticsService,
    PlatformAuditService,
    ImpersonationService,
    SchoolSnapshotService,
    SecurityService,
    SubscriptionExpiringJob,
    SubscriptionExpiringNoticeHandler,
    SubscriptionService,
  ],
  exports: [
    PlatformService,
    PlatformAnalyticsService,
    PlatformAuditService,
    SchoolSnapshotService,
    SecurityService,
    SubscriptionService,
  ],
})
export class PlatformModule implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly subscriptionExpiringNotice: SubscriptionExpiringNoticeHandler,
  ) {}

  // Phase 15 — register platform-side job handlers at module init.
  // The cron (SubscriptionExpiringJob) enqueues jobs by name; the
  // runner picks them up and routes them here.
  onModuleInit() {
    this.registry.register(this.subscriptionExpiringNotice);
  }
}

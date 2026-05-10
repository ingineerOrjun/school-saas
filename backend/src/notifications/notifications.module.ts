import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { SignOptions } from 'jsonwebtoken';
import { JobRegistry } from '../common/jobs/job-registry.service';
import { DatabaseModule } from '../database/database.module';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/in-app.channel';
import { SendDeliveryHandler } from './handlers/send-delivery.handler';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationCenterController } from './notification-center.controller';
import { NotificationCenterService } from './notification-center.service';
import { NotificationService } from './notification.service';
import {
  ConsoleEmailProvider,
  SmtpEmailProvider,
} from './providers/email-provider';
import { EMAIL_PROVIDER } from './providers/email-provider.token';

// ---------------------------------------------------------------------------
// NotificationsModule — Phase 2/3 maturity.
//
// @Global() so any feature service can inject NotificationService
// without explicit imports — the security service triggers password-
// reset emails, the subscription service can fire expiring notices,
// etc. One pattern across the whole codebase.
//
// EMAIL_PROVIDER is bound by env via a factory so `MAIL_PROVIDER=smtp`
// flips the implementation at boot without touching code. Default is
// the console provider so dev-without-SMTP-config still works.
// ---------------------------------------------------------------------------

@Global()
@Module({
  imports: [
    DatabaseModule,
    // Phase 14 — the Notification Center controller is SUPER_ADMIN
    // gated, so it needs JwtAuthGuard + RolesGuard at runtime. We
    // register Passport + JwtModule with the same factory used in
    // AuthModule (avoids the AuthModule → NotificationsModule
    // import cycle).
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
  // Phase 20 — MeNotificationsController serves the school-side
  // inbox at /notifications. Both controllers share the same
  // service; the controllers diverge only in access-control filtering
  // (platform-tier sees everything; school-side filters by user +
  // school + null-userId broadcasts).
  controllers: [NotificationCenterController, MeNotificationsController],
  providers: [
    NotificationService,
    NotificationCenterService,
    EmailChannel,
    InAppChannel,
    SendDeliveryHandler,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = (config.get<string>('mail.provider') ?? 'console')
          .toLowerCase();
        if (provider === 'smtp') {
          return new SmtpEmailProvider({
            host: config.getOrThrow<string>('mail.smtp.host'),
            port: parseInt(
              config.get<string>('mail.smtp.port') ?? '587',
              10,
            ),
            user: config.get<string>('mail.smtp.user'),
            pass: config.get<string>('mail.smtp.pass'),
            secure:
              (config.get<string>('mail.smtp.secure') ?? '').toLowerCase() ===
              'true',
          });
        }
        return new ConsoleEmailProvider();
      },
    },
  ],
  exports: [NotificationService, NotificationCenterService, EmailChannel],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly sendDelivery: SendDeliveryHandler,
  ) {}

  // Phase 15 — register job handlers at module init. Producers can
  // schedule notification deliveries via the queue (for retry +
  // backoff) without going through the synchronous NotificationService
  // path.
  onModuleInit() {
    this.registry.register(this.sendDelivery);
  }
}

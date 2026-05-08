import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { SignOptions } from 'jsonwebtoken';
import { HashingModule } from '../common/hashing/hashing.module';
import { DatabaseModule } from '../database/database.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformAuditService } from './platform-audit.service';
import { ImpersonationController } from './impersonation.controller';
import { ImpersonationService } from './impersonation.service';
import { SecurityService } from './security.service';
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
    PlatformAuditService,
    ImpersonationService,
    SecurityService,
    SubscriptionService,
  ],
  exports: [
    PlatformService,
    PlatformAuditService,
    SecurityService,
    SubscriptionService,
  ],
})
export class PlatformModule {}

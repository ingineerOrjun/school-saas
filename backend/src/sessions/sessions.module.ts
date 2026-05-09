import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { SignOptions } from 'jsonwebtoken';
import { DatabaseModule } from '../database/database.module';
import { SessionService } from './session.service';
import { SessionsController } from './sessions.controller';

// ---------------------------------------------------------------------------
// SessionsModule — Phase 17 follow-up.
//
// @Global() so AuthService (login → create), JwtStrategy (validate
// → lookup + touch), AuthController (logout → revoke) and the
// future MeSessionsController (school-side list/revoke) can all
// inject SessionService without explicit imports.
//
// Same pattern as HealthModule + JobsModule — the service is
// cross-cutting, so the module is global. No controllers wired
// here — endpoints live where they belong (auth/, me/, platform/).
// ---------------------------------------------------------------------------

@Global()
@Module({
  imports: [
    DatabaseModule,
    // SessionsController is JwtAuthGuard-protected, so the module
    // needs Passport + JwtModule. Same factory pattern PlatformModule
    // uses to avoid the AuthModule import cycle.
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
  controllers: [SessionsController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionsModule {}

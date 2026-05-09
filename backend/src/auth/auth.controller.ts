import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SessionService } from '../sessions/session.service';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedUser } from './jwt.strategy';
import { LoginDto } from './dto/login.dto';
import { RegisterAdminDto } from './dto/register-admin.dto';

/**
 * Phase 9 — sensitive endpoints carry tighter rate limits than the
 * global default. The buckets themselves are configured in
 * AppModule (`ThrottlerModule.forRoot`):
 *
 *   • register → 5 requests / hour / IP. Provisioning a new tenant
 *     is a high-impact, low-volume action — five per hour is well
 *     above legitimate usage and well below an enumeration attack.
 *   • login    → 10 requests / minute / IP. The login form will
 *     occasionally retry on a typo; ten per minute leaves
 *     headroom for that without becoming a credential-stuffing
 *     channel.
 *
 * Phase 17 follow-up — `POST /auth/logout` revokes the calling
 * session's row. JwtAuthGuard-protected so only an authenticated
 * client can revoke; the body is empty (the session id comes from
 * the bearer token).
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ register: { limit: 5, ttl: 60 * 60_000 } })
  register(@Body() dto: RegisterAdminDto, @Req() req: Request) {
    return this.auth.registerAdmin(dto, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(
      dto,
      req.ip ?? null,
      req.headers['user-agent'] ?? null,
    );
  }

  /**
   * Revoke the calling session. The frontend's logout button hits
   * this BEFORE clearing localStorage so the server-side session
   * row stops being valid for any other client that has the same
   * token cached (rare in practice but possible if the operator
   * shared a token for support).
   *
   * Idempotent: repeat calls on an already-revoked session no-op.
   * Skip silently when the token has no `sid` (legacy tokens) —
   * the watermark eventually catches up.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser) {
    if (!user.sessionId) return;
    await this.sessions.revoke({
      sessionId: user.sessionId,
      reason: 'user logout',
      expectUserId: user.id,
    });
  }
}

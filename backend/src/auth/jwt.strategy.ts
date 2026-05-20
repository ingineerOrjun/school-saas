import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../database/prisma.service';
import { SessionService } from '../sessions/session.service';
import type { JwtPayload } from './types/jwt-payload';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  schoolId: string;
  /**
   * Phase 17 follow-up — session id from the JWT's `sid` claim.
   * Present on tokens issued after the sessions table existed.
   * Used by the school-side "log out everywhere except this one"
   * affordance to identify the calling session.
   */
  sessionId?: string;
  /**
   * Phase 7 — impersonation context.
   *
   * Present only when this request is being made through an
   * impersonation token. Carries the SUPER_ADMIN's user id (NOT
   * the target's — that's already on `id`). Domain code generally
   * shouldn't read this; it's for the platform layer's banner +
   * audit trail + the rule that platform endpoints reject
   * impersonated requests.
   */
  impersonatedBy?: string;
  impersonationStartedAt?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('auth.jwtSecret'),
    });
  }

  /**
   * Passport calls `validate` with the decoded payload. We re-check the user
   * exists and still belongs to the claimed school — the returned value is
   * attached to `req.user`.
   *
   * Phase 9 — session-invalidation watermark:
   *   Every user row carries an optional `tokensValidAfter` timestamp.
   *   When set, JWTs whose `iat` (issued-at) is OLDER than this
   *   timestamp are rejected with 401, regardless of the JWT's own
   *   `exp`. This is the mechanism behind force-logout + admin
   *   password reset: flipping the column instantly evicts every
   *   open session for that user without a token-revocation table.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        role: true,
        schoolId: true,
        tokensValidAfter: true,
        // Session 6c.1 — soft-delete state. A non-null `deletedAt`
        // means this user's tokens must be rejected regardless of
        // expiry / watermark / session status. The check lands below
        // alongside the schoolId match so all three "token isn't
        // valid anymore" reasons share the same 401 path.
        deletedAt: true,
      },
    });

    if (!user || user.schoolId !== payload.schoolId || user.deletedAt) {
      throw new UnauthorizedException('Token is no longer valid.');
    }

    // `iat` is on every JWT (jsonwebtoken library writes it
    // automatically) and is in SECONDS since epoch. The watermark
    // is a Date — convert before comparing. When `iat` is missing
    // (shouldn't happen with our signer, but be defensive), we
    // can't tell if the token predates the watermark, so we treat
    // it as old and reject. That fails closed.
    if (user.tokensValidAfter) {
      const iatMs = typeof payload.iat === 'number' ? payload.iat * 1000 : 0;
      if (iatMs < user.tokensValidAfter.getTime()) {
        throw new UnauthorizedException(
          'Session was invalidated. Please log in again.',
        );
      }
    }

    // Phase 17 follow-up — session lookup. Tokens issued after
    // sessions shipped carry a `sid` claim. Tokens issued BEFORE
    // (legacy) have no sid — they're treated as implicit sessions
    // gated only by the watermark above. Once those tokens expire
    // (default 7d), every active token has a sid.
    if (payload.sid) {
      const session = await this.sessions.findActive(payload.sid);
      if (!session) {
        throw new UnauthorizedException(
          'Session was revoked. Please log in again.',
        );
      }
      // Best-effort lastActiveAt bump. The service throttles
      // writes so this is cheap on the hot path.
      void this.sessions.touch(session.id, session.lastActiveAt);
    }

    // Forward impersonation context. The rest of the app sees a
    // normal `AuthenticatedUser` with the target's identity; the
    // banner / audit trail / platform-route guard read these two
    // fields from `req.user`.
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.schoolId,
      sessionId: payload.sid,
      impersonatedBy: payload.impersonatedBy,
      impersonationStartedAt: payload.impersonationStartedAt,
    };
  }
}

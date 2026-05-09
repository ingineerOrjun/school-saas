import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

// ---------------------------------------------------------------------------
// UserAwareThrottlerGuard — key by user id when authenticated.
//
// Default ThrottlerGuard keys by `req.ip`. That makes sense for
// public endpoints (login, register) where the client has no
// identity yet — IP is the only handle we have on the caller.
//
// For authenticated routes IP-keying is wrong:
//   • A school behind a single NAT shares ONE bucket across every
//     teacher's laptop. One enthusiastic user can starve every
//     other user at the same school.
//   • Localhost in dev = every request shares the same key. With
//     React's StrictMode double-firing + polled endpoints
//     (/platform/health, /me/features, /dashboard/teacher-summary)
//     + page navigation, the burst easily exceeds any IP bucket
//     that's tight enough to be useful as a safety net.
//
// Solution: when `req.user` is populated by JwtStrategy, key the
// throttler bucket by the user id. Each user gets their own quota.
// Unauthenticated requests fall back to IP (the parent's default
// behaviour) — that's where the meaningful protection lives anyway
// (auth + register endpoints).
//
// IP fallback also covers the `/auth/login` path: req.user is
// undefined there, so the per-IP bucket applies and login bursts
// from one IP still hit the tight `auth` bucket.
// ---------------------------------------------------------------------------

@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    // `req.user` is attached by Passport's JwtStrategy.validate.
    // For unauthenticated routes it's undefined and we fall through
    // to the default IP-based key.
    const user = (req as Request & { user?: AuthenticatedUser }).user;
    if (user?.id) {
      return `user:${user.id}`;
    }
    return req.ip ?? 'unknown';
  }
}

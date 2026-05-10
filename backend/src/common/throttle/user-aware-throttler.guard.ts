import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { decode } from 'jsonwebtoken';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';
import type { JwtPayload } from '../../auth/types/jwt-payload';

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
//     React's StrictMode double-firing + polled endpoints +
//     multiple dev tabs all on the same JWT, the burst quickly
//     exceeds any IP bucket that's tight enough to be a useful
//     safety net.
//
// The Phase-19 plan was to read `req.user` from Passport. That
// turned out to be too late — Nest runs global guards (this one)
// BEFORE controller-level guards (JwtAuthGuard / Passport), so
// `req.user` is always undefined at this point. Every authenticated
// request was silently falling through to per-IP keying, which is
// exactly the bug we set out to fix.
//
// Phase-α fix: decode the Bearer token directly here. We do NOT
// verify the signature (JwtAuthGuard does that downstream and
// rejects bad tokens with 401). Decoding is purely for bucket
// derivation; if a forged token shares another user's bucket, the
// "attacker" gets the victim's quota — which doesn't help them
// attack the system.
//
// IP fallback still covers:
//   • Unauthenticated routes (login, register).
//   • Requests with no Authorization header.
//   • Requests with a malformed token (decode returns null).
//
// Cost: one synchronous JWT decode per request. The library does
// base64-decode + JSON-parse, no crypto, sub-millisecond. Compared
// to the throttler's downstream rate-limit lookup, negligible.
// ---------------------------------------------------------------------------

@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger('UserAwareThrottler');

  protected async getTracker(req: Request): Promise<string> {
    // First check — if Passport has already run for this request
    // (e.g. via a controller-level guard that fired earlier in a
    // future Nest version where order changes), trust it.
    const populatedUser = (req as Request & { user?: AuthenticatedUser })
      .user;
    if (populatedUser?.id) {
      return `user:${populatedUser.id}`;
    }

    // Otherwise extract the user id from the Bearer token directly.
    // Decode (not verify) — we only need the claim, not authenticity.
    const userId = extractUserIdFromAuthHeader(req);
    if (userId) {
      // Stamp the tracker key onto the request so downstream
      // diagnostic logging (RequestMetricsMiddleware) can read it.
      // Without this, the middleware shows user=<anon> even when
      // the throttler keyed per-user — confusing during diagnosis.
      (req as Request & { _throttleTracker?: string })._throttleTracker =
        `user:${userId}`;
      return `user:${userId}`;
    }

    // Diagnostic — log WHY we fell through. Helps pinpoint whether
    // the issue is missing header, malformed token, or missing claim.
    if (process.env.NODE_ENV !== 'production') {
      const header = req.headers.authorization;
      const reason = !header
        ? 'no-auth-header'
        : !/^Bearer\s+/i.test(header)
          ? 'not-bearer'
          : 'decode-failed-or-no-userId';
      this.logger.warn(
        `[fallback-to-ip] reason=${reason} path=${req.url} ip=${req.ip}`,
      );
    }
    const ipKey = req.ip ?? 'unknown';
    (req as Request & { _throttleTracker?: string })._throttleTracker =
      `ip:${ipKey}`;
    return ipKey;
  }
}

/**
 * Pulls the `userId` claim out of an inbound Bearer token without
 * verifying the signature. Returns null when:
 *   • the Authorization header is missing or not Bearer-prefixed
 *   • the token doesn't decode as JWT
 *   • the payload doesn't carry a string userId
 */
function extractUserIdFromAuthHeader(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1];
  try {
    const payload = decode(token);
    if (!payload || typeof payload === 'string') return null;
    const userId = (payload as Partial<JwtPayload>).userId;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}

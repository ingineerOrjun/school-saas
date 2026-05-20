import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Session } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// SessionService — Phase 17 follow-up.
//
// Per-token tracking. Coexists with `users.tokensValidAfter`:
//   • Watermark = "kill all" (operator incident response).
//   • Sessions  = per-device revoke (user grade).
//
// API surface:
//   • create()        — at login. Returns the new row's id (the JWT
//                       carries it as `sid`).
//   • findActive()    — JwtStrategy lookup. Rejects revoked rows.
//   • touch()         — bumps lastActiveAt, throttled to once per
//                       minute per session.
//   • revoke()        — user / admin / logout flow.
//   • revokeAllForUser() — bulk for "log out everywhere."
//   • listForUser()   — for the UI's session list.
//
// Throttling:
//   touch() doesn't write if the existing lastActiveAt is fresher
//   than TOUCH_INTERVAL_MS (60s). Without this, every authenticated
//   request would be a write on the sessions table — that's
//   write amplification on what should be a cheap read path.
// ---------------------------------------------------------------------------

const TOUCH_INTERVAL_MS = 60_000;

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: string;
  lastActiveAt: string;
  ip: string | null;
  userAgent: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new session row at login. Caller embeds the returned
   * `id` in the JWT's `sid` claim.
   *
   * Phase 22:
   *   • Computes a coarse device fingerprint (SHA-256 of UA +
   *     IP /24 prefix) and stores it for new-device detection.
   *   • Records the IP/UA on `lastIp` / `lastUserAgent` too so
   *     `touch()` has somewhere to write current network info.
   *   • Logs a WARN line when the fingerprint hasn't been seen
   *     for this user in the last 30 days — operations can alert
   *     on the structured log signal.
   *
   * Return shape kept backward-compatible (raw Session) so existing
   * callers + tests don't need a surface change. The new-device
   * signal flows out via the log line, not the return value.
   */
  async create(input: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<Session> {
    const fingerprint = computeFingerprint({
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
    // "New device" = no recent (last 30d) ACTIVE session with the
    // same fingerprint. Quick check via index on
    // (userId, deviceFingerprint).
    let isNewDevice = false;
    if (fingerprint) {
      const existing = await this.prisma.session.findFirst({
        where: {
          userId: input.userId,
          deviceFingerprint: fingerprint,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) },
        },
        select: { id: true },
      });
      isNewDevice = !existing;
    }
    const session = await this.prisma.session.create({
      data: {
        userId: input.userId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        deviceFingerprint: fingerprint,
        lastIp: input.ip ?? null,
        lastUserAgent: input.userAgent ?? null,
      },
    });
    if (isNewDevice) {
      this.logger.warn(
        `[security] new device detected user=${input.userId} ip=${input.ip ?? '?'} sessionId=${session.id} fingerprint=${fingerprint ?? '?'}`,
      );
    }
    return session;
  }

  /**
   * Fetch a session by id IF it's still active. Returns null when
   * the session is revoked or doesn't exist — both shapes mean
   * "reject the token."
   */
  async findActive(id: string): Promise<Session | null> {
    const row = await this.prisma.session.findUnique({ where: { id } });
    if (!row || row.revokedAt) return null;
    return row;
  }

  /**
   * Bump lastActiveAt if more than TOUCH_INTERVAL_MS has passed
   * since the last touch. Returns true when a write happened.
   *
   * Caller: JwtStrategy.validate(). Cheap to call on every request
   * because most calls short-circuit.
   */
  async touch(id: string, lastActiveAt: Date): Promise<boolean> {
    const now = Date.now();
    if (now - lastActiveAt.getTime() < TOUCH_INTERVAL_MS) return false;
    try {
      await this.prisma.session.update({
        where: { id },
        data: { lastActiveAt: new Date(now) },
      });
      return true;
    } catch {
      // Race — session was revoked between the strategy's read and
      // here. Swallow; the next request will surface the rejection.
      return false;
    }
  }

  /**
   * Mark a session revoked. Idempotent — re-revoking is a no-op.
   * Throws NotFoundException for an unknown id.
   */
  async revoke(input: {
    sessionId: string;
    reason: string;
    /** Restrict to sessions owned by this user (school-side). */
    expectUserId?: string;
  }): Promise<Session> {
    const row = await this.prisma.session.findUnique({
      where: { id: input.sessionId },
    });
    if (!row) throw new NotFoundException('Session not found.');
    if (input.expectUserId && row.userId !== input.expectUserId) {
      // From the user's perspective this looks like "session not
      // found" — they shouldn't see another user's session ids.
      throw new NotFoundException('Session not found.');
    }
    if (row.revokedAt) return row; // already revoked, no-op

    const updated = await this.prisma.session.update({
      where: { id: input.sessionId },
      data: { revokedAt: new Date(), revokedReason: input.reason },
    });
    this.logger.log(
      `[sessions] revoked session=${input.sessionId} user=${row.userId} reason=${input.reason}`,
    );
    return updated;
  }

  /**
   * Mark every active session for a user as revoked. Used by:
   *   • "Log out everywhere" affordance on the school-side
   *     /settings/sessions page (excludes the calling session via
   *     `exceptSessionId` so the user stays signed in here).
   *   • Operator-tier emergency revocation (no exception).
   * Returns the count revoked.
   */
  async revokeAllForUser(input: {
    userId: string;
    reason: string;
    exceptSessionId?: string;
  }): Promise<{ count: number }> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId: input.userId,
        revokedAt: null,
        ...(input.exceptSessionId
          ? { id: { not: input.exceptSessionId } }
          : {}),
      },
      data: { revokedAt: new Date(), revokedReason: input.reason },
    });
    this.logger.warn(
      `[sessions] bulk revoke user=${input.userId} count=${result.count} reason=${input.reason}`,
    );
    return { count: result.count };
  }

  /**
   * List a user's sessions (active + recently-revoked) newest-first.
   * The list view shows a max of 25 rows — that's plenty for a real
   * user, and it caps the response size for users with stale history.
   */
  async listForUser(userId: string): Promise<SessionRow[]> {
    const rows = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return rows.map(toRow);
  }

  /**
   * Operator-tier — count active sessions across the platform,
   * with an "online in the last 15 minutes" sub-count for the
   * Operations Center KPI row. Both numbers are bounded by an
   * indexed scan on (revokedAt IS NULL).
   */
  async countActiveAcrossPlatform(): Promise<{
    active: number;
    onlineLast15m: number;
  }> {
    const now = Date.now();
    const cutoff15m = new Date(now - 15 * 60_000);
    const [active, onlineLast15m] = await this.prisma.$transaction([
      this.prisma.session.count({ where: { revokedAt: null } }),
      this.prisma.session.count({
        where: { revokedAt: null, lastActiveAt: { gte: cutoff15m } },
      }),
    ]);
    return { active, onlineLast15m };
  }

  /**
   * Operator-tier — paginated active sessions across every tenant.
   * Joins the user + school for the cockpit table. Filters:
   *
   *   • q          — free-text contains across user.email + school.name
   *   • schoolId   — single-tenant drill-in
   *   • onlyOnline — last-active in the last 15 minutes
   *
   * Result shape carries the joined fields so the UI doesn't need a
   * second round-trip per row. Response capped at 100 rows; the UI
   * uses the q/schoolId filters when narrowing matters.
   */
  async listActiveForOps(input: {
    q?: string;
    schoolId?: string;
    onlyOnline?: boolean;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      createdAt: string;
      lastActiveAt: string;
      ip: string | null;
      userAgent: string | null;
      user: {
        id: string;
        email: string;
        role: string;
      };
      school: {
        id: string;
        name: string;
        slug: string;
      } | null;
    }>
  > {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    // Session 6c.1 — exclude sessions whose owner has been
    // soft-deleted. Those sessions are dead at the JWT layer
    // already (the strategy rejects them), so showing them in
    // the operator viewer would just be confusing. Seed the
    // user-relation filter with `deletedAt: null` so subsequent
    // branches that spread `where.user` preserve it.
    const where: Record<string, unknown> = {
      revokedAt: null,
      user: { deletedAt: null },
    };
    if (input.onlyOnline) {
      where.lastActiveAt = { gte: new Date(Date.now() - 15 * 60_000) };
    }
    if (input.schoolId) {
      where.user = {
        ...((where.user as object) ?? {}),
        schoolId: input.schoolId,
      };
    }
    if (input.q && input.q.trim().length > 0) {
      const q = input.q.trim();
      where.user = {
        ...((where.user as object) ?? {}),
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { school: { name: { contains: q, mode: 'insensitive' } } },
        ],
      };
    }
    const rows = await this.prisma.session.findMany({
      where: where as never,
      orderBy: { lastActiveAt: 'desc' },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        lastActiveAt: true,
        ip: true,
        userAgent: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            school: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      lastActiveAt: r.lastActiveAt.toISOString(),
      ip: r.ip,
      userAgent: r.userAgent,
      user: {
        id: r.user.id,
        email: r.user.email,
        role: r.user.role as string,
      },
      school: r.user.school
        ? {
            id: r.user.school.id,
            name: r.user.school.name,
            slug: r.user.school.slug,
          }
        : null,
    }));
  }
}

/**
 * Phase 22 — coarse device fingerprint.
 *
 * SHA-256 of:
 *   • full user-agent string
 *   • IP /24 prefix (first three octets) so a roaming client on the
 *     same NAT hash to the same fingerprint without exposing the
 *     full IP in the hash input
 *
 * Returns null when both ip + userAgent are missing — no signal,
 * no fingerprint. Stable across the life of a session under the
 * same browser; changes when the user moves to a new device or
 * rolls IP into a different /24.
 *
 * Trade-offs:
 *   • Coarse on purpose. A real fingerprint (FingerprintJS-style)
 *     needs client-side JS. Server-side we only have UA + IP.
 *   • False positives possible (two users on the same NAT with the
 *     same browser). The "new device detected" UI needs to be soft —
 *     a notification, not a forced re-auth.
 */
function computeFingerprint(input: {
  ip: string | null;
  userAgent: string | null;
}): string | null {
  if (!input.ip && !input.userAgent) return null;
  const ipPrefix = input.ip
    ? input.ip.split('.').slice(0, 3).join('.')
    : '';
  const ua = input.userAgent ?? '';
  return createHash('sha256')
    .update(`${ua}::${ipPrefix}`, 'utf8')
    .digest('hex')
    .slice(0, 32); // 128-bit prefix is plenty
}

function toRow(row: Session): SessionRow {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    ip: row.ip,
    userAgent: row.userAgent,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedReason: row.revokedReason,
  };
}

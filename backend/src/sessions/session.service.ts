import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Session } from '@prisma/client';
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
   */
  async create(input: {
    userId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId: input.userId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
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

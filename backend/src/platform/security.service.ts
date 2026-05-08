import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { randomBytes } from 'crypto';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuditService } from './platform-audit.service';

// ---------------------------------------------------------------------------
// SecurityService — Phase 9.
//
// Three operator-tier surfaces:
//
//   1. Force-logout one user.
//   2. Force-logout every user at a school (incident response).
//   3. Reset a school user's password to a generated temporary one.
//      The plaintext is returned ONCE, then forgotten — the operator
//      hands it off out-of-band. The reset flow ALSO bumps
//      `tokensValidAfter` so any open sessions are evicted, even
//      though the password change alone wouldn't invalidate them.
//
// Mechanism shared by all three:
//   `User.tokensValidAfter = now()` — the JWT strategy compares
//   each request's token `iat` (issued-at, in seconds) to this
//   timestamp and rejects when older. Cheap, no revocation table.
//
// Why no separate per-token allowlist:
//   We're issuing short-lived JWTs (default 7d). A revocation
//   table grows unbounded; a watermark column is constant-cost.
//   Trade-off: we can't selectively invalidate ONE of a user's
//   tokens — flipping the watermark kicks them off every device.
//   For Phase 9's threat model that's the desired behaviour.
//
// Safety rails:
//   • SUPER_ADMINs cannot force-logout other SUPER_ADMINs (same
//     rule as the impersonation picker). Bulk school force-logout
//     skips SUPER_ADMIN rows for the same reason — those accounts
//     aren't tenant-scoped and shouldn't be collateral damage when
//     a school is being reset.
//   • Password reset rejects on SUPER_ADMIN targets too. Resetting
//     a peer SUPER_ADMIN through the same API would be a hostile
//     takeover surface; if a legitimate platform-owner password
//     reset is needed, that's a separate seed-script flow.
// ---------------------------------------------------------------------------

export interface ForceLogoutUserResult {
  /** ISO timestamp written to `tokensValidAfter`. */
  tokensValidAfter: string;
  /** Snapshot of the user, for the platform UI to show. */
  user: { id: string; email: string; role: string };
}

export interface ForceLogoutSchoolResult {
  /** ISO timestamp written to every user row. */
  tokensValidAfter: string;
  /** How many user rows were updated. */
  affectedCount: number;
}

export interface ResetPasswordResult {
  /**
   * The plaintext temporary password. Returned ONCE — the platform
   * UI is expected to copy it to the operator's clipboard and warn
   * them it can't be recovered later.
   */
  temporaryPassword: string;
  /** ISO timestamp the user's existing sessions were invalidated. */
  tokensValidAfter: string;
  user: { id: string; email: string; role: string };
}

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * Invalidate every existing JWT for a single user. Future requests
   * carrying any of those tokens fail with 401; the user must log
   * in again to obtain a fresh one.
   *
   * Refuses to act on SUPER_ADMIN targets — see safety rails comment.
   */
  async forceLogoutUser(
    userId: string,
    actor: ActorCtx,
    reason: string | null,
  ): Promise<ForceLogoutUserResult> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        schoolId: true,
        school: { select: { name: true } },
      },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (target.role === Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Cannot force-logout a SUPER_ADMIN through the platform API.',
      );
    }

    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokensValidAfter: now },
    });

    await this.audit.record({
      action: 'USER_FORCE_LOGOUT',
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      target: {
        type: 'USER',
        id: target.id,
        // Combine email + school name so the audit row is readable
        // without joining anything: "alice@school-a.edu (School A)".
        label: `${target.email}${
          target.school?.name ? ` (${target.school.name})` : ''
        }`,
      },
      after: { tokensValidAfter: now.toISOString() },
      reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    this.logger.warn(
      `[platform] force-logout user=${target.email}(${userId}) actor=${actor.userId} reason=${reason ?? '<none>'}`,
    );

    return {
      tokensValidAfter: now.toISOString(),
      user: { id: target.id, email: target.email, role: target.role },
    };
  }

  /**
   * School-wide hammer: invalidate every NON-SUPER_ADMIN user at a
   * school. SUPER_ADMINs aren't tenant-scoped and stay logged in.
   *
   * Reason is REQUIRED for this one — bulk session evictions need
   * a paper trail. The platform UI enforces this with a confirmation
   * modal; we re-enforce server-side.
   */
  async forceLogoutSchool(
    schoolId: string,
    actor: ActorCtx,
    reason: string,
  ): Promise<ForceLogoutSchoolResult> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestException(
        'A reason is required to force-logout an entire school.',
      );
    }

    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });
    if (!school) throw new NotFoundException('School not found.');

    const now = new Date();
    const result = await this.prisma.user.updateMany({
      where: {
        schoolId,
        role: { not: Role.SUPER_ADMIN },
      },
      data: { tokensValidAfter: now },
    });

    await this.audit.record({
      action: 'SCHOOL_FORCE_LOGOUT',
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      target: {
        type: 'SCHOOL',
        id: school.id,
        label: school.name,
      },
      after: {
        tokensValidAfter: now.toISOString(),
        affectedCount: result.count,
      },
      reason: reason.trim(),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    this.logger.warn(
      `[platform] force-logout school=${school.name}(${schoolId}) ` +
        `affected=${result.count} actor=${actor.userId}`,
    );

    return {
      tokensValidAfter: now.toISOString(),
      affectedCount: result.count,
    };
  }

  /**
   * Reset a school user's password to a strong random temporary one.
   * Returns the plaintext ONCE; nothing else can recover it.
   *
   * Side effects:
   *   • `password` rewritten with the bcrypt hash of the new value.
   *   • `tokensValidAfter` set to now() so any logged-in session
   *     is evicted (otherwise the old password's holder would stay
   *     authenticated until JWT expiry).
   *
   * Refuses SUPER_ADMIN targets — same reasoning as forceLogoutUser.
   */
  async resetPassword(
    userId: string,
    actor: ActorCtx,
    reason: string | null,
  ): Promise<ResetPasswordResult> {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        schoolId: true,
        school: { select: { name: true } },
      },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (target.role === Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Cannot reset a SUPER_ADMIN password through the platform API.',
      );
    }

    const tempPassword = generateTempPassword();
    const hash = await this.hashing.hash(tempPassword);
    const now = new Date();

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hash, tokensValidAfter: now },
    });

    await this.audit.record({
      action: 'ADMIN_PASSWORD_RESET',
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      target: {
        type: 'USER',
        id: target.id,
        label: `${target.email}${
          target.school?.name ? ` (${target.school.name})` : ''
        }`,
      },
      // The audit row carries NO secret material. Only the API
      // response does, and only for one round-trip.
      after: { tokensValidAfter: now.toISOString() },
      reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    this.logger.warn(
      `[platform] password reset user=${target.email}(${userId}) actor=${actor.userId} reason=${reason ?? '<none>'}`,
    );

    return {
      temporaryPassword: tempPassword,
      tokensValidAfter: now.toISOString(),
      user: { id: target.id, email: target.email, role: target.role },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ActorCtx {
  userId: string;
  email?: string | null;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * 16-character mixed-case + digit + symbol password. Strong enough
 * for a few hours of one-time use until the user changes it; not a
 * permanent credential. We deliberately avoid look-alike characters
 * (0/O, 1/l) so the operator can read it over the phone if needed.
 */
function generateTempPassword(): string {
  const safe =
    'ABCDEFGHJKLMNPQRSTUVWXYZ' + // no I, O
    'abcdefghijkmnpqrstuvwxyz' + // no l, o
    '23456789' + // no 0, 1
    '!@#$%^&*';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += safe[bytes[i] % safe.length];
  }
  return out;
}

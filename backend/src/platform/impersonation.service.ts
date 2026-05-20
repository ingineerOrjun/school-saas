import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { SignOptions } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload';
import { PlatformAuditService } from './platform-audit.service';

// ---------------------------------------------------------------------------
// ImpersonationService — the only path that mints an impersonation token.
//
// Security model:
//
//   • Only SUPER_ADMINs can start impersonation. Enforced at the
//     controller level via `@Roles(SUPER_ADMIN)`; checked again here
//     because defence in depth is cheap when guards exist.
//
//   • Cannot impersonate another SUPER_ADMIN. Phase 7 spec rule.
//     Without this guard, a compromised SUPER_ADMIN account could
//     pivot to other SUPER_ADMINs and obscure the trail.
//
//   • Cannot start impersonation FROM an already-impersonated
//     session. Nesting impersonation makes the audit trail
//     ambiguous ("who actually performed this?") and serves no use
//     case the spec calls out.
//
//   • Issued tokens carry the TARGET user's identity (id/role/
//     schoolId) so school-side permission checks just work.
//     Audit-wise, school-side writes get attributed to the target
//     user — that's intentional, since impersonation is for
//     reproducing what the school admin sees.
//
//   • A short token TTL (kept default — auth module owns it) means
//     forgotten impersonation sessions naturally expire.
//
// Audit:
//   Every start + end records to platform_audit_events. The
//   IMPERSONATION_ENDED row carries `durationMs` in `after` so the
//   audit list can show "impersonated for 12m 34s" without joining
//   to the start row.
// ---------------------------------------------------------------------------

export interface StartImpersonationResult {
  /** New JWT carrying the target user's identity + impersonation sentinels. */
  accessToken: string;
  /** The user being impersonated — minimal projection for the client banner. */
  user: {
    id: string;
    email: string;
    role: Role;
    schoolId: string;
  };
  school: {
    id: string;
    name: string;
    slug: string;
  };
  startedAt: string;
}

export interface EndImpersonationResult {
  /** Fresh SUPER_ADMIN token. The previous (impersonation) token stays
   *  decodable until expiry but should be discarded by the client. */
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: Role;
    schoolId: string;
  };
}

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * Start impersonating `targetUserId`. The caller (`actor`) must be
   * a SUPER_ADMIN whose session is NOT itself an impersonated one.
   */
  async start(input: {
    actor: {
      userId: string;
      email: string;
      role: Role;
      isAlreadyImpersonating: boolean;
    };
    targetUserId: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<StartImpersonationResult> {
    if (input.actor.role !== Role.SUPER_ADMIN) {
      // Defence-in-depth: the @Roles guard rejects non-SUPER_ADMIN
      // before this method runs, but we don't trust that to be the
      // only barrier.
      throw new ForbiddenException(
        'Only SUPER_ADMIN can start impersonation.',
      );
    }
    if (input.actor.isAlreadyImpersonating) {
      throw new ConflictException(
        'You are already impersonating another user. End the current session before starting a new one.',
      );
    }
    if (input.targetUserId === input.actor.userId) {
      throw new BadRequestException(
        'You cannot impersonate yourself.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: input.targetUserId },
      include: {
        school: { select: { id: true, name: true, slug: true, status: true } },
      },
    });
    // Session 6c.1 — soft-deleted users surface as 404 here. Any
    // token minted against a deactivated account would be rejected
    // on the next request anyway (JwtStrategy short-circuits on
    // `deletedAt`); refusing up-front keeps the operator UX clean
    // ("can't impersonate, user is gone") instead of issuing a
    // token that turns out to be a brick.
    if (!target || target.deletedAt) {
      throw new NotFoundException('User not found.');
    }

    if (target.role === Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Cannot impersonate another SUPER_ADMIN.',
      );
    }

    // Don't impersonate into a SUSPENDED/EXPIRED tenant either —
    // the school-side login path rejects the same shape. If the
    // platform owner needs to investigate a suspended school, they
    // should reactivate it first (which is itself an audited action).
    if (
      target.school.status === 'SUSPENDED' ||
      target.school.status === 'EXPIRED'
    ) {
      throw new ConflictException(
        `Cannot impersonate into a ${target.school.status} school. Reactivate the school first.`,
      );
    }

    const startedAt = new Date().toISOString();

    // Mint the impersonation token. Note: the issued payload's
    // `userId/role/schoolId` are the TARGET's, not the actor's.
    // Domain code stays oblivious; only platform code reads the
    // sentinels.
    const payload: JwtPayload = {
      userId: target.id,
      role: target.role,
      schoolId: target.schoolId,
      impersonatedBy: input.actor.userId,
      impersonationStartedAt: startedAt,
    };
    const accessToken = this.jwt.sign(payload, {
      // Same TTL as a regular login token. Phase 9 may shorten this
      // for impersonation specifically; for now the same ceiling
      // keeps behaviour predictable. Cast matches AuthModule's
      // registerAsync signature (the `jsonwebtoken` types use a
      // narrowed union, not plain string).
      expiresIn: (this.config.get<string>('auth.jwtExpiresIn') ??
        '12h') as SignOptions['expiresIn'],
    });

    await this.audit.record({
      action: 'IMPERSONATION_STARTED',
      actor: {
        userId: input.actor.userId,
        email: input.actor.email,
        role: input.actor.role,
      },
      target: {
        type: 'USER',
        id: target.id,
        // Snapshot as "email · role @ school" so the audit row reads
        // even if the user is later renamed or removed.
        label: `${target.email} · ${target.role} @ ${target.school.name}`,
      },
      // No real "before/after" semantics for an impersonation start —
      // we store the start timestamp + the actor/target wiring so a
      // future "view session" affordance has everything in one row.
      after: {
        startedAt,
        targetSchoolId: target.schoolId,
        targetSchoolSlug: target.school.slug,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    this.logger.warn(
      `[platform] impersonation started ` +
        `actor=${input.actor.userId}(${input.actor.email}) ` +
        `target=${target.id}(${target.email}) ` +
        `school=${target.school.slug}`,
    );

    return {
      accessToken,
      user: {
        id: target.id,
        email: target.email,
        role: target.role,
        schoolId: target.schoolId,
      },
      school: {
        id: target.school.id,
        name: target.school.name,
        slug: target.school.slug,
      },
      startedAt,
    };
  }

  /**
   * End an impersonation session and return a fresh SUPER_ADMIN
   * token. The caller's effective identity (`req.user`) is the
   * impersonated target; we read `impersonatedBy` to find the real
   * SUPER_ADMIN to re-issue against.
   */
  async end(input: {
    impersonatedTargetId: string;
    impersonatedBy: string;
    impersonationStartedAt: string;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<EndImpersonationResult> {
    // Session 6c.1 — also refuse the re-issue if the original
    // SUPER_ADMIN was soft-deleted mid-impersonation. The existing
    // role check would still pass (the row still has role
    // SUPER_ADMIN) but the user is deactivated; mirror the
    // deleted-or-demoted branch so the operator gets bounced to
    // /login the same way.
    const superAdmin = await this.prisma.user.findUnique({
      where: { id: input.impersonatedBy },
      select: {
        id: true,
        email: true,
        role: true,
        schoolId: true,
        deletedAt: true,
      },
    });
    if (
      !superAdmin ||
      superAdmin.role !== Role.SUPER_ADMIN ||
      superAdmin.deletedAt
    ) {
      // Either the SUPER_ADMIN was deleted/demoted while the session
      // was open, or the token's `impersonatedBy` claim was tampered
      // with. Either way: refuse to issue a fresh token. The client
      // will fall back to /login.
      throw new ForbiddenException(
        'Original SUPER_ADMIN session is no longer valid. Please sign in again.',
      );
    }

    // Compute session duration for the audit row.
    const startedAtMs = Date.parse(input.impersonationStartedAt);
    const durationMs = Number.isFinite(startedAtMs)
      ? Date.now() - startedAtMs
      : 0;

    // Snapshot the target for the audit `target` field. Best-effort
    // — if the user was removed mid-session, we still record the id.
    const target = await this.prisma.user.findUnique({
      where: { id: input.impersonatedTargetId },
      include: {
        school: { select: { name: true } },
      },
    });

    await this.audit.record({
      action: 'IMPERSONATION_ENDED',
      actor: {
        userId: superAdmin.id,
        email: superAdmin.email,
        role: superAdmin.role,
      },
      target: {
        type: 'USER',
        id: input.impersonatedTargetId,
        label: target
          ? `${target.email} · ${target.role} @ ${target.school.name}`
          : `<deleted user ${input.impersonatedTargetId.slice(0, 8)}>`,
      },
      after: {
        endedAt: new Date().toISOString(),
        startedAt: input.impersonationStartedAt,
        durationMs,
      },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    // Mint a fresh SUPER_ADMIN token — no impersonation sentinels.
    const payload: JwtPayload = {
      userId: superAdmin.id,
      role: superAdmin.role,
      schoolId: superAdmin.schoolId,
    };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: (this.config.get<string>('auth.jwtExpiresIn') ??
        '12h') as SignOptions['expiresIn'],
    });

    this.logger.warn(
      `[platform] impersonation ended ` +
        `actor=${superAdmin.id}(${superAdmin.email}) ` +
        `target=${input.impersonatedTargetId} ` +
        `durationMs=${durationMs}`,
    );

    return {
      accessToken,
      user: {
        id: superAdmin.id,
        email: superAdmin.email,
        role: superAdmin.role,
        schoolId: superAdmin.schoolId,
      },
    };
  }
}

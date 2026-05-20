import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Role, type UserInvitation } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { HashingService } from '../common/hashing/hashing.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';

// ---------------------------------------------------------------------------
// InvitationService — Phase 23 Section 2.
//
// Email-based onboarding for staff. Replaces the Phase-1 pattern of
// SUPER_ADMINs hand-creating accounts with a real invite flow:
//
//   1. Admin POSTs /invitations { email, role, displayName? }.
//   2. We mint an opaque token, persist a UserInvitation row, and
//      enqueue a `staff.invitation` notification with the accept URL.
//   3. Recipient clicks the link → frontend POSTs
//      /invitations/accept { token, password, displayName? }.
//   4. We create the User row, mark the invitation accepted, and
//      return a fresh JWT (auto-login).
//
// Token rules:
//   • One-shot: acceptedAt set on success → second accept call
//     surfaces 409.
//   • Time-limited: 7d default; the accept endpoint refuses expired.
//   • Revocable: admin can revoke; revoked rows refuse acceptance.
//   • Resendable: re-invite for the same (school, email) bumps
//     `expiresAt` and re-fires the email — same token (so an
//     existing email link still works).
//
// Email delivery uses the existing NotificationService —
// templateKey `staff.invitation`. The payload carries the URL so
// the renderer can produce a clickable button.
// ---------------------------------------------------------------------------

const INVITATION_TTL_DAYS = 7;
const TOKEN_BYTES = 32; // 64 hex chars

export interface InvitationRow {
  id: string;
  schoolId: string;
  email: string;
  role: Role;
  displayName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedById: string;
  acceptedUserId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Computed — true when the invite is usable today. */
  isPending: boolean;
}

export interface AcceptResult {
  user: { id: string; email: string; role: Role; schoolId: string };
  /** Issued by the controller via AuthService; service returns the user. */
  invitation: InvitationRow;
}

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashing: HashingService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a new invitation. If one already exists for the
   * (schoolId, email) pair AND it's still pending, we treat the
   * call as a "resend" — bumps expiresAt + re-fires the email,
   * keeps the original token.
   *
   * Refuses to invite an email that already has a real User in
   * the same school (operator should reset that user's password
   * instead).
   */
  async invite(input: {
    schoolId: string;
    email: string;
    role: Role;
    displayName?: string;
    invitedById: string;
  }): Promise<InvitationRow> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes('@')) {
      throw new BadRequestException('Invalid email address.');
    }

    // No re-inviting an ACTIVE existing user. Tenant-scoped: emails
    // are unique per (schoolId, email), not globally — a user with
    // the same email at another school is a different person and is
    // not a conflict here.
    //
    // Session 6c.1 — a soft-deleted user under the same email is
    // NOT a collision: the operator's intent in re-inviting is to
    // restore access for someone who was previously deactivated,
    // and we want that to be a one-click workflow. The compound
    // unique index `(schoolId, email)` still applies, so when the
    // invitation is later accepted the row creation will need to
    // either re-use the existing User id (the cleaner future
    // direction) or hit the same constraint — that's a Phase 2 UX
    // concern, not a Phase 1 audit one. The check here only
    // gates whether to surface the collision to the operator.
    const existingUser = await this.prisma.user.findUnique({
      where: {
        schoolId_email: { schoolId: input.schoolId, email },
      },
      select: { id: true, deletedAt: true },
    });
    if (existingUser && existingUser.deletedAt === null) {
      throw new ConflictException(
        'An account with this email already exists at this school. Reset the password instead of re-inviting.',
      );
    }

    const expiresAt = new Date(
      Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60_000,
    );

    // Resend path.
    const existing = await this.prisma.userInvitation.findUnique({
      where: { schoolId_email: { schoolId: input.schoolId, email } },
    });
    if (existing && !existing.acceptedAt) {
      const refreshed = await this.prisma.userInvitation.update({
        where: { id: existing.id },
        data: {
          expiresAt,
          revokedAt: null,
          role: input.role,
          displayName: input.displayName ?? existing.displayName,
        },
      });
      await this.sendInviteEmail(refreshed);
      this.logger.log(
        `[invitations] resent invitation id=${refreshed.id} email=${email}`,
      );
      return toRow(refreshed);
    }

    // Fresh invite.
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const created = await this.prisma.userInvitation.create({
      data: {
        schoolId: input.schoolId,
        email,
        role: input.role,
        token,
        expiresAt,
        invitedById: input.invitedById,
        displayName: input.displayName ?? null,
      },
    });
    await this.sendInviteEmail(created);
    this.logger.log(
      `[invitations] created invitation id=${created.id} email=${email} role=${input.role}`,
    );
    return toRow(created);
  }

  /** List a school's outstanding + recent invitations. */
  async listForSchool(schoolId: string): Promise<InvitationRow[]> {
    const rows = await this.prisma.userInvitation.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toRow);
  }

  /** Operator revokes a pending invitation. Idempotent. */
  async revoke(input: { invitationId: string; schoolId: string }): Promise<InvitationRow> {
    const inv = await this.prisma.userInvitation.findUnique({
      where: { id: input.invitationId },
    });
    if (!inv || inv.schoolId !== input.schoolId) {
      throw new NotFoundException('Invitation not found.');
    }
    if (inv.acceptedAt) {
      throw new ConflictException(
        'Invitation has already been accepted — cannot revoke.',
      );
    }
    if (inv.revokedAt) return toRow(inv);
    const updated = await this.prisma.userInvitation.update({
      where: { id: inv.id },
      data: { revokedAt: new Date() },
    });
    return toRow(updated);
  }

  /**
   * Accept the invitation. Looks the row up by token (constant-
   * time-ish via DB index), verifies it's pending + not expired +
   * not revoked, then provisions the User in the same transaction
   * that flips `acceptedAt`. Idempotent only on the optimistic
   * happy path — second attempts surface 409.
   */
  async accept(input: {
    token: string;
    password: string;
    displayName?: string;
  }): Promise<AcceptResult> {
    const inv = await this.prisma.userInvitation.findUnique({
      where: { token: input.token },
    });
    if (!inv) {
      throw new NotFoundException('Invitation not found.');
    }
    if (inv.acceptedAt) {
      throw new ConflictException(
        'Invitation has already been accepted. Sign in normally.',
      );
    }
    if (inv.revokedAt) {
      throw new ConflictException('Invitation has been revoked.');
    }
    if (inv.expiresAt.getTime() < Date.now()) {
      throw new ConflictException(
        'Invitation has expired. Ask your admin to send a new one.',
      );
    }
    if (input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }

    const hash = await this.hashing.hash(input.password);
    const created = await this.prisma.$transaction(async (tx) => {
      // Re-check inside the txn to avoid TOCTOU on a parallel accept.
      const fresh = await tx.userInvitation.findUnique({
        where: { id: inv.id },
      });
      if (!fresh || fresh.acceptedAt) {
        throw new ConflictException(
          'Invitation has already been accepted. Sign in normally.',
        );
      }

      const user = await tx.user.create({
        data: {
          email: inv.email,
          password: hash,
          role: inv.role,
          schoolId: inv.schoolId,
        },
      });

      // If TEACHER, create a Teacher profile shell so the user can
      // navigate the dashboard immediately. School admin assigns
      // them to classes/sections later. Teacher schema uses a single
      // `name` column.
      if (inv.role === 'TEACHER') {
        await tx.teacher.create({
          data: {
            userId: user.id,
            schoolId: inv.schoolId,
            name: (input.displayName ?? inv.displayName ?? inv.email).trim(),
          },
        });
      }

      const updatedInv = await tx.userInvitation.update({
        where: { id: inv.id },
        data: {
          acceptedAt: new Date(),
          acceptedUserId: user.id,
          displayName: input.displayName ?? inv.displayName,
        },
      });
      return { user, invitation: updatedInv };
    });

    this.logger.log(
      `[invitations] accepted invitation id=${created.invitation.id} userId=${created.user.id}`,
    );

    return {
      user: {
        id: created.user.id,
        email: created.user.email,
        role: created.user.role,
        schoolId: created.user.schoolId,
      },
      invitation: toRow(created.invitation),
    };
  }

  /**
   * Read-only token preview — surfaced to the accept-page UI so the
   * recipient sees "you've been invited to X school as TEACHER"
   * BEFORE submitting their password. Returns null when the token
   * isn't valid (404 from the controller).
   */
  async preview(token: string): Promise<{
    schoolName: string;
    schoolSlug: string;
    email: string;
    role: Role;
    displayName: string | null;
    expiresAt: string;
    isPending: boolean;
  } | null> {
    const inv = await this.prisma.userInvitation.findUnique({
      where: { token },
      include: { school: { select: { name: true, slug: true } } },
    });
    if (!inv) return null;
    return {
      schoolName: inv.school.name,
      schoolSlug: inv.school.slug,
      email: inv.email,
      role: inv.role,
      displayName: inv.displayName,
      expiresAt: inv.expiresAt.toISOString(),
      isPending: !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > new Date(),
    };
  }

  // -------------------------------------------------------------------------
  // Email side
  // -------------------------------------------------------------------------

  private async sendInviteEmail(inv: UserInvitation): Promise<void> {
    const appUrl = this.config.get<string>('appUrl') ?? 'http://localhost:3000';
    const acceptUrl = `${appUrl.replace(/\/$/, '')}/invitations/accept?token=${encodeURIComponent(inv.token)}`;
    const brand = this.config.get<{
      productName: string;
      supportEmail: string;
      logoUrl?: string;
      footerAddress?: string;
    }>('mail.brand') ?? {
      productName: 'Scholaris',
      supportEmail: 'support@scholaris.local',
    };

    try {
      await this.notifications.enqueue({
        templateKey: 'staff.invitation',
        recipients: { email: inv.email },
        payload: {
          brand,
          acceptUrl,
          email: inv.email,
          role: inv.role,
          displayName: inv.displayName,
          expiresAt: inv.expiresAt.toISOString(),
        },
        dedupeKey: `inv:${inv.id}:${inv.expiresAt.toISOString()}`,
        schoolId: inv.schoolId,
        title: `You're invited to join ${brand.productName}`,
      });
    } catch (e) {
      // The invitation persists; the email failed. Operator can
      // resend. Log the failure but don't surface to the caller —
      // the invite was created successfully.
      this.logger.error(
        `Failed to send invitation email id=${inv.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

function toRow(inv: UserInvitation): InvitationRow {
  return {
    id: inv.id,
    schoolId: inv.schoolId,
    email: inv.email,
    role: inv.role,
    displayName: inv.displayName,
    expiresAt: inv.expiresAt.toISOString(),
    acceptedAt: inv.acceptedAt?.toISOString() ?? null,
    revokedAt: inv.revokedAt?.toISOString() ?? null,
    invitedById: inv.invitedById,
    acceptedUserId: inv.acceptedUserId,
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
    isPending:
      !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > new Date(),
  };
}

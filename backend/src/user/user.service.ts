import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformAuditAction, Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuditService } from '../platform/platform-audit.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

export interface UserListRow {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

/**
 * Shape of the response returned by the soft-delete endpoint. Mirrors
 * `UserListRow` plus the freshly-set `deletedAt` timestamp so the
 * client can reflect the state transition without a follow-up GET.
 */
export interface DeactivatedUserRow extends UserListRow {
  deletedAt: string;
}

/**
 * Actor descriptor for audit-emitting user mutations. Captured at the
 * controller boundary (JWT claims + request headers) and passed through
 * so the audit row carries who/where the action came from. Mirrors
 * `StudentActor` in StudentService for consistency.
 */
export interface UserActor {
  id: string;
  email: string;
  role: Role;
  schoolId: string;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * List every user in the caller's school.
   *
   * Sort order: `role ASC, createdAt ASC`.
   *
   * Postgres sorts native enums by DECLARATION order, not alphabetically.
   * `Role` is declared `ADMIN → TEACHER → STUDENT → PARENT`, so ASC puts
   * the most-privileged roles first — admins surface immediately, which
   * matches how the Settings UI is consumed (admins are who you usually
   * want to act on first). Within each role, oldest-first keeps the
   * order stable across reloads.
   */
  async list(schoolId: string): Promise<UserListRow[]> {
    // Hide orphan TEACHER users — those whose Teacher profile was
    // deleted on its own (before the cascade-via-User fix landed)
    // and now sit in the DB as dead logins:
    //   • role = TEACHER
    //   • teacher relation = null
    //   • can't actually sign in (login hard-guard rejects them)
    //
    // Surfacing them in Settings → Users & roles caused real
    // confusion ("I deleted that teacher already, why are they
    // still here?"). We pull the relation, then filter in JS so
    // the query stays portable; with a school's user count this
    // is in the tens-to-hundreds range, the post-filter is free.
    //
    // Going forward `TeacherService.remove()` deletes via the User
    // row (which cascade-deletes the Teacher), so no NEW orphans
    // are created. This filter just cleans up the historical mess.
    //
    // Session 6c.1: soft-deleted users are excluded — the row stays
    // in the DB to preserve FK history but never surfaces in the
    // active-workflow Settings list.
    const rows = await this.prisma.user.findMany({
      where: {
        schoolId,
        deletedAt: null,
        // Platform-tier rows (SUPER_ADMIN) are scoped to a school
        // for FK reasons but never appear in school user-management.
        // Filtering at the read path is sufficient because no school-
        // side write path can create one (registration only mints
        // ADMIN; the user-create endpoint constrains role to
        // ADMIN/STAFF/TEACHER).
        role: { not: Role.SUPER_ADMIN },
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        teacher: { select: { id: true } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows
      .filter((r) => r.role !== Role.TEACHER || r.teacher !== null)
      .map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));
  }

  /**
   * Promote / demote a user between ADMIN and TEACHER.
   *
   * Two layered safety guards:
   *   1. Self-demotion guard — an admin can never demote themselves
   *      to TEACHER through this endpoint. Even if other admins exist,
   *      we require a *different* admin to perform the demotion. This
   *      prevents accidental lockout from a misclick on your own row.
   *   2. Last-admin guard — refuses any demotion that would leave the
   *      school with zero admins.
   */
  async updateRole(
    targetUserId: string,
    dto: UpdateUserRoleDto,
    schoolId: string,
    actorUserId: string,
  ): Promise<UserListRow> {
    // Self-demotion guard runs first so the actor gets the clearer
    // message ("you cannot change your own role") instead of falling
    // through to the more general last-admin error.
    if (targetUserId === actorUserId && dto.role === Role.TEACHER) {
      throw new BadRequestException('You cannot change your own role');
    }

    // Session 6c.1 — soft-deleted users are not editable. The
    // dedicated soft-delete endpoint is the only way they reach this
    // state, and there's no "reactivate" surface yet; treating them
    // as 404 mirrors the list endpoint's "they don't exist anymore"
    // posture and keeps the role-edit flow clean.
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, schoolId, deletedAt: null },
      select: { id: true, email: true, role: true },
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }

    // No-op: don't bother writing if the role is already what was asked.
    if (target.role === dto.role) {
      const fresh = await this.prisma.user.findUniqueOrThrow({
        where: { id: targetUserId },
        select: {
          id: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return {
        id: fresh.id,
        email: fresh.email,
        role: fresh.role,
        createdAt: fresh.createdAt.toISOString(),
        updatedAt: fresh.updatedAt.toISOString(),
      };
    }

    // Last-admin guard: if we're demoting an admin, make sure there's
    // at least one OTHER admin left in the school after this change.
    // The "other admins" count excludes soft-deleted rows — a deleted
    // admin can't log in, so they don't count toward the floor.
    if (target.role === Role.ADMIN && dto.role !== Role.ADMIN) {
      const otherAdmins = await this.prisma.user.count({
        where: {
          schoolId,
          role: Role.ADMIN,
          deletedAt: null,
          NOT: { id: target.id },
        },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException(
          'Cannot demote the last admin. Promote another user to ADMIN first.',
        );
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { role: dto.role },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Session 6c.1 — soft-delete a user.
   *
   * Authorization (enforced inside the service so the rule is
   * uniform across any future caller, not only the HTTP route):
   *   • SUPER_ADMIN may delete any user in any school.
   *   • School ADMIN may delete users in their OWN school only.
   *   • Self-deletion is always refused (lockout-safety).
   *
   * Refusal conditions:
   *   • 404 — target id does not exist.
   *   • 409 — target already soft-deleted (idempotent re-attempt
   *     deliberately surfaces rather than silently no-op'ing; the
   *     operator's intent was "delete an active user" and the row
   *     is already inactive).
   *   • 409 — target has active TeachingAssignments and the school's
   *     current academic session is unlocked. Assignments must be
   *     cleared before deletion to avoid orphaning marks-entry /
   *     roster routes that depend on the assignment join. When the
   *     current session is locked (read-only year-end window) the
   *     check is bypassed: assignments are frozen anyway.
   *   • 403 — actor lacks the authority to delete this target.
   *
   * Audit: emits `USER_DEACTIVATED` to the platform audit feed,
   * tenant-anchored to the TARGET's schoolId (the school where the
   * user lived, not the actor's school — important for SUPER_ADMIN
   * deletions, which would otherwise misroute to the platform
   * tenant).
   *
   * Transaction discipline note: the User row update and the audit
   * emit are NOT wrapped in a single `$transaction`. The audit
   * service intentionally swallows write errors (see
   * `PlatformAuditService.record`) so the user-facing action never
   * fails on an audit hiccup; this matches the StudentService
   * archive/restore pattern. The trade-off is a window where the
   * user is deleted but the audit row is missing — surfaced via
   * Logger.error in `record()` and intended for the Phase 9 DLQ.
   */
  async softDelete(
    targetUserId: string,
    actor: UserActor,
  ): Promise<DeactivatedUserRow> {
    // Self-deletion guard runs first — clearer message + cheaper than
    // chasing the row through the lookup path.
    if (targetUserId === actor.id) {
      throw new ForbiddenException('You cannot delete your own account.');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        role: true,
        schoolId: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }

    // Already-deactivated check before authorization: a SUPER_ADMIN
    // hitting a soft-deleted user gets the more specific message
    // rather than falling through to a forbidden case that doesn't
    // apply.
    if (target.deletedAt !== null) {
      throw new ConflictException('User is already deactivated.');
    }

    // Authorization — locked design decision: SUPER_ADMIN anywhere,
    // school ADMIN within their own tenant only.
    const isSuperAdmin = actor.role === Role.SUPER_ADMIN;
    const isSameSchoolAdmin =
      actor.role === Role.ADMIN && actor.schoolId === target.schoolId;
    if (!isSuperAdmin && !isSameSchoolAdmin) {
      throw new ForbiddenException('You cannot delete this user.');
    }

    // Active TeachingAssignments check.
    //
    // TeachingAssignment is NOT session-scoped (no sessionId column);
    // its rows represent the always-current teacher → class/subject
    // wiring. The spec's "AND session is active (NOT locked)" gate
    // therefore maps to a school-level precondition: if the school's
    // active academic session is locked (read-only year-end window),
    // assignments are frozen and deletion proceeds. Otherwise any
    // assignment row blocks deletion.
    //
    // The teacher lookup is by userId — non-teachers (ADMIN, STAFF)
    // have no Teacher row and skip the count entirely.
    const teacher = await this.prisma.teacher.findUnique({
      where: { userId: target.id },
      select: { id: true },
    });
    let activeAssignments = 0;
    if (teacher) {
      const activeSession = await this.prisma.academicSession.findFirst({
        where: {
          schoolId: target.schoolId,
          isActive: true,
          isLocked: false,
        },
        select: { id: true },
      });
      if (activeSession) {
        activeAssignments = await this.prisma.teachingAssignment.count({
          where: { teacherId: teacher.id },
        });
      }
    }
    if (activeAssignments > 0) {
      throw new ConflictException(
        `This user has ${activeAssignments} active teaching assignments. Unassign them before deletion.`,
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { deletedAt: new Date() },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });

    await this.audit.record({
      action: PlatformAuditAction.USER_DEACTIVATED,
      schoolId: target.schoolId,
      actor: {
        userId: actor.id,
        email: actor.email,
        role: actor.role,
      },
      target: {
        type: 'User',
        id: updated.id,
        label: updated.email,
      },
      before: { deletedAt: null },
      after: { deletedAt: updated.deletedAt },
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });

    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      // updated.deletedAt is non-null by construction — we just set it
      // — but TS doesn't narrow through the Prisma select projection,
      // so the `!` is a documented invariant rather than a hope.
      deletedAt: updated.deletedAt!.toISOString(),
    };
  }
}

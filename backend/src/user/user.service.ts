import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

export interface UserListRow {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

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
    const rows = await this.prisma.user.findMany({
      where: {
        schoolId,
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

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, schoolId },
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
    if (target.role === Role.ADMIN && dto.role !== Role.ADMIN) {
      const otherAdmins = await this.prisma.user.count({
        where: { schoolId, role: Role.ADMIN, NOT: { id: target.id } },
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
}

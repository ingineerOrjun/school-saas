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
    const rows = await this.prisma.user.findMany({
      where: { schoolId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({
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

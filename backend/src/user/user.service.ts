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
   * List every user in the caller's school. Sorted with admins first
   * so the most-privileged accounts surface immediately, then by
   * creation order (oldest first) for stable rendering.
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
   * Promote / demote a user between ADMIN and TEACHER. Refuses to
   * demote the last admin in a school — that would lock everyone out
   * of admin functions. The caller's own demotion is allowed only when
   * another admin already exists.
   */
  async updateRole(
    targetUserId: string,
    dto: UpdateUserRoleDto,
    schoolId: string,
  ): Promise<UserListRow> {
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

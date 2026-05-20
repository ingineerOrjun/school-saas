import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PlatformAuditAction, Role } from '@prisma/client';
import { UserService, type UserActor } from './user.service';
import type { PrismaService } from '../database/prisma.service';
import type { PlatformAuditService } from '../platform/platform-audit.service';

// ============================================================================
// UserService.softDelete — Session 6c.1 behavioural contract.
//
// Coverage:
//   1. SUPER_ADMIN can soft-delete a user in any school.
//   2. School ADMIN can soft-delete a user in their OWN school.
//   3. School ADMIN CANNOT soft-delete a user in another school (403).
//   4. Self-deletion is refused (403) before any DB read.
//   5. Already-deactivated user → 409 with the specific message.
//   6. User with active TeachingAssignments + unlocked session → 409
//      with the count in the message.
//   7. Active assignments are IGNORED when the school's session is
//      locked (read-only year-end window) — deletion proceeds.
//   8. Audit emit lands with `USER_DEACTIVATED`, tenant-anchored to
//      the TARGET's schoolId, label = target email, before/after JSON
//      carries the deletedAt transition.
//   9. The active-list query path (list / updateRole / count) filters
//      out soft-deleted rows.
//
// PrismaService is shape-mocked. PlatformAuditService is a stub. No
// real DB, no real transactions; the service-level contract is what
// we're locking in.
// ============================================================================

interface UserRow {
  id: string;
  email: string;
  role: Role;
  schoolId: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  teacher?: { id: string } | null;
}

interface MockPrisma {
  user: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  teacher: { findUnique: jest.Mock };
  academicSession: { findFirst: jest.Mock };
  teachingAssignment: { count: jest.Mock };
}

function makeMockPrisma(): MockPrisma {
  return {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    teacher: { findUnique: jest.fn() },
    academicSession: { findFirst: jest.fn() },
    teachingAssignment: { count: jest.fn() },
  };
}

function makeService(prisma: MockPrisma) {
  const audit = { record: jest.fn().mockResolvedValue('audit-row-id') };
  const svc = new UserService(
    prisma as unknown as PrismaService,
    audit as unknown as PlatformAuditService,
  );
  return { svc, audit };
}

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'target-1',
    email: 'target@school-a.test',
    role: Role.TEACHER,
    schoolId: 'school-a',
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const SUPER_ADMIN_ACTOR: UserActor = {
  id: 'super-1',
  email: 'op@platform.test',
  role: Role.SUPER_ADMIN,
  schoolId: 's-platform',
  ip: '127.0.0.1',
  userAgent: 'jest',
};

const SCHOOL_A_ADMIN_ACTOR: UserActor = {
  id: 'admin-a',
  email: 'admin-a@school-a.test',
  role: Role.ADMIN,
  schoolId: 'school-a',
  ip: '127.0.0.1',
  userAgent: 'jest',
};

const SCHOOL_B_ADMIN_ACTOR: UserActor = {
  id: 'admin-b',
  email: 'admin-b@school-b.test',
  role: Role.ADMIN,
  schoolId: 'school-b',
  ip: '127.0.0.1',
  userAgent: 'jest',
};

describe('UserService.softDelete', () => {
  describe('happy path', () => {
    it('SUPER_ADMIN deletes a user in any school; stamps deletedAt + emits USER_DEACTIVATED', async () => {
      const prisma = makeMockPrisma();
      const target = makeUser({ schoolId: 'school-a' });
      prisma.user.findUnique.mockResolvedValueOnce(target);
      prisma.teacher.findUnique.mockResolvedValueOnce(null); // not a teacher
      const deletedAt = new Date('2026-05-19T12:00:00Z');
      prisma.user.update.mockResolvedValueOnce({
        id: target.id,
        email: target.email,
        role: target.role,
        createdAt: target.createdAt,
        updatedAt: new Date(),
        deletedAt,
      });

      const { svc, audit } = makeService(prisma);
      const result = await svc.softDelete(target.id, SUPER_ADMIN_ACTOR);

      // Write lands with deletedAt set.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: target.id },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(result.deletedAt).toBe(deletedAt.toISOString());

      // Audit row is tenant-anchored to the TARGET's schoolId (not
      // the SUPER_ADMIN's platform schoolId) so the school-side
      // audit feed picks it up.
      expect(audit.record).toHaveBeenCalledTimes(1);
      const call = audit.record.mock.calls[0][0];
      expect(call.action).toBe(PlatformAuditAction.USER_DEACTIVATED);
      expect(call.schoolId).toBe('school-a');
      expect(call.actor.userId).toBe(SUPER_ADMIN_ACTOR.id);
      expect(call.target.type).toBe('User');
      expect(call.target.id).toBe(target.id);
      expect(call.target.label).toBe(target.email);
      expect(call.before).toEqual({ deletedAt: null });
      expect(call.after).toEqual({ deletedAt });
    });

    it('school ADMIN deletes a user in their own school', async () => {
      const prisma = makeMockPrisma();
      const target = makeUser({ schoolId: 'school-a' });
      prisma.user.findUnique.mockResolvedValueOnce(target);
      prisma.teacher.findUnique.mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValueOnce({
        id: target.id,
        email: target.email,
        role: target.role,
        createdAt: target.createdAt,
        updatedAt: new Date(),
        deletedAt: new Date(),
      });
      const { svc } = makeService(prisma);

      await expect(
        svc.softDelete(target.id, SCHOOL_A_ADMIN_ACTOR),
      ).resolves.toMatchObject({ id: target.id });
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('authorization', () => {
    it('school ADMIN CANNOT delete across schools (403)', async () => {
      const prisma = makeMockPrisma();
      // Target lives in school-a; the actor is school-b's admin.
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ schoolId: 'school-a' }),
      );
      const { svc } = makeService(prisma);

      await expect(
        svc.softDelete('target-1', SCHOOL_B_ADMIN_ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses self-deletion before any DB read (403)', async () => {
      const prisma = makeMockPrisma();
      const { svc } = makeService(prisma);

      // actor.id === target id → 403 short-circuit
      await expect(
        svc.softDelete(SCHOOL_A_ADMIN_ACTOR.id, SCHOOL_A_ADMIN_ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Lookup never even runs.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    // TEACHER / STAFF rejection lives on the controller decorator
    // stack (`@Roles(SUPER_ADMIN, ADMIN)`) — a token from either of
    // those roles never reaches the service. The contract is
    // tested at the guard layer; documenting it here with `it.todo`
    // keeps the spec's coverage list in the test output without
    // pretending the service exercises the rule.
    it.todo('TEACHER role → 403 (enforced by RolesGuard at controller layer)');
    it.todo('STAFF role → 403 (enforced by RolesGuard at controller layer)');
  });

  describe('refusal conditions', () => {
    it('returns 404 when the target id does not exist', async () => {
      const prisma = makeMockPrisma();
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const { svc } = makeService(prisma);

      await expect(
        svc.softDelete('ghost', SUPER_ADMIN_ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 409 when the user is already soft-deleted', async () => {
      const prisma = makeMockPrisma();
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ deletedAt: new Date('2026-01-01') }),
      );
      const { svc } = makeService(prisma);

      const promise = svc.softDelete('target-1', SUPER_ADMIN_ACTOR);
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow('User is already deactivated.');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('returns 409 with the count when the user has active TeachingAssignments and the session is unlocked', async () => {
      const prisma = makeMockPrisma();
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ role: Role.TEACHER }),
      );
      prisma.teacher.findUnique.mockResolvedValueOnce({ id: 'teacher-1' });
      prisma.academicSession.findFirst.mockResolvedValueOnce({
        id: 'session-1',
      });
      prisma.teachingAssignment.count.mockResolvedValueOnce(2);
      const { svc } = makeService(prisma);

      const promise = svc.softDelete('target-1', SUPER_ADMIN_ACTOR);
      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow(
        'This user has 2 active teaching assignments. Unassign them before deletion.',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('IGNORES active assignments when the school session is locked (year-end window)', async () => {
      // Locked session = frozen assignments = deletion proceeds.
      // Mirrors the spec deviation: TeachingAssignment has no
      // sessionId so we gate the count on the school-active session
      // being unlocked.
      const prisma = makeMockPrisma();
      const target = makeUser({ role: Role.TEACHER });
      prisma.user.findUnique.mockResolvedValueOnce(target);
      prisma.teacher.findUnique.mockResolvedValueOnce({ id: 'teacher-1' });
      // No active+unlocked session matches — findFirst returns null.
      prisma.academicSession.findFirst.mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValueOnce({
        id: target.id,
        email: target.email,
        role: target.role,
        createdAt: target.createdAt,
        updatedAt: new Date(),
        deletedAt: new Date(),
      });
      const { svc } = makeService(prisma);

      await expect(
        svc.softDelete('target-1', SUPER_ADMIN_ACTOR),
      ).resolves.toMatchObject({ id: target.id });
      // Count was never called — the gate short-circuited.
      expect(prisma.teachingAssignment.count).not.toHaveBeenCalled();
    });

    it('skips the TeachingAssignment check for non-teacher users (no Teacher row)', async () => {
      const prisma = makeMockPrisma();
      const target = makeUser({ role: Role.ADMIN });
      prisma.user.findUnique.mockResolvedValueOnce(target);
      prisma.teacher.findUnique.mockResolvedValueOnce(null); // not a teacher
      prisma.user.update.mockResolvedValueOnce({
        id: target.id,
        email: target.email,
        role: target.role,
        createdAt: target.createdAt,
        updatedAt: new Date(),
        deletedAt: new Date(),
      });
      const { svc } = makeService(prisma);

      await expect(
        svc.softDelete('target-1', SUPER_ADMIN_ACTOR),
      ).resolves.toBeDefined();
      // Session + count never queried for non-teachers.
      expect(prisma.academicSession.findFirst).not.toHaveBeenCalled();
      expect(prisma.teachingAssignment.count).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// UserService.list / updateRole — active-list query filter coverage.
//
// Locks in the Step 3B filter rule for the home-module read paths:
//   • list() must filter `deletedAt: null`.
//   • updateRole() must filter `deletedAt: null` when finding the
//     target (so a soft-deleted user appears as 404).
//   • The last-admin count must filter `deletedAt: null` (a deleted
//     admin doesn't count toward the floor).
// ============================================================================

describe('UserService.list', () => {
  it('passes deletedAt: null in the where clause', async () => {
    const prisma = makeMockPrisma();
    prisma.user.findMany.mockResolvedValueOnce([]);
    const { svc } = makeService(prisma);

    await svc.list('school-a');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: 'school-a',
          deletedAt: null,
        }),
      }),
    );
  });
});

describe('UserService.updateRole', () => {
  it('treats a soft-deleted user as 404 (target findFirst filters deletedAt: null)', async () => {
    const prisma = makeMockPrisma();
    // Filter shape means the soft-deleted row is filtered out → null.
    prisma.user.findFirst.mockResolvedValueOnce(null);
    const { svc } = makeService(prisma);

    await expect(
      svc.updateRole(
        'soft-deleted-id',
        { role: Role.TEACHER },
        'school-a',
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
  });

  it('counts other admins with deletedAt: null when guarding last-admin demotion', async () => {
    const prisma = makeMockPrisma();
    // findFirst returns the target — an active ADMIN.
    prisma.user.findFirst.mockResolvedValueOnce({
      id: 'target-1',
      email: 'admin@school.test',
      role: Role.ADMIN,
    });
    // Demoting to TEACHER → last-admin guard fires → count.
    prisma.user.count.mockResolvedValueOnce(0);
    const { svc } = makeService(prisma);

    await expect(
      svc.updateRole(
        'target-1',
        { role: Role.TEACHER },
        'school-a',
        'actor-different',
      ),
    ).rejects.toThrow(
      'Cannot demote the last admin. Promote another user to ADMIN first.',
    );
    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: 'school-a',
          role: Role.ADMIN,
          deletedAt: null,
        }),
      }),
    );
  });
});

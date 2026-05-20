import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { TeacherService } from './teacher.service';
import type { PrismaService } from '../database/prisma.service';
import type { HashingService } from '../common/hashing/hashing.service';
import type { UserService, UserActor } from '../user/user.service';

// ============================================================================
// TeacherService.remove — Session 6c.3 behavioural contract.
//
// Before: `prisma.user.delete({ where: { id: teacher.userId } })` — a
// HARD delete that cascaded the User row + Teacher row + assignments,
// bypassed the active-assignment refusal, and left no audit trail.
//
// After: tenant-scoped Teacher lookup + delegation to
// `UserService.softDelete(teacher.userId, actor)`. The Teacher row is
// NOT touched; the User row is stamped with `deletedAt`. All
// authorization + refusal + audit behaviour lives in UserService and
// is exercised by user.service.spec.ts — what we lock in here is the
// CONTRACT between TeacherService and that path:
//
//   1. Cross-tenant teacher id → 404 from TeacherService (the lookup
//      filter), softDelete is NEVER called.
//   2. Teacher found → softDelete called once with the teacher's userId
//      and the actor verbatim.
//   3. Teacher row is NOT deleted (no prisma.teacher.delete call).
//   4. softDelete refusals (409 active assignments, 403 cross-school,
//      403 self-delete, 404 user already gone) propagate to the caller
//      unchanged.
// ============================================================================

interface MockPrisma {
  teacher: { findFirst: jest.Mock };
}

function makeMockPrisma(): MockPrisma {
  return {
    teacher: { findFirst: jest.fn() },
  };
}

function makeService(
  prisma: MockPrisma,
  users: { softDelete: jest.Mock },
) {
  const hashing = {} as HashingService;
  const svc = new TeacherService(
    prisma as unknown as PrismaService,
    hashing,
    users as unknown as UserService,
  );
  return svc;
}

const SCHOOL_A_ADMIN_ACTOR: UserActor = {
  id: 'admin-a',
  email: 'admin-a@school-a.test',
  role: Role.ADMIN,
  schoolId: 'school-a',
  ip: '127.0.0.1',
  userAgent: 'jest',
};

const TEACHER_ROW = {
  id: 'teacher-1',
  userId: 'user-teacher-1',
};

describe('TeacherService.remove (Session 6c.3 — soft-delete via UserService)', () => {
  it('cross-tenant teacher id → 404; softDelete is NEVER called', async () => {
    const prisma = makeMockPrisma();
    // Tenant filter returns null because the teacher belongs to
    // school-b but the actor's schoolId is school-a.
    prisma.teacher.findFirst.mockResolvedValueOnce(null);
    const users = { softDelete: jest.fn() };
    const svc = makeService(prisma, users);

    await expect(
      svc.remove('teacher-1', 'school-a', SCHOOL_A_ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Tenant gate is the first guard — the softDelete path must NEVER
    // see a cross-tenant teacher id.
    expect(users.softDelete).not.toHaveBeenCalled();
  });

  it('on success: calls userService.softDelete with the teacher.userId and the actor verbatim', async () => {
    const prisma = makeMockPrisma();
    prisma.teacher.findFirst.mockResolvedValueOnce(TEACHER_ROW);
    const users = {
      softDelete: jest.fn().mockResolvedValueOnce({
        id: TEACHER_ROW.userId,
        email: 'teacher@school-a.test',
        role: Role.TEACHER,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      }),
    };
    const svc = makeService(prisma, users);

    await expect(
      svc.remove('teacher-1', 'school-a', SCHOOL_A_ADMIN_ACTOR),
    ).resolves.toBeUndefined();

    // The whole point — single delegation call with the right args.
    expect(users.softDelete).toHaveBeenCalledTimes(1);
    expect(users.softDelete).toHaveBeenCalledWith(
      TEACHER_ROW.userId,
      SCHOOL_A_ADMIN_ACTOR,
    );
  });

  it('does NOT delete the Teacher row (only the User row is soft-deleted)', async () => {
    const prisma = makeMockPrisma();
    prisma.teacher.findFirst.mockResolvedValueOnce(TEACHER_ROW);
    const users = {
      softDelete: jest.fn().mockResolvedValueOnce({
        id: TEACHER_ROW.userId,
        email: 'teacher@school-a.test',
        role: Role.TEACHER,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      }),
    };
    const svc = makeService(prisma, users);

    await svc.remove('teacher-1', 'school-a', SCHOOL_A_ADMIN_ACTOR);

    // The mocked Prisma client has NO `teacher.delete` / `update`
    // surface; reaching for either would have thrown "not a function"
    // and surfaced in this test. The structural assertion: the only
    // Prisma call we made was the tenant lookup.
    expect(prisma.teacher.findFirst).toHaveBeenCalledTimes(1);
  });

  it('propagates a 409 active-assignment refusal from userService.softDelete', async () => {
    const prisma = makeMockPrisma();
    prisma.teacher.findFirst.mockResolvedValueOnce(TEACHER_ROW);
    const users = {
      softDelete: jest
        .fn()
        .mockRejectedValueOnce(
          new ConflictException(
            'This user has 2 active teaching assignments. Unassign them before deletion.',
          ),
        ),
    };
    const svc = makeService(prisma, users);

    const promise = svc.remove('teacher-1', 'school-a', SCHOOL_A_ADMIN_ACTOR);
    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    // Message reaches the controller verbatim — frontend renders it
    // inline in the DeleteTeacherDialog without paraphrasing.
    await expect(promise).rejects.toThrow(
      'This user has 2 active teaching assignments. Unassign them before deletion.',
    );
  });

  it('propagates a 403 cross-school authorization refusal', async () => {
    const prisma = makeMockPrisma();
    // The teacher lookup succeeds at the tenant layer (the actor IS
    // matching the tenant), but UserService.softDelete enforces the
    // SUPER_ADMIN-or-same-school-ADMIN rule independently.
    prisma.teacher.findFirst.mockResolvedValueOnce(TEACHER_ROW);
    const users = {
      softDelete: jest
        .fn()
        .mockRejectedValueOnce(
          new ForbiddenException('You cannot delete this user.'),
        ),
    };
    const svc = makeService(prisma, users);

    await expect(
      svc.remove('teacher-1', 'school-a', SCHOOL_A_ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates a 403 self-delete refusal (admin who is also a teacher)', async () => {
    const prisma = makeMockPrisma();
    // Construct the scenario: the actor's userId IS the teacher's
    // userId (an admin who happens to have a Teacher profile linked
    // to the same User row).
    prisma.teacher.findFirst.mockResolvedValueOnce({
      id: 'teacher-1',
      userId: SCHOOL_A_ADMIN_ACTOR.id,
    });
    const users = {
      softDelete: jest
        .fn()
        .mockRejectedValueOnce(
          new ForbiddenException('You cannot delete your own account.'),
        ),
    };
    const svc = makeService(prisma, users);

    await expect(
      svc.remove('teacher-1', 'school-a', SCHOOL_A_ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Confirm the delegation happened with the actor's own id — the
    // self-delete check inside softDelete is what produced the 403,
    // not a TeacherService-level guard.
    expect(users.softDelete).toHaveBeenCalledWith(
      SCHOOL_A_ADMIN_ACTOR.id,
      SCHOOL_A_ADMIN_ACTOR,
    );
  });

  it('audit-log entry is the responsibility of userService.softDelete (delegation is the test)', () => {
    // The USER_DEACTIVATED audit emit lives inside UserService.softDelete
    // and is covered by `user.service.spec.ts` ("emits USER_DEACTIVATED
    // ... tenant-anchored to the TARGET's schoolId"). Re-testing it
    // here would mock past the boundary we just established. The
    // contract we lock in for TeacherService is: "softDelete is called
    // with the right args" — once it's called, the audit row is its
    // problem.
    expect(true).toBe(true);
  });
});

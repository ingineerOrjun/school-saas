import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ImpersonationService } from './impersonation.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import type { PlatformAuditService } from './platform-audit.service';

// ---------------------------------------------------------------------------
// ImpersonationService — Phase 4 maturity tests.
//
// Focus: the security invariants the spec calls out explicitly.
// These rules are the difference between "operator support tool" and
// "lateral-movement attack surface":
//
//   • Only SUPER_ADMIN can start (defence-in-depth re-check).
//   • Cannot impersonate a peer SUPER_ADMIN.
//   • Cannot self-impersonate.
//   • Cannot start while already impersonating (no nesting).
//   • Cannot impersonate into a SUSPENDED / EXPIRED tenant.
//   • Audit row recorded on every successful start.
//   • Token payload carries the TARGET's id/role/schoolId, plus the
//     SUPER_ADMIN's id as `impersonatedBy`.
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  role: Role;
  schoolId: string;
  /**
   * Session 6c.1 — soft-delete timestamp. Defaults to null; the
   * "impersonation start refused for soft-deleted target" test
   * flips this to a Date.
   */
  deletedAt: Date | null;
  school?: {
    id: string;
    name: string;
    slug: string;
    status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'EXPIRED';
  };
}

function buildHarness() {
  const users = new Map<string, UserRow>();
  const auditCalls: Array<{
    action: string;
    actorId: string;
    targetId: string;
    label: string | null;
  }> = [];

  const prisma: Partial<PrismaService> = {
    user: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const u = users.get(where.id);
        if (!u) return null;
        if (include?.school) return u;
        return { ...u, school: undefined };
      }),
    } as any,
  };

  const jwt: Partial<JwtService> = {
    // Keep the cast loose — the real JwtService.sign has three
    // overloads we don't need to model in the mock.
    sign: jest.fn((payload: object) => `signed:${JSON.stringify(payload)}`) as any,
  };

  const config: Partial<ConfigService> = {
    get: jest.fn((key: string) => {
      if (key === 'auth.jwtExpiresIn') return '12h';
      return undefined;
    }),
  };

  const audit: Partial<PlatformAuditService> = {
    record: jest.fn(async (input: any) => {
      auditCalls.push({
        action: input.action,
        actorId: input.actor.userId,
        targetId: input.target.id,
        label: input.target.label ?? null,
      });
      return 'audit-id';
    }),
  };

  const service = new ImpersonationService(
    prisma as PrismaService,
    jwt as JwtService,
    config as ConfigService,
    audit as PlatformAuditService,
  );

  return { service, users, auditCalls, jwt: jwt as jest.Mocked<JwtService> };
}

const SUPER_ACTOR = {
  userId: 'super-1',
  email: 'op@platform',
  role: Role.SUPER_ADMIN,
  isAlreadyImpersonating: false,
};

const makeUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 'u-target',
  email: 'admin@school-a.edu',
  role: Role.ADMIN,
  schoolId: 's-1',
  deletedAt: null,
  school: {
    id: 's-1',
    name: 'School A',
    slug: 'school-a',
    status: 'ACTIVE',
  },
  ...overrides,
});

describe('ImpersonationService.start', () => {
  describe('security invariants', () => {
    it('REJECTS callers who are not SUPER_ADMIN', async () => {
      const h = buildHarness();
      h.users.set('u-target', makeUser());
      await expect(
        h.service.start({
          actor: { ...SUPER_ACTOR, role: Role.ADMIN },
          targetUserId: 'u-target',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('REJECTS impersonating another SUPER_ADMIN', async () => {
      const h = buildHarness();
      h.users.set('u-peer', makeUser({ role: Role.SUPER_ADMIN }));
      await expect(
        h.service.start({ actor: SUPER_ACTOR, targetUserId: 'u-peer' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('REJECTS self-impersonation', async () => {
      const h = buildHarness();
      h.users.set('super-1', makeUser({ id: 'super-1', role: Role.SUPER_ADMIN }));
      await expect(
        h.service.start({ actor: SUPER_ACTOR, targetUserId: 'super-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('REJECTS starting while already impersonating (no nesting)', async () => {
      const h = buildHarness();
      h.users.set('u-target', makeUser());
      await expect(
        h.service.start({
          actor: { ...SUPER_ACTOR, isAlreadyImpersonating: true },
          targetUserId: 'u-target',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each(['SUSPENDED', 'EXPIRED'] as const)(
      'REJECTS impersonating into a %s school',
      async (status) => {
        const h = buildHarness();
        h.users.set(
          'u-target',
          makeUser({
            school: {
              id: 's-1',
              name: 'School A',
              slug: 'school-a',
              status,
            },
          }),
        );
        await expect(
          h.service.start({
            actor: SUPER_ACTOR,
            targetUserId: 'u-target',
          }),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it('throws NotFoundException for an unknown target', async () => {
      const h = buildHarness();
      await expect(
        h.service.start({
          actor: SUPER_ACTOR,
          targetUserId: 'missing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('Session 6c.1: REJECTS impersonation start for a soft-deleted target (404)', async () => {
      const h = buildHarness();
      h.users.set(
        'u-target',
        makeUser({ deletedAt: new Date('2026-05-01') }),
      );
      await expect(
        h.service.start({
          actor: SUPER_ACTOR,
          targetUserId: 'u-target',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      // No token minted on a refused start.
      expect((h.jwt.sign as jest.Mock).mock.calls).toHaveLength(0);
      expect(h.auditCalls).toHaveLength(0);
    });
  });

  describe('happy path', () => {
    it('records an IMPERSONATION_STARTED audit row with target context', async () => {
      const h = buildHarness();
      h.users.set('u-target', makeUser());
      await h.service.start({
        actor: SUPER_ACTOR,
        targetUserId: 'u-target',
      });

      expect(h.auditCalls).toHaveLength(1);
      expect(h.auditCalls[0].action).toBe('IMPERSONATION_STARTED');
      expect(h.auditCalls[0].actorId).toBe('super-1');
      expect(h.auditCalls[0].targetId).toBe('u-target');
      // Label snapshot includes the school name for after-the-fact
      // readability.
      expect(h.auditCalls[0].label).toContain('School A');
      expect(h.auditCalls[0].label).toContain('admin@school-a.edu');
    });

    it('mints a token payload carrying the TARGET identity + impersonatedBy sentinel', async () => {
      const h = buildHarness();
      h.users.set('u-target', makeUser());
      await h.service.start({
        actor: SUPER_ACTOR,
        targetUserId: 'u-target',
      });

      expect(h.jwt.sign).toHaveBeenCalledTimes(1);
      const [payload] = (h.jwt.sign as jest.Mock).mock.calls[0];
      expect(payload.userId).toBe('u-target');
      expect(payload.role).toBe(Role.ADMIN);
      expect(payload.schoolId).toBe('s-1');
      expect(payload.impersonatedBy).toBe('super-1');
      expect(typeof payload.impersonationStartedAt).toBe('string');
    });

    it('returns a result with the school + target shape the client banner needs', async () => {
      const h = buildHarness();
      h.users.set('u-target', makeUser());
      const result = await h.service.start({
        actor: SUPER_ACTOR,
        targetUserId: 'u-target',
      });

      expect(result.user).toEqual({
        id: 'u-target',
        email: 'admin@school-a.edu',
        role: Role.ADMIN,
        schoolId: 's-1',
      });
      expect(result.school).toEqual({
        id: 's-1',
        name: 'School A',
        slug: 'school-a',
      });
      expect(typeof result.accessToken).toBe('string');
      expect(typeof result.startedAt).toBe('string');
    });
  });
});

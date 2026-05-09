import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { HashingService } from '../common/hashing/hashing.service';
import type { PrismaService } from '../database/prisma.service';
import type { HealthService } from '../health/health.service';
import type { NotificationService } from '../notifications/notification.service';

// ---------------------------------------------------------------------------
// AuthService.login — Phase 11 maturity tests.
//
// Focus on the security-critical branches:
//   • Bad password → 401, NO token issued, login failure recorded.
//   • Unknown email → 401, login failure recorded.
//   • SUSPENDED school → 400 with the suspension copy, login failure
//     recorded with reason="school_blocked" (not "invalid_credentials"
//     — the password WAS correct).
//   • EXPIRED school → same shape as SUSPENDED.
//   • SUPER_ADMIN at a SUSPENDED school → STILL allowed in (the
//     platform-wide bypass — operators must be able to log in to fix
//     a broken tenant).
//   • Healthy login → 200 + token + NO failure recorded.
//
// We mock all dependencies. The contract under test is the gate
// behaviour, not the JWT signing details (those have their own
// tests upstream in @nestjs/jwt).
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  password: string;
  role: Role;
  schoolId: string;
  school: {
    id: string;
    name: string;
    slug: string;
    status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'EXPIRED';
  };
  createdAt: Date;
  updatedAt: Date;
}

function buildHarness() {
  const users = new Map<string, UserRow>();
  const loginFailures: Array<{ email: string; ip: string | null; reason: string }> = [];

  const prisma: Partial<PrismaService> = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        for (const u of users.values()) {
          if (u.email === where.email) return u;
        }
        return null;
      }),
      create: jest.fn(),
    } as any,
    teacher: {
      findFirst: jest.fn(async () => null),
    } as any,
    school: {
      findUnique: jest.fn(),
    } as any,
    $transaction: jest.fn(),
  };

  const hashing: Partial<HashingService> = {
    hash: jest.fn(async (p: string) => `hashed:${p}`),
    compare: jest.fn(async (plain: string, hashed: string) => hashed === `hashed:${plain}`),
  };

  const jwt: Partial<JwtService> = {
    sign: jest.fn(() => 'signed-token'),
  };

  const health: Partial<HealthService> = {
    recordLoginFailure: jest.fn((evt: any) => {
      loginFailures.push(evt);
    }),
  };

  const notifications: Partial<NotificationService> = {
    enqueue: jest.fn(),
  };

  const config: Partial<ConfigService> = {
    get: jest.fn(() => undefined),
  };

  // Phase 17 follow-up — session creation is now part of login.
  // Mock returns a stable id so tests can assert the JWT carries a sid.
  const sessions = {
    create: jest.fn(async () => ({
      id: 'session-id',
      userId: 'u-1',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      ip: null,
      userAgent: null,
      revokedAt: null,
      revokedReason: null,
    })),
  } as any;

  const service = new AuthService(
    prisma as PrismaService,
    hashing as HashingService,
    jwt as JwtService,
    health as HealthService,
    notifications as NotificationService,
    config as ConfigService,
    sessions,
  );

  return { service, users, loginFailures };
}

const makeUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 'u-1',
  email: 'alice@example.edu',
  password: 'hashed:correct-pw',
  role: Role.ADMIN,
  schoolId: 's-1',
  school: {
    id: 's-1',
    name: 'School A',
    slug: 'school-a',
    status: 'ACTIVE',
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('AuthService.login', () => {
  describe('credential checks', () => {
    it('rejects unknown email with a generic 401 + records login failure', async () => {
      const h = buildHarness();
      await expect(
        h.service.login({ email: 'unknown@x', password: 'pw' }, '10.0.0.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.loginFailures).toHaveLength(1);
      expect(h.loginFailures[0]).toMatchObject({
        email: 'unknown@x',
        ip: '10.0.0.1',
        reason: 'invalid_credentials',
      });
    });

    it('rejects wrong password with the same 401 + records failure', async () => {
      const h = buildHarness();
      h.users.set('u-1', makeUser());
      await expect(
        h.service.login(
          { email: 'alice@example.edu', password: 'wrong' },
          '10.0.0.2',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.loginFailures).toHaveLength(1);
      expect(h.loginFailures[0].reason).toBe('invalid_credentials');
    });

    it('uses the SAME error message for unknown email and wrong password', async () => {
      const h = buildHarness();
      h.users.set('u-1', makeUser());
      let unknownMsg = '';
      let wrongMsg = '';
      try {
        await h.service.login({ email: 'unknown@x', password: 'pw' });
      } catch (e) {
        unknownMsg = (e as Error).message;
      }
      try {
        await h.service.login({
          email: 'alice@example.edu',
          password: 'wrong',
        });
      } catch (e) {
        wrongMsg = (e as Error).message;
      }
      // Critical: don't leak which side failed.
      expect(unknownMsg).toBe(wrongMsg);
    });
  });

  describe('tenant gate', () => {
    it.each(['SUSPENDED', 'EXPIRED'] as const)(
      'BLOCKS login when the school is %s — even with the right password',
      async (status) => {
        const h = buildHarness();
        h.users.set(
          'u-1',
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
          h.service.login(
            { email: 'alice@example.edu', password: 'correct-pw' },
            '10.0.0.5',
          ),
        ).rejects.toThrow();

        // The failure is recorded with reason="school_blocked" so the
        // health buffer can distinguish "credential stuffing" from
        // "operator suspended this tenant on purpose."
        expect(h.loginFailures).toHaveLength(1);
        expect(h.loginFailures[0].reason).toBe('school_blocked');
      },
    );

    it('ALLOWS a SUPER_ADMIN to log in even when their school row is SUSPENDED', async () => {
      // SUPER_ADMINs aren't tenant-bound — the gate is for tenants
      // only. The platform owner must be able to sign in to FIX a
      // suspended school.
      const h = buildHarness();
      h.users.set(
        'super-1',
        makeUser({
          id: 'super-1',
          email: 'op@platform',
          role: Role.SUPER_ADMIN,
          school: {
            id: 's-platform',
            name: 'Platform',
            slug: 'platform',
            status: 'SUSPENDED',
          },
        }),
      );

      const result = await h.service.login({
        email: 'op@platform',
        password: 'correct-pw',
      });

      expect(result.accessToken).toBeTruthy();
      expect(result.user.role).toBe(Role.SUPER_ADMIN);
      expect(h.loginFailures).toHaveLength(0);
    });
  });

  describe('happy path', () => {
    it('issues a token + does NOT record a failure on healthy login', async () => {
      const h = buildHarness();
      h.users.set('u-1', makeUser());
      const result = await h.service.login(
        { email: 'alice@example.edu', password: 'correct-pw' },
        '10.0.0.1',
      );
      expect(result.accessToken).toBe('signed-token');
      expect(result.user.email).toBe('alice@example.edu');
      expect(h.loginFailures).toHaveLength(0);
    });
  });
});

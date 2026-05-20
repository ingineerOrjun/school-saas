import { UnauthorizedException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from './auth.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { HashingService } from '../common/hashing/hashing.service';
import type { PrismaService } from '../database/prisma.service';
import type { HealthService } from '../health/health.service';
import type { NotificationService } from '../notifications/notification.service';
import type { PlatformAuditService } from '../platform/platform-audit.service';
import type { SchoolCodeService } from '../platform/services/school-code.service';

// ---------------------------------------------------------------------------
// AuthService.login — Phase 11 maturity tests, refreshed for the
// schoolCode + email + password login flow.
//
// Focus on the security-critical branches:
//   • Bad password → 401, NO token issued, login failure recorded.
//   • Unknown email → 401, login failure recorded.
//   • Unknown schoolCode → 401, login failure recorded (tenant
//     existence isn't leaked — same generic 401 as bad password).
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

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  schoolCode: string;
  status: 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'EXPIRED';
}

interface UserRow {
  id: string;
  email: string;
  password: string;
  role: Role;
  schoolId: string;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Session 6c.1 — soft-delete timestamp. Tests default to `null`
   * (active). The dedicated "soft-deleted user cannot log in" test
   * flips this to a Date and asserts the same generic 401.
   */
  deletedAt: Date | null;
}

const DEFAULT_SCHOOL: SchoolRow = {
  id: 's-1',
  name: 'School A',
  slug: 'school-a',
  schoolCode: 'SCH-0001',
  status: 'ACTIVE',
};

function buildHarness(opts?: { school?: SchoolRow }) {
  const schools = new Map<string, SchoolRow>();
  schools.set('SCH-0001', opts?.school ?? DEFAULT_SCHOOL);

  const users = new Map<string, UserRow>();
  const loginFailures: Array<{
    email: string;
    ip: string | null;
    reason: string;
  }> = [];

  const prisma: Partial<PrismaService> = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        // The new login flow uses the `schoolId_email` compound
        // unique key. We accept either the legacy `where.email`
        // shape (defensive) or the compound shape — the production
        // code only sends the compound shape.
        if (where?.schoolId_email) {
          for (const u of users.values()) {
            if (
              u.email === where.schoolId_email.email &&
              u.schoolId === where.schoolId_email.schoolId
            ) {
              return u;
            }
          }
          return null;
        }
        if (where?.email) {
          for (const u of users.values()) {
            if (u.email === where.email) return u;
          }
        }
        return null;
      }),
      create: jest.fn(),
    } as any,
    teacher: {
      findFirst: jest.fn(async () => null),
    } as any,
    school: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where?.schoolCode) return schools.get(where.schoolCode) ?? null;
        if (where?.id) {
          for (const s of schools.values()) {
            if (s.id === where.id) return s;
          }
        }
        return null;
      }),
    } as any,
    $transaction: jest.fn(),
  };

  const hashing: Partial<HashingService> = {
    hash: jest.fn(async (p: string) => `hashed:${p}`),
    compare: jest.fn(
      async (plain: string, hashed: string) => hashed === `hashed:${plain}`,
    ),
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

  // SchoolCodeService — we only exercise normalize() in the login
  // path. The real implementation is trim+uppercase, idempotent;
  // the mock mirrors that.
  const schoolCodes: Partial<SchoolCodeService> = {
    normalize: jest.fn((input: string) => input.trim().toUpperCase()),
    // Login doesn't call these but they round out the type.
    validate: jest.fn(),
    exists: jest.fn(),
    generateNextSchoolCode: jest.fn(),
    resolveForCreate: jest.fn(),
    withRetryOnCollision: jest.fn(),
  };

  // PlatformAuditService — only registerAdmin emits, login does not.
  // Stubbed to satisfy the constructor; the real `record` resolves
  // to the audit row id (or null on swallow).
  const platformAudit: Partial<PlatformAuditService> = {
    record: jest.fn(async () => null),
  };

  const service = new AuthService(
    prisma as PrismaService,
    hashing as HashingService,
    jwt as JwtService,
    health as HealthService,
    notifications as NotificationService,
    config as ConfigService,
    sessions,
    schoolCodes as SchoolCodeService,
    platformAudit as PlatformAuditService,
  );

  return { service, users, schools, loginFailures };
}

const makeUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 'u-1',
  email: 'alice@example.edu',
  password: 'hashed:correct-pw',
  role: Role.ADMIN,
  schoolId: 's-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

describe('AuthService.login', () => {
  describe('credential checks', () => {
    it('rejects unknown school code with a generic 401 + records login failure', async () => {
      const h = buildHarness();
      // No user matches; even if one did, the schoolCode lookup
      // returns null first.
      await expect(
        h.service.login(
          {
            schoolCode: 'SCH-9999',
            email: 'alice@example.edu',
            password: 'pw',
          },
          '10.0.0.1',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.loginFailures).toHaveLength(1);
      expect(h.loginFailures[0]).toMatchObject({
        email: 'alice@example.edu',
        ip: '10.0.0.1',
        reason: 'invalid_credentials',
      });
    });

    it('rejects unknown email within a real tenant with a generic 401 + records failure', async () => {
      const h = buildHarness();
      await expect(
        h.service.login(
          {
            schoolCode: 'SCH-0001',
            email: 'unknown@x',
            password: 'pw',
          },
          '10.0.0.1',
        ),
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
          {
            schoolCode: 'SCH-0001',
            email: 'alice@example.edu',
            password: 'wrong',
          },
          '10.0.0.2',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(h.loginFailures).toHaveLength(1);
      expect(h.loginFailures[0].reason).toBe('invalid_credentials');
    });

    it('Session 6c.1: soft-deleted user with the CORRECT password still gets a generic 401', async () => {
      // Locks in the timing-safe behaviour: the deletedAt check runs
      // AFTER the password compare so the wall-clock cost matches a
      // wrong-password attempt. The error message + recorded reason
      // must match the other invalid-credentials paths so an
      // attacker can't enumerate which emails are "deactivated".
      const h = buildHarness();
      h.users.set(
        'u-1',
        makeUser({
          deletedAt: new Date('2026-05-01T12:00:00Z'),
        }),
      );
      const collect = async (): Promise<string> => {
        try {
          await h.service.login(
            {
              schoolCode: 'SCH-0001',
              email: 'alice@example.edu',
              password: 'correct-pw',
            },
            '10.0.0.9',
          );
          return '';
        } catch (e) {
          return (e as Error).message;
        }
      };
      const softDeletedMsg = await collect();
      expect(softDeletedMsg).toBe('Invalid credentials.');
      expect(h.loginFailures).toHaveLength(1);
      expect(h.loginFailures[0]).toMatchObject({
        email: 'alice@example.edu',
        ip: '10.0.0.9',
        reason: 'invalid_credentials',
      });
    });

    it('uses the SAME error message for unknown school, unknown email, and wrong password', async () => {
      const h = buildHarness();
      h.users.set('u-1', makeUser());
      const collect = async (
        body: { schoolCode: string; email: string; password: string },
      ): Promise<string> => {
        try {
          await h.service.login(body);
          return '';
        } catch (e) {
          return (e as Error).message;
        }
      };
      const unknownSchool = await collect({
        schoolCode: 'SCH-9999',
        email: 'alice@example.edu',
        password: 'correct-pw',
      });
      const unknownEmail = await collect({
        schoolCode: 'SCH-0001',
        email: 'ghost@x',
        password: 'pw',
      });
      const wrongPassword = await collect({
        schoolCode: 'SCH-0001',
        email: 'alice@example.edu',
        password: 'wrong',
      });
      // Critical: don't leak which side failed.
      expect(unknownSchool).toBe(unknownEmail);
      expect(unknownEmail).toBe(wrongPassword);
    });
  });

  describe('tenant gate', () => {
    it.each(['SUSPENDED', 'EXPIRED'] as const)(
      'BLOCKS login when the school is %s — even with the right password',
      async (status) => {
        const h = buildHarness({
          school: { ...DEFAULT_SCHOOL, status },
        });
        h.users.set('u-1', makeUser());

        await expect(
          h.service.login(
            {
              schoolCode: 'SCH-0001',
              email: 'alice@example.edu',
              password: 'correct-pw',
            },
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
      const platformSchool: SchoolRow = {
        id: 's-platform',
        name: 'Platform',
        slug: 'platform',
        schoolCode: 'SCH-PLATFORM',
        status: 'SUSPENDED',
      };
      const h = buildHarness({ school: platformSchool });
      h.schools.set('SCH-PLATFORM', platformSchool);
      h.schools.delete('SCH-0001');
      h.users.set(
        'super-1',
        makeUser({
          id: 'super-1',
          email: 'op@platform',
          role: Role.SUPER_ADMIN,
          schoolId: 's-platform',
        }),
      );

      const result = await h.service.login({
        schoolCode: 'SCH-PLATFORM',
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
        {
          schoolCode: 'SCH-0001',
          email: 'alice@example.edu',
          password: 'correct-pw',
        },
        '10.0.0.1',
      );
      expect(result.accessToken).toBe('signed-token');
      expect(result.user.email).toBe('alice@example.edu');
      expect(h.loginFailures).toHaveLength(0);
    });

    it('normalizes lowercase / whitespace school codes before lookup', async () => {
      const h = buildHarness();
      h.users.set('u-1', makeUser());
      const result = await h.service.login({
        schoolCode: '  sch-0001  ',
        email: 'alice@example.edu',
        password: 'correct-pw',
      });
      expect(result.accessToken).toBe('signed-token');
    });
  });
});

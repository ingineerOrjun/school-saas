import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SecurityService } from './security.service';
import type { HashingService } from '../common/hashing/hashing.service';
import type { PrismaService } from '../database/prisma.service';
import type { NotificationService } from '../notifications/notification.service';
import type { ConfigService } from '@nestjs/config';
import type { PlatformAuditService } from './platform-audit.service';

// ---------------------------------------------------------------------------
// SecurityService — Phase 4 maturity tests.
//
// Tests the SUPER_ADMIN-tier surfaces that ship Phase 9's force-logout,
// bulk school logout, and admin password reset. The service is small
// but every method has both happy-path correctness AND invariants
// the platform's whole security posture depends on:
//
//   • SUPER_ADMIN never affected by logout/reset called on a peer.
//   • Reason required for school-wide logout (server-side gate, not
//     just UI).
//   • tokensValidAfter watermark is set on every successful action
//     (this is what actually invalidates JWTs).
//   • Audit row is recorded on every action.
//   • Email notification is fired on password reset (best-effort).
//
// The service is exercised against in-memory mocks rather than a real
// Prisma — the assertions are about the BEHAVIOUR the service
// guarantees, not about Prisma's correctness.
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  role: Role;
  schoolId: string;
  password: string;
  tokensValidAfter: Date | null;
  school?: { name: string } | null;
}

interface SchoolRow {
  id: string;
  name: string;
}

function buildHarness() {
  // Mutable in-memory tables so updateMany / update propagate across
  // subsequent reads (mirrors Prisma's view of the world).
  const users = new Map<string, UserRow>();
  const schools = new Map<string, SchoolRow>();
  const auditCalls: Array<{
    action: string;
    actorId: string;
    targetId: string;
    reason: string | null;
    after: unknown;
  }> = [];
  const notificationCalls: Array<{
    templateKey: string;
    recipientEmail?: string;
    payload: Record<string, unknown>;
  }> = [];

  const prisma: Partial<PrismaService> = {
    user: {
      findUnique: jest.fn(async ({ where, select }: any) => {
        const u = users.get(where.id);
        if (!u) return null;
        const projection: Partial<UserRow> = {};
        for (const key of Object.keys(select)) {
          if (key === 'school') {
            (projection as any).school = u.school
              ? { name: u.school.name }
              : null;
          } else {
            (projection as any)[key] = (u as any)[key];
          }
        }
        return projection;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error('not found');
        if (data.password !== undefined) u.password = data.password;
        if (data.tokensValidAfter !== undefined)
          u.tokensValidAfter = data.tokensValidAfter;
        return u;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const u of users.values()) {
          if (
            u.schoolId === where.schoolId &&
            (where.role?.not === undefined || u.role !== where.role.not)
          ) {
            if (data.tokensValidAfter !== undefined)
              u.tokensValidAfter = data.tokensValidAfter;
            count += 1;
          }
        }
        return { count };
      }),
    } as any,
    school: {
      findUnique: jest.fn(async ({ where }: any) =>
        schools.get(where.id) ?? null,
      ),
    } as any,
  };

  const hashing: Partial<HashingService> = {
    hash: jest.fn(async (plain: string) => `hashed:${plain}`),
    compare: jest.fn(async () => false),
  };

  const audit: Partial<PlatformAuditService> = {
    record: jest.fn(async (input: any) => {
      auditCalls.push({
        action: input.action,
        actorId: input.actor.userId,
        targetId: input.target.id,
        reason: input.reason ?? null,
        after: input.after,
      });
      return 'audit-id';
    }),
  };

  const notifications: Partial<NotificationService> = {
    enqueue: jest.fn(async (input: any) => {
      notificationCalls.push({
        templateKey: input.templateKey,
        recipientEmail: input.recipients.email,
        payload: input.payload,
      });
      return {
        notification: { id: 'n-id' } as any,
        deliveries: [],
        deduped: false,
      };
    }),
  };

  const config: Partial<ConfigService> = {
    get: jest.fn((key: string) => {
      if (key === 'mail.brand') {
        return {
          productName: 'TestApp',
          supportEmail: 'support@test',
        };
      }
      if (key === 'appUrl') return 'http://test.local';
      return undefined;
    }),
  };

  // Phase 17 follow-up — SessionService dependency mock. Tests in
  // this file don't exercise the per-session paths (those have
  // their own coverage in session.service.spec.ts), so the methods
  // are minimal stubs.
  const sessions = {
    listForUser: jest.fn(async () => []),
    revoke: jest.fn(async () => ({ revokedAt: new Date() })),
  } as any;

  const service = new SecurityService(
    prisma as PrismaService,
    hashing as HashingService,
    audit as PlatformAuditService,
    notifications as NotificationService,
    config as ConfigService,
    sessions,
  );

  return {
    service,
    users,
    schools,
    auditCalls,
    notificationCalls,
    hashing: hashing as jest.Mocked<HashingService>,
  };
}

const makeUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 'u-1',
  email: 'alice@school-a.edu',
  role: Role.ADMIN,
  schoolId: 's-1',
  password: 'old-hash',
  tokensValidAfter: null,
  school: { name: 'School A' },
  ...overrides,
});

const makeSchool = (overrides: Partial<SchoolRow> = {}): SchoolRow => ({
  id: 's-1',
  name: 'School A',
  ...overrides,
});

const ACTOR = { userId: 'super-1', email: 'op@platform', role: 'SUPER_ADMIN' };

describe('SecurityService', () => {
  describe('forceLogoutUser', () => {
    it('writes tokensValidAfter on the target user', async () => {
      const h = buildHarness();
      const user = makeUser();
      h.users.set(user.id, user);

      await h.service.forceLogoutUser(user.id, ACTOR, 'compromised account');

      expect(user.tokensValidAfter).toBeInstanceOf(Date);
    });

    it('records a USER_FORCE_LOGOUT audit row with the reason', async () => {
      const h = buildHarness();
      const user = makeUser();
      h.users.set(user.id, user);

      await h.service.forceLogoutUser(user.id, ACTOR, 'incident #42');

      expect(h.auditCalls).toHaveLength(1);
      expect(h.auditCalls[0].action).toBe('USER_FORCE_LOGOUT');
      expect(h.auditCalls[0].targetId).toBe(user.id);
      expect(h.auditCalls[0].reason).toBe('incident #42');
    });

    it('REFUSES to force-logout a SUPER_ADMIN target', async () => {
      const h = buildHarness();
      const peer = makeUser({ role: Role.SUPER_ADMIN });
      h.users.set(peer.id, peer);

      await expect(
        h.service.forceLogoutUser(peer.id, ACTOR, 'rogue admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Watermark must NOT be set on a refused action.
      expect(peer.tokensValidAfter).toBeNull();
      expect(h.auditCalls).toHaveLength(0);
    });

    it('throws NotFoundException for an unknown user', async () => {
      const h = buildHarness();
      await expect(
        h.service.forceLogoutUser('missing', ACTOR, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('forceLogoutSchool', () => {
    it('REQUIRES a non-empty reason (BadRequestException otherwise)', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());

      await expect(
        h.service.forceLogoutSchool('s-1', ACTOR, ''),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        h.service.forceLogoutSchool('s-1', ACTOR, '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates every NON-SUPER_ADMIN user at the school', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool());
      const admin = makeUser({ id: 'u-admin', role: Role.ADMIN });
      const teacher = makeUser({ id: 'u-teacher', role: Role.TEACHER });
      const peerSuper = makeUser({
        id: 'u-super',
        role: Role.SUPER_ADMIN,
      });
      const otherSchoolUser = makeUser({
        id: 'u-other',
        role: Role.ADMIN,
        schoolId: 's-other',
      });
      h.users.set(admin.id, admin);
      h.users.set(teacher.id, teacher);
      h.users.set(peerSuper.id, peerSuper);
      h.users.set(otherSchoolUser.id, otherSchoolUser);

      const result = await h.service.forceLogoutSchool(
        's-1',
        ACTOR,
        'credential leak',
      );

      expect(admin.tokensValidAfter).toBeInstanceOf(Date);
      expect(teacher.tokensValidAfter).toBeInstanceOf(Date);
      // SUPER_ADMINs are protected — must not be touched even when at
      // the same school.
      expect(peerSuper.tokensValidAfter).toBeNull();
      // Other school's user must not be touched.
      expect(otherSchoolUser.tokensValidAfter).toBeNull();
      expect(result.affectedCount).toBe(2);
    });

    it('records a SCHOOL_FORCE_LOGOUT audit with affectedCount + reason', async () => {
      const h = buildHarness();
      h.schools.set('s-1', makeSchool({ name: 'Acme High' }));
      h.users.set('u-1', makeUser({ id: 'u-1' }));
      h.users.set('u-2', makeUser({ id: 'u-2', email: 'b@x' }));

      await h.service.forceLogoutSchool('s-1', ACTOR, 'phishing campaign');

      expect(h.auditCalls).toHaveLength(1);
      const a = h.auditCalls[0];
      expect(a.action).toBe('SCHOOL_FORCE_LOGOUT');
      expect(a.targetId).toBe('s-1');
      expect(a.reason).toBe('phishing campaign');
      expect((a.after as any).affectedCount).toBe(2);
    });
  });

  describe('resetPassword', () => {
    it('writes a new password hash AND sets the watermark', async () => {
      const h = buildHarness();
      const user = makeUser();
      h.users.set(user.id, user);

      const result = await h.service.resetPassword(user.id, ACTOR, 'forgot');

      expect(user.password).toBe(`hashed:${result.temporaryPassword}`);
      expect(user.tokensValidAfter).toBeInstanceOf(Date);
      // Returned plaintext is non-trivial (16 chars per the generator).
      expect(result.temporaryPassword).toHaveLength(16);
    });

    it('REFUSES to reset a SUPER_ADMIN password', async () => {
      const h = buildHarness();
      const peer = makeUser({ role: Role.SUPER_ADMIN });
      h.users.set(peer.id, peer);

      await expect(
        h.service.resetPassword(peer.id, ACTOR, 'rogue'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // No mutation on refused action.
      expect(peer.password).toBe('old-hash');
      expect(peer.tokensValidAfter).toBeNull();
    });

    it('records ADMIN_PASSWORD_RESET WITHOUT the temp password in the audit row', async () => {
      const h = buildHarness();
      const user = makeUser();
      h.users.set(user.id, user);

      await h.service.resetPassword(user.id, ACTOR, 'support call');

      expect(h.auditCalls).toHaveLength(1);
      expect(h.auditCalls[0].action).toBe('ADMIN_PASSWORD_RESET');
      const after = h.auditCalls[0].after as Record<string, unknown>;
      // Critical: the audit row carries no secret material.
      expect(JSON.stringify(after)).not.toContain('hashed:');
      expect(JSON.stringify(after).toLowerCase()).not.toContain('password');
    });

    it('fires a password-reset notification with the temp password in the payload', async () => {
      const h = buildHarness();
      const user = makeUser({ email: 'alice@school-a.edu' });
      h.users.set(user.id, user);

      const result = await h.service.resetPassword(user.id, ACTOR, null);

      expect(h.notificationCalls).toHaveLength(1);
      const call = h.notificationCalls[0];
      expect(call.templateKey).toBe('platform.password_reset');
      expect(call.recipientEmail).toBe('alice@school-a.edu');
      expect(call.payload.temporaryPassword).toBe(result.temporaryPassword);
    });

    it('does NOT fail the reset if email delivery throws', async () => {
      const h = buildHarness();
      const user = makeUser();
      h.users.set(user.id, user);
      // Force the notification mock to reject.
      (h as any).service.notifications.enqueue = jest.fn(async () => {
        throw new Error('SMTP down');
      });

      await expect(
        h.service.resetPassword(user.id, ACTOR, null),
      ).resolves.toMatchObject({
        temporaryPassword: expect.any(String),
      });

      // The watermark + password change still happened.
      expect(user.tokensValidAfter).toBeInstanceOf(Date);
    });
  });
});

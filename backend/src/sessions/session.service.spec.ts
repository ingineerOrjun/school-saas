import { NotFoundException } from '@nestjs/common';
import { SessionService } from './session.service';
import type { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// SessionService — Phase 17 follow-up tests.
//
// Contract under test:
//   • create()  → persists a new row, returns id.
//   • findActive() → returns row when active, null when revoked.
//   • touch()   → throttles writes to once per minute per session.
//   • revoke()  → marks revokedAt + reason; idempotent on re-revoke;
//                 NotFound when id doesn't exist; NotFound when
//                 expectUserId mismatches (no session-id leakage).
//   • revokeAllForUser() → bulk update with optional except-id.
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  lastActiveAt: Date;
  ip: string | null;
  userAgent: string | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

function buildHarness() {
  const sessions = new Map<string, SessionRow>();
  let counter = 0;

  const prisma = {
    session: {
      create: jest.fn(async ({ data }: any) => {
        const id = `sess-${++counter}`;
        const row: SessionRow = {
          id,
          userId: data.userId,
          createdAt: new Date(),
          lastActiveAt: new Date(),
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
          revokedAt: null,
          revokedReason: null,
        };
        sessions.set(id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        sessions.get(where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = sessions.get(where.id);
        if (!row) throw new Error('not found');
        if (data.lastActiveAt !== undefined) row.lastActiveAt = data.lastActiveAt;
        if (data.revokedAt !== undefined) row.revokedAt = data.revokedAt;
        if (data.revokedReason !== undefined)
          row.revokedReason = data.revokedReason;
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of sessions.values()) {
          if (
            r.userId === where.userId &&
            r.revokedAt === null &&
            (where.id?.not === undefined || r.id !== where.id.not)
          ) {
            r.revokedAt = data.revokedAt;
            r.revokedReason = data.revokedReason;
            count += 1;
          }
        }
        return { count };
      }),
      findMany: jest.fn(async ({ where }: any) => {
        return [...sessions.values()].filter((r) => r.userId === where.userId);
      }),
    },
  } as unknown as PrismaService;

  const service = new SessionService(prisma);
  return { service, sessions };
}

describe('SessionService', () => {
  describe('create', () => {
    it('persists a session with the supplied IP + UA', async () => {
      const h = buildHarness();
      const row = await h.service.create({
        userId: 'u-1',
        ip: '10.0.0.1',
        userAgent: 'Chrome',
      });
      expect(row.id).toBeTruthy();
      expect(row.ip).toBe('10.0.0.1');
      expect(row.userAgent).toBe('Chrome');
      expect(row.revokedAt).toBeNull();
    });
  });

  describe('findActive', () => {
    it('returns the row when not revoked', async () => {
      const h = buildHarness();
      const created = await h.service.create({ userId: 'u-1' });
      const found = await h.service.findActive(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('returns null when the session is revoked', async () => {
      const h = buildHarness();
      const created = await h.service.create({ userId: 'u-1' });
      await h.service.revoke({ sessionId: created.id, reason: 'test' });
      const found = await h.service.findActive(created.id);
      expect(found).toBeNull();
    });

    it('returns null for an unknown id', async () => {
      const h = buildHarness();
      const found = await h.service.findActive('no-such-id');
      expect(found).toBeNull();
    });
  });

  describe('touch', () => {
    it('does NOT write when lastActiveAt is fresh (< 1 min)', async () => {
      const h = buildHarness();
      const created = await h.service.create({ userId: 'u-1' });
      const wrote = await h.service.touch(created.id, new Date()); // brand new
      expect(wrote).toBe(false);
    });

    it('writes when lastActiveAt is older than the throttle window', async () => {
      const h = buildHarness();
      const created = await h.service.create({ userId: 'u-1' });
      const old = new Date(Date.now() - 90_000); // 90s ago
      const wrote = await h.service.touch(created.id, old);
      expect(wrote).toBe(true);
    });

    it('returns false on race (session revoked between read + write)', async () => {
      const h = buildHarness();
      const created = await h.service.create({ userId: 'u-1' });
      // Simulate vanish.
      h.sessions.delete(created.id);
      const wrote = await h.service.touch(created.id, new Date(0));
      expect(wrote).toBe(false);
    });
  });

  describe('revoke', () => {
    it('marks revokedAt + reason', async () => {
      const h = buildHarness();
      const created = await h.service.create({ userId: 'u-1' });
      const updated = await h.service.revoke({
        sessionId: created.id,
        reason: 'user logout',
      });
      expect(updated.revokedAt).toBeInstanceOf(Date);
      expect(updated.revokedReason).toBe('user logout');
    });

    it('is idempotent — re-revoking returns the existing row unchanged', async () => {
      const h = buildHarness();
      const created = await h.service.create({ userId: 'u-1' });
      const first = await h.service.revoke({
        sessionId: created.id,
        reason: 'first',
      });
      const second = await h.service.revoke({
        sessionId: created.id,
        reason: 'second',
      });
      expect(second.revokedReason).toBe('first'); // not overwritten
      expect(second.revokedAt?.getTime()).toBe(first.revokedAt?.getTime());
    });

    it('throws NotFound for an unknown id', async () => {
      const h = buildHarness();
      await expect(
        h.service.revoke({ sessionId: 'missing', reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when expectUserId does not match (no leak)', async () => {
      const h = buildHarness();
      const created = await h.service.create({ userId: 'u-owner' });
      await expect(
        h.service.revoke({
          sessionId: created.id,
          reason: 'attack',
          expectUserId: 'u-attacker',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Original session must NOT be revoked.
      const stillActive = await h.service.findActive(created.id);
      expect(stillActive).not.toBeNull();
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every active session for the user', async () => {
      const h = buildHarness();
      await h.service.create({ userId: 'u-1' });
      await h.service.create({ userId: 'u-1' });
      await h.service.create({ userId: 'u-1' });
      await h.service.create({ userId: 'u-other' });

      const result = await h.service.revokeAllForUser({
        userId: 'u-1',
        reason: 'incident',
      });
      expect(result.count).toBe(3);

      // u-other untouched.
      const otherRows = await h.service.listForUser('u-other');
      expect(otherRows[0].revokedAt).toBeNull();
    });

    it('honors `exceptSessionId` (log out everywhere except here)', async () => {
      const h = buildHarness();
      const keep = await h.service.create({ userId: 'u-1' });
      await h.service.create({ userId: 'u-1' });
      await h.service.create({ userId: 'u-1' });

      const result = await h.service.revokeAllForUser({
        userId: 'u-1',
        reason: 'user revoke-others',
        exceptSessionId: keep.id,
      });
      expect(result.count).toBe(2);

      const stillActive = await h.service.findActive(keep.id);
      expect(stillActive).not.toBeNull();
    });

    it('skips already-revoked sessions (only counts the changes)', async () => {
      const h = buildHarness();
      const a = await h.service.create({ userId: 'u-1' });
      const b = await h.service.create({ userId: 'u-1' });
      await h.service.revoke({ sessionId: a.id, reason: 'pre' });

      const result = await h.service.revokeAllForUser({
        userId: 'u-1',
        reason: 'sweep',
      });
      expect(result.count).toBe(1);
      // The pre-revoked session keeps its original reason.
      const aRow = await h.service.listForUser('u-1');
      const aAfter = aRow.find((r) => r.id === a.id);
      expect(aAfter?.revokedReason).toBe('pre');
    });
  });
});

import { NotFoundException } from '@nestjs/common';
import {
  Notification,
  NotificationDelivery,
  NotificationSeverity,
} from '@prisma/client';
import { NotificationCenterService } from './notification-center.service';
import type { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// NotificationCenterService — Phase 20 school-side methods.
//
// Focus: the security invariant that every school-side method
// applies the tenant-safe access filter:
//
//   schoolId == user.schoolId
//   AND (userId == user.id OR userId IS NULL)
//
// Any failure here is a leakage bug. The tests below cover:
//   • Cross-tenant isolation (user A's tenant cannot see B's rows)
//   • Cross-user isolation within a tenant (alice doesn't see bob's
//     targeted notifications)
//   • Platform-tier rows (schoolId IS NULL) hidden from school-side
//   • School-wide rows (userId IS NULL) visible to every user at
//     the right tenant
//   • Mark-read writes only flip rows the user has access to
//   • Unread counts honor the access filter
//   • Pagination cursor works
// ---------------------------------------------------------------------------

interface NotifRow {
  id: string;
  templateKey: string;
  schoolId: string | null;
  userId: string | null;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  severity: NotificationSeverity;
  title: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function buildHarness() {
  // In-memory rows. Helper builds them with sensible defaults.
  const rows: NotifRow[] = [];
  let counter = 0;
  let now = Date.now();

  const addRow = (over: Partial<NotifRow> = {}): NotifRow => {
    counter += 1;
    now += 1000;
    const r: NotifRow = {
      id: `n-${counter}`,
      templateKey: 'test.example',
      schoolId: null,
      userId: null,
      payload: {},
      dedupeKey: null,
      severity: 'INFO',
      title: `Title ${counter}`,
      readAt: null,
      createdAt: new Date(now),
      ...over,
    };
    rows.push(r);
    return r;
  };

  const matchesWhere = (row: NotifRow, where: any): boolean => {
    if (!where) return true;
    if (where.schoolId !== undefined && where.schoolId !== row.schoolId)
      return false;
    if (where.userId !== undefined && where.userId !== row.userId) return false;
    if (where.readAt === null && row.readAt !== null) return false;
    if (where.severity?.in && !where.severity.in.includes(row.severity))
      return false;
    if (where.id !== undefined && where.id !== row.id) return false;
    if (where.OR) {
      const orMatch = where.OR.some((branch: any) => matchesWhere(row, branch));
      if (!orMatch) return false;
    }
    return true;
  };

  const prisma = {
    notification: {
      findMany: jest.fn(async ({ where, orderBy, skip, take }: any) => {
        let filtered = rows.filter((r) => matchesWhere(r, where));
        if (orderBy?.createdAt === 'desc') {
          filtered = filtered.sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        }
        if (skip) filtered = filtered.slice(skip);
        if (take) filtered = filtered.slice(0, take);
        return filtered;
      }),
      count: jest.fn(async ({ where }: any) =>
        rows.filter((r) => matchesWhere(r, where)).length,
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        return rows.find((r) => matchesWhere(r, where)) ?? null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        return rows.find((r) => r.id === where.id) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((r) => r.id === where.id);
        if (!r) throw new Error('not found');
        if (data.readAt !== undefined) r.readAt = data.readAt;
        return { ...r, deliveries: [] };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of rows) {
          if (matchesWhere(r, where)) {
            if (data.readAt !== undefined) r.readAt = data.readAt;
            count += 1;
          }
        }
        return { count };
      }),
    },
    $transaction: jest.fn(async (queries: Promise<unknown>[]) =>
      Promise.all(queries),
    ),
  } as unknown as PrismaService;

  const service = new NotificationCenterService(prisma);
  return { service, rows, addRow };
}

const ALICE = { userId: 'u-alice', schoolId: 's-1' };
const BOB = { userId: 'u-bob', schoolId: 's-1' };
const CHARLIE = { userId: 'u-charlie', schoolId: 's-2' };

describe('NotificationCenterService — school-side tenant isolation', () => {
  describe('listForSchoolUser', () => {
    it('returns notifications targeted to the calling user at the calling school', async () => {
      const h = buildHarness();
      h.addRow({ schoolId: 's-1', userId: 'u-alice', title: 'For Alice' });
      h.addRow({ schoolId: 's-1', userId: 'u-bob', title: 'For Bob' });

      const result = await h.service.listForSchoolUser(ALICE, {});

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].title).toBe('For Alice');
    });

    it('returns school-wide notifications (userId IS NULL) at the same tenant', async () => {
      const h = buildHarness();
      h.addRow({ schoolId: 's-1', userId: null, title: 'Maintenance on' });
      h.addRow({ schoolId: 's-1', userId: 'u-alice', title: 'Personal' });

      const result = await h.service.listForSchoolUser(ALICE, {});

      expect(result.rows).toHaveLength(2);
      expect(result.rows.map((r) => r.title)).toEqual(
        expect.arrayContaining(['Maintenance on', 'Personal']),
      );
    });

    it('HIDES notifications from another tenant', async () => {
      const h = buildHarness();
      // Alice's school
      h.addRow({ schoolId: 's-1', userId: 'u-alice', title: 'Alice' });
      // Different school — must not surface to Alice
      h.addRow({ schoolId: 's-2', userId: 'u-charlie', title: 'Charlie' });
      // Different school's school-wide — same rule
      h.addRow({ schoolId: 's-2', userId: null, title: 'Other school broadcast' });

      const result = await h.service.listForSchoolUser(ALICE, {});

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].title).toBe('Alice');
    });

    it('HIDES notifications targeted to a peer user at the same tenant', async () => {
      const h = buildHarness();
      h.addRow({ schoolId: 's-1', userId: 'u-alice', title: 'Alice' });
      h.addRow({ schoolId: 's-1', userId: 'u-bob', title: 'Bob — private' });

      const result = await h.service.listForSchoolUser(ALICE, {});

      expect(result.rows.map((r) => r.title)).toEqual(['Alice']);
    });

    it('HIDES platform-tier notifications (schoolId IS NULL) from school users', async () => {
      const h = buildHarness();
      // Platform broadcast (no schoolId, no userId) — operator-only
      h.addRow({ schoolId: null, userId: null, title: 'Platform-only' });
      h.addRow({ schoolId: 's-1', userId: null, title: 'Tenant-wide' });

      const result = await h.service.listForSchoolUser(ALICE, {});

      expect(result.rows.map((r) => r.title)).toEqual(['Tenant-wide']);
    });

    it('marks targetedToMe correctly for personal vs school-wide rows', async () => {
      const h = buildHarness();
      h.addRow({ schoolId: 's-1', userId: 'u-alice', title: 'Personal' });
      h.addRow({ schoolId: 's-1', userId: null, title: 'School-wide' });

      const result = await h.service.listForSchoolUser(ALICE, {});

      const personal = result.rows.find((r) => r.title === 'Personal');
      const broadcast = result.rows.find((r) => r.title === 'School-wide');
      expect(personal?.targetedToMe).toBe(true);
      expect(broadcast?.targetedToMe).toBe(false);
    });
  });

  describe('unreadCountForSchoolUser', () => {
    it('counts only the calling user-accessible unread rows', async () => {
      const h = buildHarness();
      h.addRow({ schoolId: 's-1', userId: 'u-alice', readAt: null });
      h.addRow({ schoolId: 's-1', userId: 'u-alice', readAt: new Date() }); // read
      h.addRow({ schoolId: 's-1', userId: null, readAt: null }); // school-wide
      h.addRow({ schoolId: 's-1', userId: 'u-bob', readAt: null }); // peer
      h.addRow({ schoolId: 's-2', userId: 'u-charlie', readAt: null }); // other tenant

      const count = await h.service.unreadCountForSchoolUser(ALICE);

      expect(count).toBe(2); // alice's unread + school-wide unread
    });
  });

  describe('getForSchoolUser', () => {
    it('returns the row when accessible', async () => {
      const h = buildHarness();
      const row = h.addRow({ schoolId: 's-1', userId: 'u-alice' });
      // Decorate with deliveries since the prisma mock's findFirst
      // doesn't include them — patch at the row level for test.
      (row as any).deliveries = [];

      const detail = await h.service.getForSchoolUser(ALICE, row.id);
      expect(detail.id).toBe(row.id);
    });

    it('throws NotFound for another user\'s targeted notification', async () => {
      const h = buildHarness();
      const row = h.addRow({ schoolId: 's-1', userId: 'u-bob' });
      (row as any).deliveries = [];

      await expect(
        h.service.getForSchoolUser(ALICE, row.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound for another tenant\'s notification', async () => {
      const h = buildHarness();
      const row = h.addRow({ schoolId: 's-2', userId: 'u-charlie' });
      (row as any).deliveries = [];

      await expect(
        h.service.getForSchoolUser(ALICE, row.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound for a platform-tier notification', async () => {
      const h = buildHarness();
      const row = h.addRow({ schoolId: null, userId: null });
      (row as any).deliveries = [];

      await expect(
        h.service.getForSchoolUser(ALICE, row.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('markReadForSchoolUser', () => {
    it('flips readAt on accessible rows', async () => {
      const h = buildHarness();
      const row = h.addRow({ schoolId: 's-1', userId: 'u-alice', readAt: null });

      await h.service.markReadForSchoolUser(ALICE, row.id);

      expect(row.readAt).toBeInstanceOf(Date);
    });

    it('REFUSES to mark another user\'s notification (NotFound)', async () => {
      const h = buildHarness();
      const row = h.addRow({ schoolId: 's-1', userId: 'u-bob', readAt: null });

      await expect(
        h.service.markReadForSchoolUser(ALICE, row.id),
      ).rejects.toBeInstanceOf(NotFoundException);

      // The row must NOT be modified.
      expect(row.readAt).toBeNull();
    });

    it('REFUSES to mark another tenant\'s notification (NotFound)', async () => {
      const h = buildHarness();
      const row = h.addRow({ schoolId: 's-2', userId: 'u-charlie', readAt: null });

      await expect(
        h.service.markReadForSchoolUser(ALICE, row.id),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(row.readAt).toBeNull();
    });
  });

  describe('markAllReadForSchoolUser', () => {
    it('flips every accessible unread row, leaves others untouched', async () => {
      const h = buildHarness();
      const aliceUnread = h.addRow({ schoolId: 's-1', userId: 'u-alice', readAt: null });
      const broadcastUnread = h.addRow({
        schoolId: 's-1',
        userId: null,
        readAt: null,
      });
      const bobUnread = h.addRow({ schoolId: 's-1', userId: 'u-bob', readAt: null });
      const otherTenantUnread = h.addRow({
        schoolId: 's-2',
        userId: 'u-charlie',
        readAt: null,
      });

      const result = await h.service.markAllReadForSchoolUser(ALICE);

      expect(result.count).toBe(2); // alice + broadcast
      expect(aliceUnread.readAt).toBeInstanceOf(Date);
      expect(broadcastUnread.readAt).toBeInstanceOf(Date);
      // Peer's notification untouched.
      expect(bobUnread.readAt).toBeNull();
      // Other tenant's notification untouched.
      expect(otherTenantUnread.readAt).toBeNull();
    });

    it('returns 0 when there\'s nothing to mark', async () => {
      const h = buildHarness();
      h.addRow({ schoolId: 's-1', userId: 'u-alice', readAt: new Date() });
      const result = await h.service.markAllReadForSchoolUser(ALICE);
      expect(result.count).toBe(0);
    });
  });

  describe('pagination', () => {
    it('returns the requested page + size', async () => {
      const h = buildHarness();
      // 30 rows for Alice
      for (let i = 0; i < 30; i++) {
        h.addRow({ schoolId: 's-1', userId: 'u-alice', title: `Row ${i}` });
      }

      const page1 = await h.service.listForSchoolUser(ALICE, {
        page: 1,
        pageSize: 10,
      });
      expect(page1.rows).toHaveLength(10);
      expect(page1.total).toBe(30);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(10);

      const page2 = await h.service.listForSchoolUser(ALICE, {
        page: 2,
        pageSize: 10,
      });
      expect(page2.rows).toHaveLength(10);
      // Different rows than page 1.
      const page1Ids = new Set(page1.rows.map((r) => r.id));
      for (const r of page2.rows) {
        expect(page1Ids.has(r.id)).toBe(false);
      }
    });

    it('caps pageSize at 100', async () => {
      const h = buildHarness();
      const result = await h.service.listForSchoolUser(ALICE, {
        pageSize: 500,
      });
      expect(result.pageSize).toBe(100);
    });

    it('defaults page to 1 when omitted', async () => {
      const h = buildHarness();
      const result = await h.service.listForSchoolUser(ALICE, {});
      expect(result.page).toBe(1);
    });
  });

  describe('severity filter', () => {
    it('filters to the requested severities', async () => {
      const h = buildHarness();
      h.addRow({ schoolId: 's-1', userId: 'u-alice', severity: 'INFO' });
      h.addRow({ schoolId: 's-1', userId: 'u-alice', severity: 'WARNING' });
      h.addRow({ schoolId: 's-1', userId: 'u-alice', severity: 'ERROR' });

      const result = await h.service.listForSchoolUser(ALICE, {
        severity: ['WARNING', 'ERROR'],
      });

      expect(result.rows.map((r) => r.severity).sort()).toEqual([
        'ERROR',
        'WARNING',
      ]);
    });
  });

  describe('unread count reflects access filter', () => {
    it('returns the same count as listForSchoolUser({unreadOnly: true})', async () => {
      const h = buildHarness();
      h.addRow({ schoolId: 's-1', userId: 'u-alice', readAt: null });
      h.addRow({ schoolId: 's-1', userId: null, readAt: null });
      h.addRow({ schoolId: 's-1', userId: 'u-bob', readAt: null }); // not accessible
      h.addRow({ schoolId: 's-2', userId: 'u-charlie', readAt: null }); // not accessible

      const list = await h.service.listForSchoolUser(ALICE, {
        unreadOnly: true,
      });
      const count = await h.service.unreadCountForSchoolUser(ALICE);

      expect(count).toBe(list.rows.length);
      expect(count).toBe(2);
    });
  });
});

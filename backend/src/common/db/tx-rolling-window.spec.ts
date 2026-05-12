import { Prisma } from '@prisma/client';
import { txWithRetry } from './tx-retry';
import type { PrismaService } from '../../database/prisma.service';
import {
  _resetRollingWindow,
  recordRollingEvent,
  snapshotRollingWindow,
} from './tx-rolling-window';

// ============================================================================
// txRollingWindow — Phase RELIABILITY-III Part 7 unit tests.
//
// Validates the sliding-window counter shape:
//   • events recorded in the last WINDOW_MS show up
//   • events older than WINDOW_MS are excluded
//   • per-event-kind buckets are independent
//   • `txWithRetry` correctly routes its events to the rolling layer
//
// We use real wall-clock time for the "recent events" case and
// jest fake timers for the "old events excluded" case so we can
// advance time deterministically.
// ============================================================================

interface MockPrisma {
  $transaction: jest.Mock;
}

function makeMockPrisma(): MockPrisma {
  return { $transaction: jest.fn() };
}

function p2034(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  _resetRollingWindow();
});

describe('recordRollingEvent + snapshotRollingWindow', () => {
  it('records a single retry and the snapshot reports it', () => {
    recordRollingEvent('hot-label', 'retry');
    const snap = snapshotRollingWindow();
    const row = snap.find((r) => r.label === 'hot-label');
    expect(row).toBeDefined();
    expect(row!.retry).toBe(1);
    expect(row!.exhausted).toBe(0);
    expect(row!.conflictFail).toBe(0);
    expect(row!.validationFail).toBe(0);
  });

  it('aggregates multiple events of the same kind', () => {
    for (let i = 0; i < 5; i++) {
      recordRollingEvent('busy-label', 'retry');
    }
    const row = snapshotRollingWindow().find((r) => r.label === 'busy-label');
    expect(row!.retry).toBe(5);
  });

  it('keeps event kinds independent per label', () => {
    recordRollingEvent('mixed-label', 'retry');
    recordRollingEvent('mixed-label', 'exhausted');
    recordRollingEvent('mixed-label', 'conflict_fail');
    recordRollingEvent('mixed-label', 'validation_fail');
    const row = snapshotRollingWindow().find((r) => r.label === 'mixed-label');
    expect(row).toEqual(
      expect.objectContaining({
        retry: 1,
        exhausted: 1,
        conflictFail: 1,
        validationFail: 1,
      }),
    );
  });

  it('separates labels into independent windows', () => {
    recordRollingEvent('label-a', 'retry');
    recordRollingEvent('label-b', 'retry');
    recordRollingEvent('label-b', 'retry');
    const snap = snapshotRollingWindow();
    const a = snap.find((r) => r.label === 'label-a');
    const b = snap.find((r) => r.label === 'label-b');
    expect(a!.retry).toBe(1);
    expect(b!.retry).toBe(2);
  });
});

describe('rolling window expiry', () => {
  it('drops events older than WINDOW_MS from the snapshot', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      recordRollingEvent('expire-label', 'retry');

      // Snapshot immediately — present.
      let row = snapshotRollingWindow().find(
        (r) => r.label === 'expire-label',
      );
      expect(row!.retry).toBe(1);

      // Advance past the 5-minute window.
      jest.setSystemTime(new Date('2026-08-01T00:06:00.000Z'));
      row = snapshotRollingWindow().find((r) => r.label === 'expire-label');
      // The label still appears in the snapshot (it's been touched),
      // but its rolling counts must be 0 — the prior event aged out.
      expect(row!.retry).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('txWithRetry → rolling-window integration', () => {
  it('a P2034 retry-then-success records one rolling retry event', async () => {
    const prisma = makeMockPrisma();
    prisma.$transaction
      .mockRejectedValueOnce(p2034())
      .mockImplementationOnce(async (fn: any) =>
        fn({} as Prisma.TransactionClient),
      );

    await txWithRetry(
      prisma as unknown as PrismaService,
      async () => 'ok',
      {
        label: 'rolling-retry-success',
        maxAttempts: 3,
        minBackoffMs: 1,
        maxBackoffMs: 1,
      },
    );

    const row = snapshotRollingWindow().find(
      (r) => r.label === 'rolling-retry-success',
    );
    expect(row!.retry).toBe(1);
    expect(row!.exhausted).toBe(0);
  });

  it('a retry-storm records retries + one exhausted event', async () => {
    const prisma = makeMockPrisma();
    prisma.$transaction
      .mockRejectedValueOnce(p2034())
      .mockRejectedValueOnce(p2034())
      .mockRejectedValueOnce(p2034());

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        {
          label: 'rolling-storm',
          maxAttempts: 3,
          minBackoffMs: 1,
          maxBackoffMs: 1,
        },
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const row = snapshotRollingWindow().find(
      (r) => r.label === 'rolling-storm',
    );
    expect(row!.retry).toBe(2);
    expect(row!.exhausted).toBe(1);
  });

  it('a P2002 first-fail records a conflict_fail event', async () => {
    const prisma = makeMockPrisma();
    prisma.$transaction.mockRejectedValueOnce(p2002());

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        { label: 'rolling-conflict', minBackoffMs: 1, maxBackoffMs: 1 },
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const row = snapshotRollingWindow().find(
      (r) => r.label === 'rolling-conflict',
    );
    expect(row!.conflictFail).toBe(1);
    expect(row!.retry).toBe(0);
    expect(row!.exhausted).toBe(0);
  });

  it('a validation throw records a validation_fail event', async () => {
    const prisma = makeMockPrisma();
    const nestErr = {
      getStatus: () => 400,
      message: 'bad request',
    };
    prisma.$transaction.mockRejectedValueOnce(nestErr);

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        { label: 'rolling-validation', minBackoffMs: 1, maxBackoffMs: 1 },
      ),
    ).rejects.toBe(nestErr);

    const row = snapshotRollingWindow().find(
      (r) => r.label === 'rolling-validation',
    );
    expect(row!.validationFail).toBe(1);
  });
});

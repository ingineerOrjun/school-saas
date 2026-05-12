import { Prisma } from '@prisma/client';
import { txWithRetry } from './tx-retry';
import type { PrismaService } from '../../database/prisma.service';
import {
  _resetTransactionTelemetry,
  classifyTransactionError,
  snapshotTransactionTelemetry,
} from './tx-telemetry';

// ============================================================================
// txTelemetry — Phase RELIABILITY-II Part 7 unit tests.
//
// Validates that the in-process counters move correctly under each
// real outcome of `txWithRetry`. We exercise the wrapper rather than
// calling the counter API directly so we catch any divergence
// between the contract documented in `tx-telemetry.ts` and what the
// wrapper actually records.
//
// The counters are process-global; each test calls
// `_resetTransactionTelemetry()` in `beforeEach` to start clean.
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
  return new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  _resetTransactionTelemetry();
});

describe('classifyTransactionError', () => {
  it('returns "p2034" for serialization conflicts', () => {
    expect(classifyTransactionError(p2034())).toBe('p2034');
  });

  it('returns "p2002" for unique violations', () => {
    expect(classifyTransactionError(p2002())).toBe('p2002');
  });

  it('returns "validation" for NestJS-shaped exceptions (have getStatus)', () => {
    const fake = { getStatus: () => 400, message: 'bad' };
    expect(classifyTransactionError(fake)).toBe('validation');
  });

  it('returns "other" for unknown errors', () => {
    expect(classifyTransactionError(new Error('boom'))).toBe('other');
    expect(classifyTransactionError(null)).toBe('other');
    expect(classifyTransactionError(42)).toBe('other');
  });
});

describe('txWithRetry telemetry integration', () => {
  it('records one attempt + zero retries + zero failures on success', async () => {
    const prisma = makeMockPrisma();
    prisma.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({} as Prisma.TransactionClient),
    );

    await txWithRetry(
      prisma as unknown as PrismaService,
      async () => 'ok',
      { label: 'metric-happy', minBackoffMs: 1, maxBackoffMs: 1 },
    );

    const snap = snapshotTransactionTelemetry();
    expect(snap.attempts).toContainEqual({ label: 'metric-happy', count: 1 });
    expect(snap.retries).toEqual([]);
    expect(snap.exhausted).toEqual([]);
    expect(snap.failures).toEqual([]);
  });

  it('records attempts + retries + exhausted on P2034 storm', async () => {
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
          label: 'metric-storm',
          maxAttempts: 3,
          minBackoffMs: 1,
          maxBackoffMs: 1,
        },
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const snap = snapshotTransactionTelemetry();
    expect(snap.attempts).toContainEqual({ label: 'metric-storm', count: 3 });
    // Two retries fired (between attempt 1→2 and 2→3); the 3rd
    // failure didn't trigger a retry because we hit maxAttempts.
    expect(snap.retries).toContainEqual({ label: 'metric-storm', count: 2 });
    expect(snap.exhausted).toContainEqual({
      label: 'metric-storm',
      count: 1,
    });
    expect(snap.failures).toContainEqual({
      label: 'metric-storm',
      reason: 'p2034',
      count: 1,
    });
  });

  it('records a P2002 failure without retries or exhaustion', async () => {
    const prisma = makeMockPrisma();
    prisma.$transaction.mockRejectedValueOnce(p2002());

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        { label: 'metric-p2002', minBackoffMs: 1, maxBackoffMs: 1 },
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const snap = snapshotTransactionTelemetry();
    expect(snap.attempts).toContainEqual({ label: 'metric-p2002', count: 1 });
    expect(snap.retries).toEqual([]);
    expect(snap.exhausted).toEqual([]);
    expect(snap.failures).toContainEqual({
      label: 'metric-p2002',
      reason: 'p2002',
      count: 1,
    });
  });

  it('records validation-class failures separately from DB failures', async () => {
    const prisma = makeMockPrisma();
    // Simulate a Nest BadRequestException thrown inside the callback.
    const fakeNestErr = {
      getStatus: () => 400,
      message: 'theory marks out of range',
    };
    prisma.$transaction.mockRejectedValueOnce(fakeNestErr);

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        {
          label: 'metric-validation',
          minBackoffMs: 1,
          maxBackoffMs: 1,
        },
      ),
    ).rejects.toBe(fakeNestErr);

    const snap = snapshotTransactionTelemetry();
    expect(snap.failures).toContainEqual({
      label: 'metric-validation',
      reason: 'validation',
      count: 1,
    });
    // Validation errors are NOT exhaustion or retry events.
    expect(snap.retries).toEqual([]);
    expect(snap.exhausted).toEqual([]);
  });

  it('records the retry-then-success path correctly', async () => {
    const prisma = makeMockPrisma();
    prisma.$transaction
      .mockRejectedValueOnce(p2034())
      .mockImplementationOnce(async (fn: any) =>
        fn({} as Prisma.TransactionClient),
      );

    await txWithRetry(
      prisma as unknown as PrismaService,
      async () => 'eventually-ok',
      {
        label: 'metric-retry-success',
        maxAttempts: 3,
        minBackoffMs: 1,
        maxBackoffMs: 1,
      },
    );

    const snap = snapshotTransactionTelemetry();
    expect(snap.attempts).toContainEqual({
      label: 'metric-retry-success',
      count: 2,
    });
    expect(snap.retries).toContainEqual({
      label: 'metric-retry-success',
      count: 1,
    });
    expect(snap.exhausted).toEqual([]);
    expect(snap.failures).toEqual([]);
  });
});

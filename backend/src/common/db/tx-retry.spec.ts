import { Prisma } from '@prisma/client';
import { isTransientPrismaError, txWithRetry } from './tx-retry';
import type { PrismaService } from '../../database/prisma.service';

// ============================================================================
// txWithRetry — unit tests.
//
// Validates the retry contract documented in the helper:
//   • P2034 (serialization / deadlock) retries with backoff
//   • Other Prisma errors (P2002, P2025) DO NOT retry
//   • Non-Prisma errors DO NOT retry
//   • Success on first try doesn't retry
//   • All retries exhausted ⇒ rethrows the LAST error
//   • onFinalFailure fires exactly once when all retries fail
//   • onFinalFailure never throws past the helper
//
// We mock PrismaService.$transaction so the helper sees a controllable
// failure pattern. The tests don't touch a real database.
// ============================================================================

interface MockPrisma {
  $transaction: jest.Mock;
}

function makeMockPrisma(): MockPrisma {
  return { $transaction: jest.fn() };
}

function p2034(): Prisma.PrismaClientKnownRequestError {
  // The Prisma constructor signature varies by version; pass the
  // shape it accepts in this codebase (message + code + clientVersion).
  return new Prisma.PrismaClientKnownRequestError(
    'write conflict — serialization failure',
    { code: 'P2034', clientVersion: 'test' },
  );
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'unique constraint failed',
    { code: 'P2002', clientVersion: 'test', meta: { target: ['email'] } },
  );
}

describe('isTransientPrismaError', () => {
  it('returns true for P2034', () => {
    expect(isTransientPrismaError(p2034())).toBe(true);
  });

  it('returns false for P2002 (unique violation)', () => {
    expect(isTransientPrismaError(p2002())).toBe(false);
  });

  it('returns false for arbitrary Error', () => {
    expect(isTransientPrismaError(new Error('boom'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(isTransientPrismaError(null)).toBe(false);
    expect(isTransientPrismaError(undefined)).toBe(false);
    expect(isTransientPrismaError('string')).toBe(false);
  });

  it('returns true for unknown errors mentioning "could not serialize"', () => {
    const err = new Prisma.PrismaClientUnknownRequestError(
      'could not serialize access due to concurrent update',
      { clientVersion: 'test' },
    );
    expect(isTransientPrismaError(err)).toBe(true);
  });

  it('returns true for unknown errors mentioning "deadlock detected"', () => {
    const err = new Prisma.PrismaClientUnknownRequestError(
      'deadlock detected on relation foo',
      { clientVersion: 'test' },
    );
    expect(isTransientPrismaError(err)).toBe(true);
  });
});

describe('txWithRetry', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = makeMockPrisma();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('runs the callback exactly once on success', async () => {
    prisma.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({} as Prisma.TransactionClient),
    );
    const callback = jest.fn().mockResolvedValue('ok');

    const result = await txWithRetry(
      prisma as unknown as PrismaService,
      callback,
      { label: 'happy', minBackoffMs: 1, maxBackoffMs: 1 },
    );

    expect(result).toBe('ok');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Retry behaviour
  // -------------------------------------------------------------------------

  it('retries on P2034 and succeeds on a later attempt', async () => {
    prisma.$transaction
      .mockRejectedValueOnce(p2034())
      .mockRejectedValueOnce(p2034())
      .mockImplementationOnce(async (fn: any) =>
        fn({} as Prisma.TransactionClient),
      );
    const callback = jest.fn().mockResolvedValue('eventually');

    const result = await txWithRetry(
      prisma as unknown as PrismaService,
      callback,
      { label: 'retry-success', minBackoffMs: 1, maxBackoffMs: 1 },
    );

    expect(result).toBe('eventually');
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on P2002 (unique-violation is a business rule)', async () => {
    const violation = p2002();
    prisma.$transaction.mockRejectedValueOnce(violation);

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        { label: 'no-retry-p2002', minBackoffMs: 1, maxBackoffMs: 1 },
      ),
    ).rejects.toBe(violation);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on arbitrary Error', async () => {
    const boom = new Error('boom');
    prisma.$transaction.mockRejectedValueOnce(boom);

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        { label: 'no-retry-other', minBackoffMs: 1, maxBackoffMs: 1 },
      ),
    ).rejects.toBe(boom);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after maxAttempts and rethrows the LAST error', async () => {
    const errors = [p2034(), p2034(), p2034()];
    prisma.$transaction
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2]);

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        {
          label: 'exhaust',
          maxAttempts: 3,
          minBackoffMs: 1,
          maxBackoffMs: 1,
        },
      ),
    ).rejects.toBe(errors[2]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // onFinalFailure contract
  // -------------------------------------------------------------------------

  it('invokes onFinalFailure exactly once with attempt history', async () => {
    prisma.$transaction
      .mockRejectedValueOnce(p2034())
      .mockRejectedValueOnce(p2034())
      .mockRejectedValueOnce(p2034());
    const hook = jest.fn();

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        {
          label: 'hooked',
          maxAttempts: 3,
          minBackoffMs: 1,
          maxBackoffMs: 1,
          onFinalFailure: hook,
        },
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    expect(hook).toHaveBeenCalledTimes(1);
    const info = hook.mock.calls[0][0];
    expect(info.label).toBe('hooked');
    expect(info.attempts).toBe(3);
    expect(info.durations).toHaveLength(3);
    expect(info.lastError).toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  it('does NOT invoke onFinalFailure on success', async () => {
    prisma.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({} as Prisma.TransactionClient),
    );
    const hook = jest.fn();

    await txWithRetry(
      prisma as unknown as PrismaService,
      async () => 'ok',
      {
        label: 'no-hook-on-success',
        minBackoffMs: 1,
        maxBackoffMs: 1,
        onFinalFailure: hook,
      },
    );

    expect(hook).not.toHaveBeenCalled();
  });

  it('invokes onFinalFailure once on a non-transient error (no retry)', async () => {
    // The hook fires whenever the helper gives up — that includes
    // first-try business failures (P2002) which never retried. This
    // gives callers a single observation point for "this transaction
    // ended in error" regardless of cause. Behavior contract:
    // attempts === 1, lastError === the original violation.
    const violation = p2002();
    prisma.$transaction.mockRejectedValueOnce(violation);
    const hook = jest.fn();

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        {
          label: 'hook-on-non-transient',
          minBackoffMs: 1,
          maxBackoffMs: 1,
          onFinalFailure: hook,
        },
      ),
    ).rejects.toBe(violation);

    expect(hook).toHaveBeenCalledTimes(1);
    const info = hook.mock.calls[0][0];
    expect(info.attempts).toBe(1);
    expect(info.lastError).toBe(violation);
  });

  it('still throws the original error if onFinalFailure itself throws', async () => {
    prisma.$transaction.mockRejectedValueOnce(p2034());
    const hook = jest.fn().mockImplementation(() => {
      throw new Error('hook explosion');
    });

    await expect(
      txWithRetry(
        prisma as unknown as PrismaService,
        async () => 'never',
        {
          label: 'hook-throws',
          maxAttempts: 1,
          minBackoffMs: 1,
          maxBackoffMs: 1,
          onFinalFailure: hook,
        },
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    expect(hook).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Slow-tx dev warning (no behavior change, just logs)
  // -------------------------------------------------------------------------

  it('forwards prismaOptions to $transaction', async () => {
    prisma.$transaction.mockImplementationOnce(async (fn: any) =>
      fn({} as Prisma.TransactionClient),
    );

    await txWithRetry(
      prisma as unknown as PrismaService,
      async () => 'ok',
      {
        label: 'options',
        minBackoffMs: 1,
        maxBackoffMs: 1,
        prismaOptions: { timeout: 9999, maxWait: 1234 },
      },
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 9999, maxWait: 1234 },
    );
  });
});

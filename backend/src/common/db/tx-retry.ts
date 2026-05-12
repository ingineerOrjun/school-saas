import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import {
  classifyTransactionError,
  recordTransactionAttempt,
  recordTransactionExhausted,
  recordTransactionFailure,
  recordTransactionRetry,
} from './tx-telemetry';
import { recordRollingEvent } from './tx-rolling-window';

// ============================================================================
// txWithRetry — deadlock-safe transaction wrapper.
//
// Phase PLATFORM STABILIZATION Part 3.
//
// What it adds on top of `prisma.$transaction`:
//
//   1. Automatic retry on transient serialization/deadlock failures
//      (Prisma error code P2034). Postgres reports these as
//      40001 (serialization failure) or 40P01 (deadlock detected);
//      both surface as P2034 through Prisma's client.
//
//   2. Capped exponential backoff with jitter — keeps retry storms
//      from amplifying contention. Default 3 attempts, backoff
//      ~20ms → ~80ms with ±25% jitter.
//
//   3. Dev-only slow-transaction warning. Any callback that takes
//      longer than `slowMs` (default 1500ms) logs a NestJS warn so
//      reviewers can spot accidental N+1 inside transactions. Zero
//      production overhead — gated on NODE_ENV.
//
//   4. Soft-audit hook. Callers can pass `onFinalFailure` to fan out
//      a structured log / audit emit when all retries fail. This is
//      INTENTIONALLY a fire-and-forget callback — never throws.
//
// What it deliberately does NOT do:
//
//   • Retry P2002 (unique violation) — that's almost always a real
//     business-rule conflict, not a transient error. Caller decides.
//   • Retry P2025 (record not found) — also a logic / race issue,
//     not a transient one.
//   • Wrap arbitrary code — only Prisma transactions. Other retry
//     concerns (HTTP, queue) belong in their own helpers.
//
// Usage:
//
//   const result = await txWithRetry(this.prisma, async (tx) => {
//     // multi-write logic …
//   }, { label: 'archive-student', maxAttempts: 3 });
//
// ============================================================================

export interface TxRetryOptions {
  /**
   * Human-readable label used in dev warnings + the failure callback.
   * Should be a stable identifier of the operation (`'promote-students'`),
   * NOT a per-request value — telemetry aggregates on it.
   */
  label: string;
  /** Max transaction attempts including the first try. Default: 3. */
  maxAttempts?: number;
  /** Minimum backoff in ms (default 20). */
  minBackoffMs?: number;
  /** Cap on backoff in ms (default 200). */
  maxBackoffMs?: number;
  /**
   * Soft slow-transaction threshold. Any successful run taking longer
   * than this logs a warn IN DEV ONLY. Default 1500ms.
   */
  slowMs?: number;
  /**
   * Optional Prisma transaction options forwarded to `$transaction`
   * (timeout, maxWait, isolationLevel). Defaults to Prisma's own.
   */
  prismaOptions?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  };
  /**
   * Fire-and-forget hook invoked whenever the helper gives up. That
   * includes:
   *   • all transient retries exhausted (P2034 after maxAttempts), AND
   *   • first-try non-transient failures (P2002, P2025, etc.) — the
   *     helper never retries these so it gives up after one attempt.
   *
   * Receives the final error + attempt history. The hook must not
   * throw — the underlying error is rethrown to the caller regardless.
   *
   * Use cases: emit telemetry / structured log, increment a counter
   * for `transaction_failures_total{label=…}`, etc.
   */
  onFinalFailure?: (info: {
    label: string;
    attempts: number;
    lastError: unknown;
    durations: number[];
  }) => void | Promise<void>;
}

/**
 * Run `fn` inside a Prisma transaction with retry-on-deadlock + slow-tx
 * dev warning. See module-level docs for behavior. Throws the original
 * error after exhausting retries.
 */
export async function txWithRetry<T>(
  prisma: PrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: TxRetryOptions,
): Promise<T> {
  const {
    label,
    maxAttempts = 3,
    minBackoffMs = 20,
    maxBackoffMs = 200,
    slowMs = 1500,
    prismaOptions,
    onFinalFailure,
  } = options;

  const logger = getLogger();
  const durations: number[] = [];
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    // Phase RELIABILITY-II Part 7: bump the in-process attempt
    // counter on every iteration so the operations cockpit's
    // "transaction attempts per label" panel reflects reality.
    recordTransactionAttempt(label);
    try {
      const result = await prisma.$transaction(fn, prismaOptions);
      const elapsed = Date.now() - startedAt;
      durations.push(elapsed);
      // Slow-tx dev warning — gated on NODE_ENV so prod stays quiet.
      if (process.env.NODE_ENV !== 'production' && elapsed > slowMs) {
        logger.warn(
          `[tx-retry] slow transaction "${label}" — ${elapsed}ms (attempt ${attempt}/${maxAttempts}). Investigate N+1 inside the callback.`,
        );
      }
      return result;
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      durations.push(elapsed);
      lastError = err;

      if (!isTransientPrismaError(err) || attempt >= maxAttempts) {
        // Final failure path. Classify + record exactly once per
        // terminating transaction. Retry-exhaustion gets its own
        // counter on top of the failure class.
        const reason = classifyTransactionError(err);
        recordTransactionFailure(label, reason);
        // Phase RELIABILITY-III Part 7: rolling-window snapshot for
        // the operations cockpit. Records only the operationally
        // interesting classes — `other` and `p2025` don't move the
        // rolling rates we care about.
        if (reason === 'validation') {
          recordRollingEvent(label, 'validation_fail');
        } else if (reason === 'p2002') {
          recordRollingEvent(label, 'conflict_fail');
        }
        if (isTransientPrismaError(err) && attempt >= maxAttempts) {
          recordTransactionExhausted(label);
          recordRollingEvent(label, 'exhausted');
        }
        if (attempt > 1 && process.env.NODE_ENV !== 'production') {
          logger.warn(
            `[tx-retry] "${label}" failed after ${attempt} attempt(s) — ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        break;
      }

      // Transient — about to retry. Count it.
      recordTransactionRetry(label);
      recordRollingEvent(label, 'retry');

      // Backoff with jitter ±25%, capped at maxBackoffMs.
      const base = Math.min(
        maxBackoffMs,
        minBackoffMs * Math.pow(2, attempt - 1),
      );
      const jitter = base * (0.75 + Math.random() * 0.5);
      if (process.env.NODE_ENV !== 'production') {
        logger.warn(
          `[tx-retry] "${label}" transient error on attempt ${attempt}/${maxAttempts} — retrying in ${Math.round(
            jitter,
          )}ms.`,
        );
      }
      await sleep(jitter);
    }
  }

  // All retries exhausted — invoke the soft failure hook (never throws)
  // then rethrow the original error.
  if (onFinalFailure) {
    try {
      await onFinalFailure({
        label,
        attempts: durations.length,
        lastError,
        durations,
      });
    } catch (cbErr) {
      // Hook itself threw — log and swallow. The caller still gets the
      // ORIGINAL error.
      logger.error(
        `[tx-retry] onFinalFailure hook for "${label}" threw — swallowing: ${
          cbErr instanceof Error ? cbErr.message : String(cbErr)
        }`,
      );
    }
  }
  throw lastError;
}

/**
 * Is this Prisma error a transient serialization / deadlock that
 * benefits from retry? Exported for tests.
 */
export function isTransientPrismaError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === 'P2034';
  }
  // Also retry on raw Postgres connection-level resets that bubble
  // through as a generic Prisma error with `code` 40001 / 40P01.
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    const msg = (err.message ?? '').toLowerCase();
    return (
      msg.includes('could not serialize') ||
      msg.includes('deadlock detected')
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

let _logger: Logger | null = null;
function getLogger(): Logger {
  if (!_logger) _logger = new Logger('TxRetry');
  return _logger;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

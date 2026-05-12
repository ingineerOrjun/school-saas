import { Logger } from '@nestjs/common';

// ============================================================================
// txTelemetry — Phase RELIABILITY-II Part 7.
//
// Lightweight in-process counters for transaction-layer events that
// operators or post-mortem reviewers care about. Zero external
// infrastructure — no Prometheus, no Grafana, no SaaS pings. The
// counters are read by the operations cockpit and surface in the
// dev `RequestPressurePanel` over time.
//
// What we count:
//
//   • `transactionAttempts{label}`        — every successful or
//     failed transaction attempt.
//   • `transactionRetries{label}`         — every retry that fired
//     after a transient P2034.
//   • `transactionExhausted{label}`       — every transaction that
//     used up its retry budget (the most-important signal — the
//     operator needs to know contention is real).
//   • `transactionFailures{label,reason}` — every transaction that
//     terminated in error, split by the reason class
//     (P2034, P2002, P2025, other).
//
// All four are best-effort and process-local. They are NOT persisted.
// On process restart they reset to zero. That is intentional: this
// surface is for "what's happening right now," not historical
// reporting (the audit log + operations cockpit own history).
//
// Production overhead:
//   • One increment + one map lookup per transaction. Map size is
//     bounded by the number of distinct `label`s in use (currently
//     12, growing slowly). Negligible.
//
// Privacy:
//   • Only labels + reason classes recorded. No row ids, no actor
//     ids, no PII. Safe to expose in dev panels.
// ============================================================================

export type TransactionReasonClass =
  | 'p2034'
  | 'p2002'
  | 'p2025'
  | 'other'
  | 'validation';

interface CounterMap {
  attempts: Map<string, number>;
  retries: Map<string, number>;
  exhausted: Map<string, number>;
  failures: Map<string, Map<TransactionReasonClass, number>>;
}

const counters: CounterMap = {
  attempts: new Map(),
  retries: new Map(),
  exhausted: new Map(),
  failures: new Map(),
};

const logger = new Logger('TxTelemetry');

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** Record an attempt — happy-path OR failure, before any classification. */
export function recordTransactionAttempt(label: string): void {
  bump(counters.attempts, label);
}

/** Record that a P2034 retry just fired. Called once per retry,
 *  NOT once per failed attempt. The attempts counter already covers
 *  the latter. */
export function recordTransactionRetry(label: string): void {
  bump(counters.retries, label);
}

/** Record that retries were exhausted. Called exactly once per
 *  exhausted transaction. */
export function recordTransactionExhausted(label: string): void {
  bump(counters.exhausted, label);
  // Loud-log in production so an operator sees retry-exhaustion in
  // the application log even without polling the counter snapshot.
  // Dev panels also show this via the snapshot below.
  logger.warn(
    `[tx-telemetry] retries exhausted for "${label}". Consider widening contention windows or capping operator parallelism.`,
  );
}

/** Record a final-failure with a classified reason. Called exactly
 *  once per terminating-in-error transaction. */
export function recordTransactionFailure(
  label: string,
  reason: TransactionReasonClass,
): void {
  let perLabel = counters.failures.get(label);
  if (!perLabel) {
    perLabel = new Map();
    counters.failures.set(label, perLabel);
  }
  perLabel.set(reason, (perLabel.get(reason) ?? 0) + 1);
}

/** Snapshot — used by the operations cockpit + dev panels. */
export function snapshotTransactionTelemetry(): {
  attempts: Array<{ label: string; count: number }>;
  retries: Array<{ label: string; count: number }>;
  exhausted: Array<{ label: string; count: number }>;
  failures: Array<{
    label: string;
    reason: TransactionReasonClass;
    count: number;
  }>;
} {
  return {
    attempts: [...counters.attempts.entries()].map(([label, count]) => ({
      label,
      count,
    })),
    retries: [...counters.retries.entries()].map(([label, count]) => ({
      label,
      count,
    })),
    exhausted: [...counters.exhausted.entries()].map(([label, count]) => ({
      label,
      count,
    })),
    failures: [...counters.failures.entries()].flatMap(([label, perReason]) =>
      [...perReason.entries()].map(([reason, count]) => ({
        label,
        reason,
        count,
      })),
    ),
  };
}

/** Reset — test-only. Lets specs assert against a clean counter
 *  state. Tests must call this in `beforeEach` if they exercise the
 *  telemetry surface. */
export function _resetTransactionTelemetry(): void {
  counters.attempts.clear();
  counters.retries.clear();
  counters.exhausted.clear();
  counters.failures.clear();
}

// ---------------------------------------------------------------------------
// Reason classifier — used by `tx-retry.ts` to bucket a final error
// into one of the stable classes above. Exported so other call sites
// (non-transaction code paths that want the same taxonomy) can reuse it.
// ---------------------------------------------------------------------------

export function classifyTransactionError(err: unknown): TransactionReasonClass {
  // `Prisma` is intentionally not imported here to keep the file
  // dependency-free; we recognise the public error shape by name.
  if (err && typeof err === 'object') {
    const code = (err as { code?: string }).code;
    if (code === 'P2034') return 'p2034';
    if (code === 'P2002') return 'p2002';
    if (code === 'P2025') return 'p2025';
    // NestJS exceptions thrown from inside a transaction (BadRequest,
    // Conflict) carry a `getStatus()` method. Classify those as
    // validation so the dashboard distinguishes "DB contention" from
    // "operator-induced 4xx that aborted the transaction."
    if (typeof (err as { getStatus?: () => number }).getStatus === 'function') {
      return 'validation';
    }
  }
  return 'other';
}

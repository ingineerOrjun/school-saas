import type { Logger } from '@nestjs/common';

// ---------------------------------------------------------------------------
// JobHandler — the contract every named job implements.
//
// Handler functions are deliberately narrow: they receive a typed
// payload and a context object, return a Promise. Error semantics:
//
//   • Throw → the queue records the error, increments attempts,
//     re-schedules with backoff. After maxAttempts, the job goes to
//     FAILED.
//   • Resolve → SUCCEEDED, no retries.
//   • Throw a `JobNonRetryableError` → straight to FAILED, no
//     retries (use for "this will never succeed" errors like
//     bad input).
//
// Handlers DO NOT touch the queue table directly — the runtime
// service owns those writes. This keeps handlers focused on
// business logic and keeps the contract swappable when we move to
// Redis/BullMQ later.
// ---------------------------------------------------------------------------

export interface JobContext {
  /** The job row's id, for child-row foreign keys / log context. */
  jobId: string;
  /** Attempt number, 1-indexed, of this run. */
  attempt: number;
  /** Logger scoped to the job's name. */
  logger: Logger;
}

export interface JobHandler<TPayload = unknown> {
  /** Stable name — must match what producers pass to `enqueue`. */
  name: string;
  /**
   * Maximum total attempts (including the first run). Default 3.
   * Set to 1 for jobs that shouldn't retry (e.g. one-shot writes).
   */
  maxAttempts?: number;
  /**
   * Run this job. Throw on failure to trigger retry; throw
   * `JobNonRetryableError` to skip retries.
   */
  run(payload: TPayload, ctx: JobContext): Promise<void>;
}

/**
 * Throw this from a handler when the job should NOT be retried —
 * e.g. the input is malformed, the target row no longer exists, or
 * the operation is fundamentally unrecoverable. The queue marks the
 * job FAILED immediately and skips backoff.
 */
export class JobNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobNonRetryableError';
  }
}

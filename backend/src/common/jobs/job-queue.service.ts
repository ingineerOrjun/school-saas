import { Injectable, Logger } from '@nestjs/common';
import {
  Job,
  JobStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// JobQueueService — DB-backed enqueue + claim primitive.
//
// Producers call `enqueue()`; the worker (JobRunnerService) calls
// `claimNext()` to pull the next due row and `markSucceeded` /
// `markFailed` / `reschedule` to advance state.
//
// Why DB-backed (instead of just in-memory):
//   • Crash safety — a process restart picks up where the worker
//     left off. The in-memory queue would lose pending work.
//   • Idempotency at write time — the unique index on (name,
//     dedupeKey) is the dedupe contract.
//   • Operator visibility — `SELECT * FROM jobs WHERE status='FAILED'`
//     beats grepping logs.
//
// claimNext semantics:
//   We use a transaction with `FOR UPDATE SKIP LOCKED` to atomically
//   claim the next eligible row. Multiple workers in the same
//   process (or future Node cluster mode) cannot pick the same row.
//   When we move to BullMQ, this method becomes the only thing
//   that needs replacing.
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  name: string;
  payload?: Record<string, unknown>;
  /**
   * Idempotency key. (name, dedupeKey) is unique — re-enqueue with
   * the same pair returns the existing row.
   */
  dedupeKey?: string;
  /**
   * When the job becomes eligible to run. Defaults to now (immediate).
   * Pass a future Date to defer execution.
   */
  runAt?: Date;
  /**
   * Total attempts including the first run. Defaults to 3. Override
   * per-call when a particular enqueue should be one-shot or stricter.
   */
  maxAttempts?: number;
}

export interface EnqueueResult {
  job: Job;
  /** True iff a duplicate (name + dedupeKey) was found and reused. */
  deduped: boolean;
}

@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Schedule a job. Idempotent when `dedupeKey` is provided —
   * re-calling with the same (name, dedupeKey) returns the existing
   * row without churning state.
   */
  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    if (input.dedupeKey) {
      const existing = await this.prisma.job.findUnique({
        where: {
          name_dedupeKey: {
            name: input.name,
            dedupeKey: input.dedupeKey,
          },
        },
      });
      if (existing) {
        return { job: existing, deduped: true };
      }
    }

    try {
      const job = await this.prisma.job.create({
        data: {
          name: input.name,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey ?? null,
          runAt: input.runAt ?? new Date(),
          maxAttempts: input.maxAttempts ?? 3,
          status: 'PENDING',
        },
      });
      return { job, deduped: false };
    } catch (e) {
      // Race: two enqueues with the same dedupeKey landed at the
      // same instant. The second loses on the unique index — fall
      // back to looking up the winner. This keeps the API contract
      // consistent: enqueue ALWAYS resolves with a row.
      if (
        input.dedupeKey &&
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const winner = await this.prisma.job.findUnique({
          where: {
            name_dedupeKey: {
              name: input.name,
              dedupeKey: input.dedupeKey,
            },
          },
        });
        if (winner) return { job: winner, deduped: true };
      }
      throw e;
    }
  }

  /**
   * Claim the next due PENDING job atomically. Returns null when
   * nothing is due. Used by the runner's poll loop.
   */
  async claimNext(now: Date = new Date()): Promise<Job | null> {
    // FOR UPDATE SKIP LOCKED: exactly one concurrent claimer wins
    // each row. The status flip to RUNNING is what makes the row
    // invisible to subsequent claimers; SKIP LOCKED prevents the
    // claimers' own SELECTs from blocking each other.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "jobs"
        WHERE "status" = 'PENDING' AND "runAt" <= ${now}
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      if (candidates.length === 0) return null;
      const id = candidates[0].id;
      return tx.job.update({
        where: { id },
        data: {
          status: 'RUNNING',
          startedAt: now,
          attempts: { increment: 1 },
        },
      });
    });
    return claimed;
  }

  async markSucceeded(jobId: string): Promise<Job> {
    return this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'SUCCEEDED',
        completedAt: new Date(),
        lastError: null,
      },
    });
  }

  /**
   * Record a failure. If attempts < maxAttempts, the row goes back
   * to PENDING with `runAt` bumped by exponential backoff. Otherwise
   * it's marked FAILED.
   */
  async markFailed(input: {
    jobId: string;
    error: string;
    nonRetryable?: boolean;
  }): Promise<Job> {
    const row = await this.prisma.job.findUnique({
      where: { id: input.jobId },
      select: { attempts: true, maxAttempts: true },
    });
    if (!row) throw new Error(`Job ${input.jobId} not found`);

    const exhausted = input.nonRetryable || row.attempts >= row.maxAttempts;
    const truncated = truncate(input.error, 1024);

    if (exhausted) {
      return this.prisma.job.update({
        where: { id: input.jobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          lastError: truncated,
        },
      });
    }

    // Exponential backoff: 30s, 2m, 8m, 32m, … (4× growth, capped
    // at 1h). Jitter ±20% so a thundering-herd of failures doesn't
    // re-fire in lockstep.
    const baseSec = Math.min(30 * Math.pow(4, row.attempts - 1), 3600);
    const jitter = baseSec * (0.8 + Math.random() * 0.4);
    const nextRunAt = new Date(Date.now() + jitter * 1000);

    return this.prisma.job.update({
      where: { id: input.jobId },
      data: {
        status: 'PENDING',
        runAt: nextRunAt,
        lastError: truncated,
      },
    });
  }

  /**
   * Operator-tier — kill a job that's stuck or no longer relevant.
   * Used by the future Ops UI's "abort job" button.
   */
  async kill(jobId: string): Promise<Job> {
    return this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'DEAD', completedAt: new Date() },
    });
  }

  /**
   * Aggregate counts by status — feeds the ops dashboard's
   * queue-depth widget.
   */
  async stats(): Promise<Record<JobStatus, number>> {
    const groups = await this.prisma.job.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const out: Record<JobStatus, number> = {
      PENDING: 0,
      SCHEDULED: 0,
      RUNNING: 0,
      SUCCEEDED: 0,
      FAILED: 0,
      DEAD: 0,
    };
    for (const g of groups) {
      out[g.status] = g._count._all;
    }
    return out;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

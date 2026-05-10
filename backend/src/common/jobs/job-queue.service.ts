import { Injectable, Logger } from '@nestjs/common';
import {
  Job,
  JobStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RequestContext } from '../observability/request-context';

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
          // Phase 22 — stamp the originating request's correlation
          // id so logs / dead-letter queue rows / audit trail link
          // back to the request that scheduled the work.
          correlationId: RequestContext.requestId(),
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
   *
   * Stamps `lockedAt` + `lockedBy` so the Phase 22 stuck-job sweeper
   * can detect orphaned RUNNING rows whose worker crashed mid-run.
   */
  async claimNext(now: Date = new Date()): Promise<Job | null> {
    // FOR UPDATE SKIP LOCKED: exactly one concurrent claimer wins
    // each row. The status flip to RUNNING is what makes the row
    // invisible to subsequent claimers; SKIP LOCKED prevents the
    // claimers' own SELECTs from blocking each other.
    const lockedBy = `${process.env.HOSTNAME ?? 'host'}:${process.pid}`;
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
          lockedAt: now,
          lockedBy,
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
        // Release the lock so the sweeper doesn't flag this row.
        lockedAt: null,
        lockedBy: null,
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
      // Phase 22 — terminal failures land in FAILED_PERMANENT so the
      // operator dead-letter-queue panel can list them distinctly
      // from FAILED (which is the transient "this attempt failed but
      // we're still retrying" state). Operators retry these via
      // retryFromOperator(); the row resets attempts to 0.
      return this.prisma.job.update({
        where: { id: input.jobId },
        data: {
          status: 'FAILED_PERMANENT',
          completedAt: new Date(),
          lastError: truncated,
          lockedAt: null,
          lockedBy: null,
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
        // Release the lock — the row is back on the run queue.
        lockedAt: null,
        lockedBy: null,
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
      FAILED_PERMANENT: 0,
    };
    for (const g of groups) {
      out[g.status] = g._count._all;
    }
    return out;
  }

  /**
   * Per-handler-name breakdown over the last `windowHours`. Used by
   * the Operations Center's "Per-handler" panel — answers "is this
   * one handler the source of all our queue churn?".
   *
   * Done in two queries (one per group dimension) because Prisma's
   * groupBy doesn't easily produce a (name, status) → count matrix
   * in one round-trip without raw SQL. At realistic table sizes
   * (millions of rows over months) this is fine.
   */
  async perHandlerStats(windowHours = 24): Promise<
    Array<{
      name: string;
      total: number;
      pending: number;
      running: number;
      succeeded: number;
      failed: number;
      dead: number;
      failedPermanent: number;
    }>
  > {
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
    const groups = await this.prisma.job.groupBy({
      by: ['name', 'status'],
      where: { updatedAt: { gte: since } },
      _count: { _all: true },
    });
    const map = new Map<
      string,
      {
        name: string;
        total: number;
        pending: number;
        running: number;
        succeeded: number;
        failed: number;
        dead: number;
        failedPermanent: number;
      }
    >();
    for (const g of groups) {
      const row = map.get(g.name) ?? {
        name: g.name,
        total: 0,
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        dead: 0,
        failedPermanent: 0,
      };
      row.total += g._count._all;
      switch (g.status) {
        case 'PENDING':
        case 'SCHEDULED':
          row.pending += g._count._all;
          break;
        case 'RUNNING':
          row.running += g._count._all;
          break;
        case 'SUCCEEDED':
          row.succeeded += g._count._all;
          break;
        case 'FAILED':
          row.failed += g._count._all;
          break;
        case 'DEAD':
          row.dead += g._count._all;
          break;
        case 'FAILED_PERMANENT':
          row.failedPermanent += g._count._all;
          break;
      }
      map.set(g.name, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  /**
   * List recent jobs in a specific status. Defaults to FAILED — the
   * most common operator query ("what's broken?"). Used by the
   * Operations Center's queue panel and the failed-jobs drilldown.
   */
  async listRecent(input: {
    status?: JobStatus;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      name: string;
      status: JobStatus;
      attempts: number;
      maxAttempts: number;
      runAt: string;
      startedAt: string | null;
      completedAt: string | null;
      lastError: string | null;
      createdAt: string;
    }>
  > {
    const limit = Math.min(100, Math.max(1, input.limit ?? 25));
    const rows = await this.prisma.job.findMany({
      where: input.status ? { status: input.status } : undefined,
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        runAt: true,
        startedAt: true,
        completedAt: true,
        lastError: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
      runAt: r.runAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      lastError: r.lastError,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Inspect a single job — full row including the JSON payload.
   * Operator-only. Used by the "view payload" affordance on the
   * Operations Center queue panel.
   */
  async inspect(jobId: string): Promise<Job | null> {
    return this.prisma.job.findUnique({ where: { id: jobId } });
  }

  /**
   * Operator retry — mark a FAILED / FAILED_PERMANENT / DEAD job as
   * PENDING with runAt=now. Resets attempts to 0 so the runner
   * gives it the full retry budget again. Returns the updated row.
   *
   * No-op (returns the row unchanged) when the job is already
   * PENDING / RUNNING / SUCCEEDED — those states are not retryable.
   */
  async retryFromOperator(jobId: string): Promise<Job> {
    const row = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!row) throw new Error(`Job ${jobId} not found`);
    if (
      row.status !== 'FAILED' &&
      row.status !== 'FAILED_PERMANENT' &&
      row.status !== 'DEAD'
    ) {
      // Surface as the existing row — caller can branch on
      // status if it cares. We don't throw because "retry succeeded"
      // is the same observable outcome from the operator UI.
      return row;
    }
    return this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        runAt: new Date(),
        attempts: 0,
        lastError: null,
        startedAt: null,
        completedAt: null,
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  /**
   * Phase 22 — bulk retry every job in the dead-letter queue
   * (FAILED_PERMANENT). Optionally filtered by handler name to give
   * operators a "retry all subscription_expiring_notice failures"
   * affordance vs. a global "retry everything that's broken".
   *
   * Capped at `limit` rows (default 100, max 500) per call so a
   * mistake can't wedge the queue with thousands of resurrected jobs.
   */
  async bulkRetryDeadLetters(input: {
    name?: string;
    limit?: number;
  }): Promise<{ retried: number }> {
    const limit = Math.min(500, Math.max(1, input.limit ?? 100));
    const candidates = await this.prisma.job.findMany({
      where: {
        status: 'FAILED_PERMANENT',
        ...(input.name ? { name: input.name } : {}),
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
      select: { id: true },
    });
    if (candidates.length === 0) return { retried: 0 };
    const result = await this.prisma.job.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: {
        status: 'PENDING',
        runAt: new Date(),
        attempts: 0,
        lastError: null,
        startedAt: null,
        completedAt: null,
        lockedAt: null,
        lockedBy: null,
      },
    });
    this.logger.warn(
      `[ops] bulk retry dead-letter rows: handler=${input.name ?? '<any>'} count=${result.count}`,
    );
    return { retried: result.count };
  }

  /**
   * Phase 22 — list the dead-letter queue. Operator-only. Filterable
   * by handler name so the cockpit can show "all permanent failures"
   * or drill into one handler.
   */
  async listDeadLetters(input: { name?: string; limit?: number }): Promise<
    Array<{
      id: string;
      name: string;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      completedAt: string | null;
      correlationId: string | null;
      payload: unknown;
    }>
  > {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const rows = await this.prisma.job.findMany({
      where: {
        status: 'FAILED_PERMANENT',
        ...(input.name ? { name: input.name } : {}),
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        completedAt: true,
        correlationId: true,
        payload: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
      lastError: r.lastError,
      completedAt: r.completedAt?.toISOString() ?? null,
      correlationId: r.correlationId,
      payload: r.payload,
    }));
  }

  /**
   * Phase 22 — stuck-job sweeper. Detects RUNNING rows whose
   * `lockedAt` is older than `thresholdMinutes` (default 10) and
   * unlocks them: status→PENDING, lockedAt/lockedBy cleared,
   * runAt=now (immediate retry). The attempt counter is preserved
   * so a perpetually-stuck job will eventually exhaust and land in
   * the dead-letter queue.
   *
   * Returns the unlocked job ids so callers (the JobRunnerService
   * heartbeat loop, an operator endpoint) can log + alert on the
   * specific rows. Empty array on a healthy queue.
   *
   * Safe to call concurrently — uses updateMany with a precise
   * where clause; double-firing the sweep is a no-op on the second
   * call.
   */
  async sweepStuck(input: { thresholdMinutes?: number } = {}): Promise<{
    unlocked: number;
    ids: string[];
  }> {
    const thresholdMin = Math.max(1, input.thresholdMinutes ?? 10);
    const cutoff = new Date(Date.now() - thresholdMin * 60_000);
    const candidates = await this.prisma.job.findMany({
      where: {
        status: 'RUNNING',
        lockedAt: { lt: cutoff },
      },
      select: { id: true, name: true, lockedBy: true, attempts: true },
    });
    if (candidates.length === 0) return { unlocked: 0, ids: [] };
    const ids = candidates.map((c) => c.id);
    await this.prisma.job.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'PENDING',
        runAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: `Auto-recovered: lock held > ${thresholdMin}min, presumed worker crash.`,
      },
    });
    for (const c of candidates) {
      this.logger.error(
        `[ops] stuck job swept id=${c.id} name=${c.name} lockedBy=${c.lockedBy} attempts=${c.attempts}`,
      );
    }
    return { unlocked: candidates.length, ids };
  }

  /**
   * Operator cancel — mark a PENDING job DEAD so the runner skips it.
   * Refuses to cancel a RUNNING job (the worker holds the row; we'd
   * race the lock and confuse the state machine). Operator can wait
   * for the run to finish and then delete via a separate path if
   * needed.
   */
  async cancelFromOperator(jobId: string): Promise<Job> {
    const row = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!row) throw new Error(`Job ${jobId} not found`);
    if (row.status === 'RUNNING') {
      throw new Error(
        'Cannot cancel a job while it is RUNNING — wait for it to finish.',
      );
    }
    if (
      row.status === 'SUCCEEDED' ||
      row.status === 'FAILED' ||
      row.status === 'DEAD'
    ) {
      // Already terminal. No-op.
      return row;
    }
    return this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'DEAD', completedAt: new Date() },
    });
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

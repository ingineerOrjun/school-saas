import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { JobNonRetryableError } from './job-handler.interface';
import { JobQueueService } from './job-queue.service';
import { JobRegistry } from './job-registry.service';

// ---------------------------------------------------------------------------
// JobRunnerService — the in-process worker.
//
// Polls the queue every POLL_INTERVAL_MS (default 1s) and dispatches
// each due job to its registered handler. Single-worker by design
// for v1 — concurrency is a Phase-future tuning knob.
//
// Lifecycle:
//   • OnApplicationBootstrap → start polling (after all modules
//     have registered their handlers).
//   • OnApplicationShutdown → stop polling + wait for the in-flight
//     job to settle (up to 30s) so we don't strand a half-run row.
//
// Why poll instead of LISTEN/NOTIFY:
//   Postgres pub/sub adds connection-pool complexity and only saves
//   the 1s latency that 99% of operator-visible work doesn't care
//   about. When we move to BullMQ, the runner gets replaced by
//   BullMQ's own worker — this poll-loop is throwaway code.
//
// Test mode:
//   `disablePolling=true` (set via env JOBS_AUTOSTART=false) keeps
//   the runner registered but never polls. Tests dispatch via
//   `runOnceForTesting()` for deterministic assertions.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

@Injectable()
export class JobRunnerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JobRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private stopping = false;
  private readonly disablePolling: boolean;

  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: JobRegistry,
  ) {
    // Tests + e2e setups can opt out of the poll loop.
    this.disablePolling =
      (process.env.JOBS_AUTOSTART ?? '').toLowerCase() === 'false';
  }

  onApplicationBootstrap() {
    if (this.disablePolling) {
      this.logger.warn(
        'JOBS_AUTOSTART=false — runner registered but poll loop disabled.',
      );
      return;
    }
    this.logger.log(
      `Job runner starting (poll every ${POLL_INTERVAL_MS}ms, ` +
        `${this.registry.list().length} handlers registered)`,
    );
    this.scheduleNext();
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      this.logger.log('Waiting for in-flight job to settle…');
      const settled = await Promise.race([
        this.inFlight.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS),
        ),
      ]);
      if (!settled) {
        this.logger.warn('Shutdown timeout reached with job still in flight.');
      }
    }
  }

  /**
   * Run one tick: claim the next due job and execute it. Public so
   * tests can drive deterministically without waiting on the timer.
   * Returns the executed job's id, or null if nothing was due.
   */
  async runOnceForTesting(): Promise<string | null> {
    const job = await this.queue.claimNext();
    if (!job) return null;
    await this.execute(job.id, job.name, job.payload, job.attempts);
    return job.id;
  }

  private scheduleNext() {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick() {
    try {
      const job = await this.queue.claimNext();
      if (job) {
        // Capture the in-flight promise so shutdown can await it.
        this.inFlight = this.execute(
          job.id,
          job.name,
          job.payload,
          job.attempts,
        ).finally(() => {
          this.inFlight = null;
        });
        await this.inFlight;
      }
    } catch (e) {
      // Polling failure (DB hiccup, etc.) is logged and the loop
      // continues — we don't want a transient blip to wedge the
      // worker permanently.
      this.logger.error(
        `Job poll tick failed: ${e instanceof Error ? e.message : String(e)}`,
        e instanceof Error ? e.stack : undefined,
      );
    } finally {
      this.scheduleNext();
    }
  }

  private async execute(
    jobId: string,
    name: string,
    payload: unknown,
    attempt: number,
  ): Promise<void> {
    const handler = this.registry.get(name);
    const log = new Logger(`Job:${name}`);
    if (!handler) {
      // No handler compiled for this job. Mark FAILED non-retryable
      // — retrying won't make the handler appear.
      log.error(
        `No handler registered for job "${name}" (jobId=${jobId}). Marking FAILED.`,
      );
      await this.queue.markFailed({
        jobId,
        error: `No handler registered for "${name}". This is a programmer error — register the handler at module init.`,
        nonRetryable: true,
      });
      return;
    }

    log.debug(`Running attempt ${attempt} for jobId=${jobId}`);
    try {
      await handler.run(payload, { jobId, attempt, logger: log });
      await this.queue.markSucceeded(jobId);
      log.debug(`Succeeded jobId=${jobId}`);
    } catch (e) {
      const nonRetryable = e instanceof JobNonRetryableError;
      const errMsg = e instanceof Error ? e.message : String(e);
      log.warn(
        `Failed attempt ${attempt} for jobId=${jobId}: ${errMsg}` +
          (nonRetryable ? ' (non-retryable — no backoff)' : ''),
      );
      await this.queue.markFailed({ jobId, error: errMsg, nonRetryable });
    }
  }
}

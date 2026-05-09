# Background Jobs

Phase 15 in-process job system. Persistent, retry-capable, dedupe-aware,
and future-compatible with BullMQ when we outgrow Postgres-backed
polling.

## Why we have it

The platform was running everything synchronously inside the request
cycle. That's fine for operator-triggered actions, but breaks down for:

- **Fan-out from a cron** — a daily scan that hits 500 schools
  shouldn't block on each email.
- **Retry on transient failure** — an SMTP blip dropping one email
  shouldn't require a re-cron-run for that recipient.
- **Idempotent producers** — re-running a scan shouldn't spam.

The job system is the foundation. `notification.send_delivery` and
`platform.subscription_expiring_notice` are the first handlers; more
will follow.

## Concepts

- **Producer** — code that calls `JobQueueService.enqueue({ name,
  payload, dedupeKey?, runAt? })`. Returns a job id.
- **Handler** — `@Injectable()` class implementing `JobHandler`.
  Registered with `JobRegistry.register()` at module init.
- **Runner** — `JobRunnerService`. Polls every 1s for the next due
  job and dispatches it to its handler. Single-worker for v1.
- **Queue** — the `jobs` table in Postgres. Source of truth for
  retry state, idempotency, and observability.

## Lifecycle

```
PENDING (runAt <= now)
   ↓ JobRunner.claimNext (FOR UPDATE SKIP LOCKED)
RUNNING
   ↓ handler resolved
SUCCEEDED ──────── done.

RUNNING
   ↓ handler threw
   ↓ attempts < maxAttempts?
   ├── yes → PENDING with backoff (30s, 2m, 8m, 32m, …, capped 1h)
   └── no  → FAILED (also if handler threw JobNonRetryableError)

(Operator-killed) → DEAD (no automatic transition)
```

## Writing a handler

```ts
import {
  JobHandler,
  JobNonRetryableError,
} from '@/common/jobs/job-handler.interface';

@Injectable()
export class MyHandler implements JobHandler<MyPayload> {
  name = 'my.feature.do_thing';
  maxAttempts = 3;

  constructor(private readonly prisma: PrismaService) {}

  async run(payload: MyPayload, ctx: JobContext): Promise<void> {
    const row = await this.prisma.thing.findUnique({
      where: { id: payload.thingId },
    });
    if (!row) {
      // No row → retrying won't help.
      throw new JobNonRetryableError(`Thing ${payload.thingId} gone`);
    }
    // Do the work. Throw on retryable failure.
  }
}
```

Then register at module init:

```ts
@Module({ providers: [MyHandler, ...] })
export class MyModule implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly handler: MyHandler,
  ) {}
  onModuleInit() {
    this.registry.register(this.handler);
  }
}
```

## Producing jobs

```ts
await this.queue.enqueue({
  name: 'my.feature.do_thing',
  payload: { thingId: 'abc' },
  dedupeKey: `thing:${thingId}:do_thing`,  // optional
  runAt: new Date(Date.now() + 60_000),    // optional, defer
  maxAttempts: 5,                           // optional, defaults to 3
});
```

`dedupeKey` is the same idempotency mechanism as notifications. Pick
a key tied to the event, not the attempt — re-enqueues collapse to
the existing job row.

## Test mode

Set `JOBS_AUTOSTART=false` to disable the poll loop. Tests can
then drive the runner deterministically:

```ts
await jobRunner.runOnceForTesting(); // drains exactly one job
```

This is the right setup for any test that exercises the queue —
otherwise the 1s poll loop fires under your feet.

## Operational queries

```sql
-- Pending work
SELECT id, name, runAt, attempts FROM jobs
WHERE status = 'PENDING' ORDER BY runAt ASC LIMIT 20;

-- Recent failures
SELECT name, lastError, attempts FROM jobs
WHERE status = 'FAILED' ORDER BY completedAt DESC LIMIT 20;

-- Status breakdown
SELECT status, COUNT(*) FROM jobs GROUP BY status;

-- Stuck RUNNING (worker crashed mid-run)
SELECT * FROM jobs WHERE status = 'RUNNING'
AND startedAt < NOW() - INTERVAL '5 minutes';
```

The future Ops Dashboard surfaces these as widgets. For now, the
queries above are how operators triage.

## Migration to BullMQ

When we outgrow Postgres polling (probably around 100 jobs/sec
sustained), the migration path is:

1. Swap `JobQueueService.claimNext` to a `BullMQ Worker`.
2. `JobQueueService.enqueue` becomes `Queue.add` (same dedupeKey
   semantics map to BullMQ's `jobId`).
3. `JobRunnerService` is deleted (BullMQ owns the worker loop).
4. `JobRegistry` stays as-is — it's the framework-agnostic name
   → handler map.
5. The `jobs` table becomes a long-term audit log (or is dropped).

Handler interface (`JobHandler`) doesn't change. That's the point
of the abstraction.

## What's NOT here yet

- Concurrency tuning (`workerCount`). Single worker for v1.
- A "resume DEAD jobs" affordance. Operators kill jobs but can't
  un-kill them yet.
- Per-handler maxAttempts overrides at enqueue time (the handler's
  static `maxAttempts` wins today).
- Scheduled / recurring jobs at the queue layer — we still use
  `@nestjs/schedule` for cron triggers; they enqueue jobs.

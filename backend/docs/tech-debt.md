# Backend tech-debt log

Findings worth fixing eventually but not blocking current work.
Add new entries with the date investigated.

---

## Job queue polls every second when idle

`JobQueueService` runs `SELECT id FROM jobs ... FOR UPDATE SKIP LOCKED`
once per second whether there is work or not. At ~86 400 transactions/day
per worker, this is wasteful at scale (and noisy in dev — the [prisma]
event log during the latency investigation showed it dominating stdout
during quiet periods).

Consider:
- Increasing the idle polling interval to 5–10 seconds with backoff
  (long-poll on miss, immediate on hit).
- Switching to PostgreSQL `NOTIFY` / `LISTEN` for push-based work
  (publisher: anything that enqueues a job; subscriber: the worker).

Investigated 2026-05-11 during the dashboard latency investigation.

---

## `auth+guards` phase intermittently slow (200–600 ms)

Round-2 timing instrumentation (`[timing] reqId=… auth+guards=Xms`)
showed some requests taking 200–600 ms in the guard phase when the
median is 10–50 ms. The slow case correlates loosely with cold-cache
boots but reproduces under warm conditions too — not pure
JIT/connection-pool ramp.

Likely candidates worth checking:
- `JwtStrategy.validate` — hits a User row by id on every request to
  enforce `tokensValidAfter`. Could be cached or skipped on a fast
  path.
- `UserAwareThrottlerGuard.getTracker` — does a synchronous JWT decode
  per request; cheap in isolation, possibly contended under burst.
- Tenant resolution / school lookup running in a guard or pipe before
  the controller handler.

Worth a focused investigation when production traffic warrants
(p95 latency budget pressure, complaint volume). The Round-2
instrumentation pattern (timing interceptor + Prisma event log,
all marked `TEMPORARY DIAGNOSTIC`) is documented in git history
of this same investigation and can be re-applied for a follow-up.

Investigated 2026-05-11.

# Integration Testing

_Last updated: 2026-07-19 — Phase RELIABILITY-II Part 8._
_Audience: backend engineers writing tests that need real Postgres._

This is how the integration test harness works in this repo, why it
was built that way, and how to add new tests.

## 1. What the harness is

The harness lives under `backend/test/integration/`:

- `harness.ts` — boots an ephemeral Postgres container, applies the
  Prisma migrations, exposes a `PrismaClient`.
- `fixtures.ts` — composable seed builders (school, admin, class,
  student, session, exam).
- `jest-integration.json` — separate Jest config that picks up
  `*.integration-spec.ts` files only.
- `concurrency.integration-spec.ts`,
  `archive-lifecycle.integration-spec.ts` — the existing suites.

Critically, the harness uses `docker run` directly — **no
testcontainers npm dependency**. That keeps the harness zero-deps
and works on any host with a Docker CLI.

## 2. Running locally

Requirements:
- Docker installed and the daemon running. Verify with `docker info`.

```sh
npm run test:integration
```

What that does:
1. Boots `postgres:16-alpine` on a unique high port (54320 +
   `pid % 1000`).
2. Polls for readiness (typically <3s).
3. Runs `npx prisma migrate deploy` against the container.
4. Runs every `*.integration-spec.ts` under `test/integration/`.
5. `docker stop`s the container at the end.

Per-run cost on a warm image: ~5-15s of overhead before the first
test runs.

## 3. What happens without Docker

Each integration spec wraps its tests in `describeWithDb(...)`. If
Docker is **not** available, the suite logs a "skipped" message and
exits 0. This means:

- `npm run test` (unit suite) is unaffected — it doesn't touch
  `test/integration` because the unit config has `rootDir: "src"`.
- `npm run test:integration` on a Docker-less host returns 0 with
  skip notices, not failure. CI without Docker still passes.

This is intentional: the *correctness* of the integration tests is
unverifiable without Docker. By skipping rather than failing, we
keep the suite available for any contributor with Docker (and any
CI runner with Docker) without forcing everyone to have Docker.

## 4. Adding a new integration spec

Filename pattern: `<topic>.integration-spec.ts`.

Minimal skeleton:

```ts
import { PrismaClient } from '@prisma/client';
import {
  describeWithDb,
  startIntegrationDb,
  stopIntegrationDb,
  truncateAll,
} from './harness';
import { seedSchoolWithRoster } from './fixtures';

describeWithDb('my topic (real DB)', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    client = await startIntegrationDb();
  }, 90_000);

  afterAll(async () => {
    await stopIntegrationDb();
  });

  beforeEach(async () => {
    await truncateAll(client);
  });

  it('asserts something interesting about real Postgres behavior', async () => {
    const { school, students } = await seedSchoolWithRoster(client, {
      studentCount: 3,
    });
    // …
  });
});
```

Conventions:

- **`describeWithDb`** at the top — not raw `describe` — so the
  suite skips gracefully without Docker.
- **`beforeAll(startIntegrationDb, 90_000)`** — the 90s timeout
  covers image pull on first run + a slow CI.
- **`beforeEach(truncateAll)`** — every test starts on an empty
  DB. Mostly. See section 6 for the exception.
- **`afterAll(stopIntegrationDb)`** — releases the container.

## 5. What integration tests should ASSERT

The unit suite already covers shape + branch logic. Integration
specs exist to prove things the unit suite **cannot**:

1. **Uniqueness invariants under race** — the partial-unique-index
   on `(schoolId)` for `isActive=true` sessions, the unique
   `(schoolId, schoolCode)` index on schools. Use `Promise.allSettled`
   and assert "exactly one fulfilled, one rejected with P2002."

2. **FK + cascade behavior** — archiving a student must NOT cascade
   to results / attendance. Integration spec proves the linked rows
   survive.

3. **`txWithRetry` against real contention** — the helper's unit
   tests fake P2034 via mocks. The integration spec sets up real
   row-level contention and asserts the telemetry counters move
   correctly.

4. **End-state determinism after a real race** — two concurrent
   archive vs restore writes; asserting "the final state is one of
   {archived, restored}, never an intermediate corruption."

What integration specs should **NOT** assert:

- Pure shape / output of pure functions — that's a unit test.
- Service-layer DTO validation — Nest's class-validator already
  enforces this; unit tests cover service-level rejections.
- HTTP-layer concerns (auth, throttle) — those need a TestModule
  with the full Nest graph, not just Prisma.

## 6. Truncate vs reset

`truncateAll(client)` runs `TRUNCATE … RESTART IDENTITY CASCADE`
on every known table in dependency order. It's fast (~50ms) on an
empty database.

For specs that exercise the same row across multiple `it()` blocks
intentionally (rare), skip the `beforeEach(truncateAll)` and
manually seed once in `beforeAll`. Document it in a comment so the
next reader doesn't break the assumption.

## 7. CI compatibility

The harness was authored on a host **without** Docker. Every
integration spec currently shipped is therefore "shipped but
unverified locally". When CI gets a Docker-enabled runner:

1. Add `npm run test:integration` to the CI pipeline AFTER the unit
   tests.
2. On the first run, expect ~30s overhead while the image pulls.
3. Subsequent runs reuse the cached image; expect ~5s overhead.
4. The suite uses `maxWorkers: 1` — total runtime ≈ sum of
   individual specs. Parallel isolation across specs is not worth
   the debugging cost on a one-Postgres container.

If a spec is flaky on CI, prefer fixing the test over disabling.
Common causes:

- Race assertions that assume "exactly one wins" when Postgres
  permits "both win" under READ COMMITTED. Add explicit
  `isolationLevel: 'RepeatableRead'` to the transaction.
- Forgotten `truncateAll` — earlier-spec rows leak into the
  current spec.
- Timing-sensitive `setTimeout` — replace with explicit
  `Promise.allSettled` joins.

## 8. What's NOT in the harness (by design)

- **No supertest / HTTP layer.** These are pure data-layer tests.
  An HTTP-level integration suite is a separate concern (and
  requires the full Nest module graph).
- **No fixture snapshots.** Snapshot diffing on integration output
  is brittle. Each spec writes its own explicit assertions.
- **No parallel test database.** `maxWorkers: 1` is intentional;
  parallel Postgres instances would multiply the boot cost without
  cleaning up the cross-spec state problem.

## 9. Existing integration coverage

| Spec | Invariants proven |
| --- | --- |
| `concurrency.integration-spec.ts` | Parallel schoolCode → P2002; parallel `setActive` → exactly one active row; parallel student create with same regNo → P2002; txWithRetry telemetry under real contention |
| `archive-lifecycle.integration-spec.ts` | Archived student excluded from default filter; direct-by-id read still works; restore clears the triplet; parallel archive+restore yields a coherent end-state (never partial-write corruption) |

Future integration specs to add (deferred to RELIABILITY-III; see
the phase report):

- Promotion under concurrency (two operators running promotion at
  once)
- Marks publish with mid-write lock-toggle race
- Fee refund + payment-status race

## 10. The skip-on-no-Docker pattern

Every integration spec currently in the repo is **shipped but
NOT verified locally** because the authoring environment lacks
Docker. The harness was authored carefully against the documented
Docker behavior; the next contributor with Docker should run
`npm run test:integration` and report any failures.

If a spec fails on first Docker run, the most likely causes:

1. Wrong Postgres version (try matching the production image).
2. Migration drift (run `npx prisma migrate deploy` against the
   container manually first).
3. Port collision (the harness chooses `54320 + pid % 1000`; if
   another process holds the port, jest will time out waiting for
   the container to become ready).

Report findings + fixes back into this doc so the harness improves.

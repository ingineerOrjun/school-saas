# Runtime Validation Report

_Last updated: 2026-07-21 — Phase RELIABILITY-III Part 1._

This document records, with full honesty, the runtime status of the
integration test suite as authored in this phase. The spec explicitly
forbade faking results — this is the truthful account.

## TL;DR

- The integration test code exists (5 spec files, 19 test cases) and
  is **TypeScript-clean + Jest-clean**.
- The harness's skip-on-no-Docker behaviour was **verified empirically**:
  `npm run test:integration` exits 0 with all 19 tests skipped.
- The integration tests themselves have **not yet been executed
  against real Postgres** because Docker is not installed on the
  authoring host.
- The first contributor or CI runner with Docker is expected to run
  the suite and report findings back into this document.

## What was authored and verified

| File | Status |
| --- | --- |
| `backend/test/integration/harness.ts` | Authored. TypeScript-clean. Skip-on-no-Docker behavior verified. |
| `backend/test/integration/fixtures.ts` | Authored. TypeScript-clean. |
| `backend/test/integration/jest-integration.json` | Authored. Runs in jest. |
| `backend/test/integration/concurrency.integration-spec.ts` | Authored. 4 cases. Skipped on this host. |
| `backend/test/integration/archive-lifecycle.integration-spec.ts` | Authored. 3 cases. Skipped on this host. |
| `backend/test/integration/promotion-race.integration-spec.ts` | Authored. 4 cases. Skipped on this host. |
| `backend/test/integration/marks-lock-race.integration-spec.ts` | Authored. 4 cases. Skipped on this host. |
| `backend/test/integration/financial-race.integration-spec.ts` | Authored. 4 cases. Skipped on this host. |
| `npm run test:integration` | Added. Exits 0 on Docker-less host. |

## Docker check on the authoring host

Two probes, both returned "command not found":

```text
PS> docker --version
docker: The term 'docker' is not recognized as the name of a cmdlet…

PS> docker info
docker: The term 'docker' is not recognized as the name of a cmdlet…
```

Common Docker Desktop install paths were also probed; none existed:

```text
MISSING: C:\Program Files\Docker\Docker\resources\bin\docker.exe
MISSING: C:\Program Files\Docker\Docker\Docker Desktop.exe
MISSING: C:\ProgramData\DockerDesktop\version-bin\docker.exe
MISSING: %LOCALAPPDATA%\Programs\Docker\Docker\resources\bin\docker.exe
```

This is a hard runtime constraint on the authoring environment, not a
code defect. Installing Docker Desktop and starting the daemon would
unblock execution.

## Skip behavior — verified empirically

Running `npm run test:integration` on the Docker-less host produced:

```text
Test Suites: 5 skipped, 0 of 5 total
Tests:       19 skipped, 19 total
Snapshots:   0 total
Time:        5.033 s
Ran all test suites.
```

Exit code: `0`. CI without Docker stays green.

This is the contract the harness promises:

- `describeWithDb` checks `docker --version` + `docker info`; if
  either fails the suite is skipped via Jest's `describe.skip`.
- `startIntegrationDb()` throws a clear operator-facing error if
  called without Docker (preventing accidental misuse from
  unintended Jest paths).
- The unit-test suite has `rootDir: "src"`, so it never picks up
  `test/integration/*`. The two suites are fully isolated.

## What we DID NOT do — and why

- We did NOT add a CI-time Docker install step. CI configuration is
  out of scope for this phase. The npm script is in place; a CI
  config can call it once Docker is provisioned.
- We did NOT fake the output of integration runs. The spec
  explicitly forbade it; we honour that.
- We did NOT add a fallback to a pre-existing local Postgres. The
  harness must be ephemeral + deterministic; depending on developer-
  local state would defeat the point.

## What happens on the first Docker run

When a contributor runs `npm run test:integration` with Docker:

1. Harness probes `docker --version` + `docker info`. Both succeed.
2. Spawns `postgres:16-alpine` on `127.0.0.1:543XX` (port chosen as
   `54320 + pid % 1000` to avoid collisions).
3. Polls `SELECT 1` for up to 60 seconds.
4. Runs `npx prisma migrate deploy` against the container.
5. Runs all 19 test cases.
6. `docker stop`s the container.

Expected total: 15-30 seconds on first run (image pull), 5-10 seconds
on subsequent runs (cached image).

## Probable adjustment points on first run

These are educated guesses based on careful authoring. The first
Docker run will likely surface ONE or TWO real issues — that's the
nature of unverified test code. The most likely candidates:

1. **Isolation level on the deadlock test.** The
   `concurrency.integration-spec.ts → txWithRetry telemetry counts
   attempts and retries under contention` case uses
   `isolationLevel: 'RepeatableRead'`. Real Postgres may or may not
   produce a P2034 depending on row-lock timing; the assertion
   tolerates this (asserts attempts ≥ 2, not exactly 2-with-retry).
   If the test is flaky on CI, switch to `'Serializable'` for the
   contention case — guaranteed to throw on conflict.

2. **Migration drift.** `npx prisma migrate deploy` against a fresh
   container should pick up every committed migration. If the schema
   has any `prisma db push`-only changes that didn't make it into a
   migration file, the integration DB will diverge from production.
   Verify migration files cover all schema changes before the first
   integration run.

3. **`prisma generate` not run.** The harness uses the committed
   `@prisma/client` from `node_modules`. A fresh checkout without
   `npm install` would crash. CI usually runs `npm ci` first; local
   developers do too. Documented in the harness comment.

4. **Port collision.** The harness picks `54320 + pid % 1000`. If
   the host has something else on that exact port the container will
   fail to start. Symptom: `waitForPostgresReady` times out at 60s.
   Workaround: free the port or change `PG_PORT` in `harness.ts`.

5. **`pg_isready` not bundled.** We don't use `pg_isready`; we use
   a Prisma `SELECT 1` probe inside a small retry loop. No external
   tools required.

## What the integration tests prove (once run)

See `CONCURRENCY_TEST_MATRIX.md` for the full table. Highlights:

| Invariant | Test case |
| --- | --- |
| Unique schoolCode | `concurrency` → `rejects parallel school creates with the same schoolCode` |
| Single active session | `concurrency` → `only one active session survives parallel activate` |
| Unique registration number | `concurrency` → `rejects parallel student creation with the same registrationNumber` |
| txWithRetry telemetry under contention | `concurrency` → `txWithRetry telemetry counts attempts and retries under contention` |
| Archived row excluded from default filter | `archive-lifecycle` → `archived student disappears from default filter but is still readable by id` |
| Restore is idempotent | `archive-lifecycle` → `restoring clears archive triplet` |
| Archive vs restore race is coherent | `archive-lifecycle` → `parallel archive + restore: end state is deterministic` |
| Parallel promotion can't double-write | `promotion-race` → `parallel promotion runs against the same student yield exactly one snapshot` |
| Preview is read-only | `promotion-race` → `preview-shaped read does not write any rows` |
| Archived students excluded from promotion candidates | `promotion-race` → `archived students are excluded from default promotion candidate list` |
| FK-protected session deletion | `promotion-race` → `promoting into a deleted session surfaces an FK error` |
| Locked exam guard prevents writes | `marks-lock-race` → `locked exam: in-process guard rejects bulk-save before the DB write` |
| Archived exam state preserved | `marks-lock-race` → `archived exam: assertEditable equivalent rejects mark writes` |
| Lock-flag determinism under race | `marks-lock-race` → `parallel lock + unlock yields one final state, no partial corruption` |
| Lock-toggle + bulk-write race | `marks-lock-race` → `bulk write + lock toggle: any written results pair with one consistent exam state` |
| No double-refund | `financial-race` → `rejects parallel refunds against the same source payment` |
| Receipts survive archive | `financial-race` → `archiving a student preserves their payment receipts` |
| Receipts survive restore | `financial-race` → `restoring a previously-archived student returns the payment history intact` |
| Payment-status flip determinism | `financial-race` → `parallel status flips end on a well-defined value, never partial` |

19 invariants total. Each lives in a test case named for the
invariant — when a test fails on first Docker run, the failure
message names which invariant broke.

## Where to update this document

After the first real Docker run:

- Replace the "Probable adjustment points" section with the actual
  findings.
- Add a "Verified-on" section with the test runtime, host, Docker
  version, Postgres version, and per-case duration.
- If any test was flagged flaky, document the fix in
  `CONCURRENCY_TEST_MATRIX.md` and rerun.

This document is the truthful runtime status. Update it when reality
changes.

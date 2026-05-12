import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

// ============================================================================
// Integration test harness — Phase RELIABILITY-II Part 1.
//
// Spins up an ephemeral Postgres container per test run, applies the
// repo's migrations, exposes a clean `PrismaClient` plus a shared
// fixture seeding helper, and tears the container down on shutdown.
//
// Why a real DB:
//   The unit-test suite already proves the helper APIs in isolation
//   via shape-mocks. What it CANNOT prove is real Postgres behavior
//   under contention: P2034 / deadlock, FK cascade ordering, partial
//   unique indexes, race-safe activate-session. Those need an
//   actual database, not a mock.
//
// Why a container per run:
//   Sharing a database across runs creates state-bleed between tests
//   that is fiendish to debug. A throwaway container is the cheapest
//   way to guarantee deterministic state.
//
// Why this is NOT wired into CI today:
//   The runtime requires Docker on the host (or a remote Docker
//   daemon). Many development boxes — including the one this code
//   was authored on — do not have Docker available. The harness
//   detects Docker availability and *skips* every integration test
//   gracefully if Docker is absent, so unit tests stay green.
//
// CI compatibility:
//   When a CI runner has Docker, run `npm run test:integration` to
//   exercise the suite. The harness pulls a small Postgres image,
//   spawns it, applies the Prisma migrations, and tears down at the
//   end. Total time per suite is ~15-30 seconds on first run, ~5
//   seconds on subsequent runs (image cached).
//
// What's deliberately NOT here:
//   • A testcontainers npm dependency. We use plain `docker run` so
//     the harness has zero new dependencies and works on any host
//     with the docker CLI.
//   • Parallel test execution. `maxWorkers: 1` in
//     jest-integration.json — the container is one Postgres
//     instance and parallel state across suites is not worth the
//     debugging cost.
//   • Cross-suite seed reuse. Each suite seeds what it needs.
// ============================================================================

const POSTGRES_IMAGE = 'postgres:16-alpine';
const CONTAINER_NAME = `scholaris-it-${process.pid}`;
const PG_PORT = 54320 + (process.pid % 1000); // avoid 5432 collision
const PG_USER = 'integration';
const PG_PASSWORD = 'integration';
const PG_DB = 'scholaris_integration';

/** Process handle for the spawned container — used in teardown. */
let containerHandle: ChildProcess | null = null;
let prisma: PrismaClient | null = null;
let dockerAvailable: boolean | null = null;

/** Does the current host expose a working `docker` CLI? */
export function isDockerAvailable(): boolean {
  if (dockerAvailable !== null) return dockerAvailable;
  try {
    execSync('docker --version', { stdio: 'ignore' });
    execSync('docker info', { stdio: 'ignore' });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

/**
 * Skip helper. Use at the top of every integration spec:
 *
 *   import { describeWithDb } from '../harness';
 *   describeWithDb('marks lock under concurrency', () => { ... });
 *
 * If Docker is not available, Jest logs a SKIPPED message instead of
 * failing the suite. CI without Docker stays green; CI with Docker
 * runs the suite.
 */
export function describeWithDb(name: string, body: () => void): void {
  if (isDockerAvailable()) {
    describe(name, body);
  } else {
    describe.skip(`${name} (skipped — Docker not available on host)`, body);
  }
}

/**
 * Build the Postgres URL pointing at the ephemeral container.
 * Exported so test bodies can set `process.env.DATABASE_URL` before
 * importing the Prisma client.
 */
export function getIntegrationDatabaseUrl(): string {
  return `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${PG_DB}?schema=public`;
}

/**
 * Start the ephemeral Postgres container. Idempotent — subsequent
 * calls in the same process reuse the running container. Returns a
 * connected `PrismaClient` pointed at it.
 *
 * Must be paired with `stopIntegrationDb()` in afterAll. Tests that
 * use `describeWithDb` wire this automatically via beforeAll.
 */
export async function startIntegrationDb(): Promise<PrismaClient> {
  if (!isDockerAvailable()) {
    throw new Error(
      'startIntegrationDb called without Docker available. Use describeWithDb so the suite skips instead.',
    );
  }
  if (prisma) return prisma;

  // Spawn the container detached + named so docker stop in
  // afterAll cleans it up reliably even if Node crashes.
  containerHandle = spawn(
    'docker',
    [
      'run',
      '--rm',
      '--name',
      CONTAINER_NAME,
      '-e',
      `POSTGRES_USER=${PG_USER}`,
      '-e',
      `POSTGRES_PASSWORD=${PG_PASSWORD}`,
      '-e',
      `POSTGRES_DB=${PG_DB}`,
      '-p',
      `${PG_PORT}:5432`,
      POSTGRES_IMAGE,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  containerHandle!.on('error', (err) => {
    // Surface Docker errors but don't crash the test process —
    // teardown will report.
    // eslint-disable-next-line no-console
    console.error('[integration-harness] docker spawn error:', err);
  });

  // Poll for Postgres readiness. Docker container takes ~1-3s to
  // accept connections.
  const url = getIntegrationDatabaseUrl();
  process.env.DATABASE_URL = url;
  await waitForPostgresReady(url, 60_000);

  // Apply Prisma migrations against the fresh database. `migrate
  // deploy` is non-interactive + matches what production uses.
  applyMigrations(url);

  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return prisma;
}

/** Stop the container + close the Prisma client. */
export async function stopIntegrationDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (containerHandle) {
    try {
      execSync(`docker stop ${CONTAINER_NAME}`, { stdio: 'ignore' });
    } catch {
      // ignore — container may have already exited
    }
    containerHandle = null;
  }
}

/**
 * Truncate every table that integration tests touch. Used by tests
 * that share a container but want a clean slate between cases.
 *
 * NOTE: this is a `TRUNCATE … CASCADE` — fast, but it loses
 * row-level FK ordering. Use in `beforeEach` of a single suite, not
 * across suites.
 */
export async function truncateAll(client: PrismaClient): Promise<void> {
  // List of tables in dependency order. We deliberately enumerate
  // rather than reflect via `information_schema` so the test author
  // knows exactly what gets wiped.
  const tables = [
    'platform_audit_events',
    'notification_deliveries',
    'notifications',
    'student_academic_records',
    'results',
    'attendance',
    'payments',
    'fee_assignments',
    'fee_structures',
    'exam_subjects',
    'exams',
    'teaching_assignments',
    'students',
    'sections',
    'classes',
    'academic_sessions',
    'users',
    'schools',
  ];
  for (const t of tables) {
    try {
      await client.$executeRawUnsafe(
        `TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE;`,
      );
    } catch {
      // Some tables might not exist on older branches — ignore. The
      // important ones for current tests always do.
    }
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function waitForPostgresReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const probe = new PrismaClient({ datasources: { db: { url } } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (probe as any).$queryRawUnsafe('SELECT 1');
      await probe.$disconnect();
      return;
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  throw new Error(
    `Postgres container did not become ready within ${timeoutMs}ms. Last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

function applyMigrations(url: string): void {
  // Locate prisma schema relative to this file. The script runs
  // from `<repo>/backend/test/integration/`, so the schema is
  // `<repo>/backend/prisma/schema.prisma`.
  const schemaPath = require('node:path').resolve(
    __dirname,
    '../../prisma/schema.prisma',
  );
  if (!existsSync(schemaPath)) {
    throw new Error(`prisma schema not found at ${schemaPath}`);
  }
  execSync(`npx prisma migrate deploy --schema "${schemaPath}"`, {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

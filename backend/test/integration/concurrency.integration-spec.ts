import { Prisma, PrismaClient } from '@prisma/client';
import {
  describeWithDb,
  startIntegrationDb,
  stopIntegrationDb,
  truncateAll,
} from './harness';
import {
  seedAcademicSession,
  seedAdmin,
  seedSchool,
  seedSchoolWithRoster,
} from './fixtures';
import { txWithRetry } from '../../src/common/db/tx-retry';
import {
  _resetTransactionTelemetry,
  snapshotTransactionTelemetry,
} from '../../src/common/db/tx-telemetry';

// ============================================================================
// Concurrency integration tests — Phase RELIABILITY-II Part 3.
//
// Real-Postgres validation of the concurrency invariants we declare
// elsewhere in code + docs. Every test in this file:
//
//   1. Fires real Promise.all parallelism against a real DB.
//   2. Asserts the final committed state — not intermediate / mocked
//      behaviour.
//   3. Tolerates the "exactly one winner, N-1 expected losers"
//      pattern that's the signature of a healthy uniqueness invariant.
//
// SKIP behaviour:
//   • The suite is wrapped in `describeWithDb`, so on machines
//     without Docker (most local dev boxes, this repo's authoring
//     box) it logs "skipped" and exits 0.
//   • On CI runners with Docker, it boots a Postgres container,
//     applies migrations, and runs the suite.
//
// What we deliberately don't do:
//
//   • We don't exercise the full Nest module graph (auth, throttle,
//     etc.). These are concurrency-of-the-data-layer tests; HTTP-
//     layer race tests belong in a different file.
//   • We don't reuse data between specs. Every `it()` truncates +
//     re-seeds. Slower, but the failure messages are unambiguous.
// ============================================================================

describeWithDb('concurrency invariants (real DB)', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    client = await startIntegrationDb();
  }, 90_000);

  afterAll(async () => {
    await stopIntegrationDb();
  });

  beforeEach(async () => {
    await truncateAll(client);
    _resetTransactionTelemetry();
  });

  // -------------------------------------------------------------------------
  // 1. School identity — schoolCode uniqueness under race
  // -------------------------------------------------------------------------

  it('rejects parallel school creates with the same schoolCode', async () => {
    // Two operators submit registration with the same custom code.
    // The unique constraint must let exactly one win, force the
    // other into a P2002.
    const sameCode = 'SCH-RACE1';
    const tries = await Promise.allSettled([
      client.school.create({
        data: {
          name: 'School A',
          slug: `slug-${Date.now()}-a`,
          schoolCode: sameCode,
        },
      }),
      client.school.create({
        data: {
          name: 'School B',
          slug: `slug-${Date.now()}-b`,
          schoolCode: sameCode,
        },
      }),
    ]);

    const fulfilled = tries.filter((r) => r.status === 'fulfilled');
    const rejected = tries.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
  });

  // -------------------------------------------------------------------------
  // 2. Active session — only one survives parallel activation
  // -------------------------------------------------------------------------

  it('only one active session survives parallel activate', async () => {
    const school = await seedSchool(client);
    const sessionA = await seedAcademicSession(client, school.id, {
      isActive: false,
      name: 'Session A',
    });
    const sessionB = await seedAcademicSession(client, school.id, {
      isActive: false,
      name: 'Session B',
    });

    // Two parallel "make me active" flips. The partial unique index
    // permits exactly one row with isActive=true per school. Whichever
    // tries to set the second one races against the first's commit.
    const tries = await Promise.allSettled([
      activateSession(client, school.id, sessionA.id),
      activateSession(client, school.id, sessionB.id),
    ]);

    const activeRows = await client.academicSession.findMany({
      where: { schoolId: school.id, isActive: true },
    });
    // Invariant: at most one active row, regardless of how many
    // succeeded.
    expect(activeRows).toHaveLength(1);

    // At least one Promise.allSettled call succeeded.
    expect(tries.filter((r) => r.status === 'fulfilled').length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 3. Student registration number — uniqueness under parallel admit
  // -------------------------------------------------------------------------

  it('rejects parallel student creation with the same registrationNumber', async () => {
    const { school, klass } = await seedSchoolWithRoster(client, {
      studentCount: 0,
    });
    const regNo = 'REG-RACE-001';

    const tries = await Promise.allSettled([
      client.student.create({
        data: studentRow(school.id, klass.id, 'one', regNo),
      }),
      client.student.create({
        data: studentRow(school.id, klass.id, 'two', regNo),
      }),
    ]);

    const fulfilled = tries.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const stored = await client.student.findMany({
      where: { schoolId: school.id, registrationNumber: regNo },
    });
    expect(stored).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 4. txWithRetry — survives a real deadlock-shaped race
  // -------------------------------------------------------------------------

  it('txWithRetry telemetry counts attempts and retries under contention', async () => {
    const school = await seedSchool(client);
    const admin = await seedAdmin(client, school.id);

    // Two concurrent writes to the same row trigger row-level
    // contention. Postgres will sometimes throw a serialization
    // failure under SERIALIZABLE isolation; the retry helper
    // should pick that up. We use REPEATABLE_READ here to make
    // the contention more likely without depending on
    // serialization semantics that may not fire in CI.
    const updateLabel = `update-school-name-${Date.now()}`;
    await Promise.allSettled([
      txWithRetry(
        client as unknown as Parameters<typeof txWithRetry>[0],
        async (tx) => {
          await tx.school.update({
            where: { id: school.id },
            data: { name: 'Renamed by A' },
          });
        },
        {
          label: updateLabel,
          maxAttempts: 3,
          minBackoffMs: 5,
          maxBackoffMs: 20,
          prismaOptions: { isolationLevel: 'RepeatableRead' },
        },
      ),
      txWithRetry(
        client as unknown as Parameters<typeof txWithRetry>[0],
        async (tx) => {
          await tx.school.update({
            where: { id: school.id },
            data: { name: 'Renamed by B' },
          });
        },
        {
          label: updateLabel,
          maxAttempts: 3,
          minBackoffMs: 5,
          maxBackoffMs: 20,
          prismaOptions: { isolationLevel: 'RepeatableRead' },
        },
      ),
    ]);

    const snap = snapshotTransactionTelemetry();
    // We always record AT LEAST 2 attempts (one per call). Under
    // real contention the count goes higher when a retry fires.
    const attemptRow = snap.attempts.find((r) => r.label === updateLabel);
    expect(attemptRow).toBeDefined();
    expect(attemptRow!.count).toBeGreaterThanOrEqual(2);

    // The school name is one of the two committed values; nothing
    // corrupted.
    const final = await client.school.findUniqueOrThrow({
      where: { id: school.id },
    });
    expect(['Renamed by A', 'Renamed by B']).toContain(final.name);
    // Suppress unused-variable warning on admin (the seed asserted
    // that admin creation didn't blow up).
    expect(admin.role).toBe('ADMIN');
  });
});

// ---------------------------------------------------------------------------
// Local helpers — keep specs readable.
// ---------------------------------------------------------------------------

async function activateSession(
  client: PrismaClient,
  schoolId: string,
  sessionId: string,
) {
  // Mirror the AcademicSessionService.setActive flow: demote first,
  // then activate. We do it directly here to keep the test free of
  // Nest module wiring; the service is unit-covered separately.
  return client.$transaction(async (tx) => {
    await tx.academicSession.updateMany({
      where: { schoolId, isActive: true },
      data: { isActive: false },
    });
    return tx.academicSession.update({
      where: { id: sessionId },
      data: { isActive: true },
    });
  });
}

function studentRow(
  schoolId: string,
  classId: string,
  symbolSuffix: string,
  registrationNumber: string,
): Prisma.StudentUncheckedCreateInput {
  return {
    firstName: 'Test',
    lastName: 'Student',
    schoolId,
    classId,
    symbolNumber: `SYM-${symbolSuffix}`,
    registrationNumber,
    gender: 'OTHER',
    dateOfBirth: new Date('2010-01-01'),
    parentName: 'Test Parent',
    contactNumber: '9800000000',
  };
}

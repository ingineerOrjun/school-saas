import { PaymentStatus, PrismaClient } from '@prisma/client';
import {
  describeWithDb,
  startIntegrationDb,
  stopIntegrationDb,
  truncateAll,
} from './harness';
import {
  seedClass,
  seedSchool,
  seedStudent,
} from './fixtures';

// ============================================================================
// Financial concurrency — Phase RELIABILITY-III Part 4.
//
// Targets the most operator-sensitive invariants in the platform:
//
//   • Double-refund prevention. The schema's
//     `Payment.refundOfPaymentId` is `@unique`, so two refunds
//     against the same source MUST collide on P2002.
//   • Receipt immutability. Archiving / restoring a student must
//     NOT cascade-delete their payment history.
//   • Status flip determinism. Two operators flipping payment
//     status to REFUNDED at the same time must end with one of
//     {REFUNDED, ACTIVE} — never a wedged half-state.
//
// We exercise Prisma directly. The full Nest FeesModule is unit-
// covered separately; here we prove the database-level guarantees.
// ============================================================================

describeWithDb('financial concurrency (real DB)', () => {
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

  // -------------------------------------------------------------------------
  // 1. Two refunds against the same source payment — only one wins.
  //    The unique constraint on `refundOfPaymentId` is the enforcement.
  // -------------------------------------------------------------------------

  it('rejects parallel refunds against the same source payment', async () => {
    const school = await seedSchool(client);
    const klass = await seedClass(client, school.id);
    const student = await seedStudent(client, {
      schoolId: school.id,
      classId: klass.id,
    });
    const source = await client.payment.create({
      data: {
        amount: 1000,
        date: new Date('2026-08-01'),
        studentId: student.id,
        schoolId: school.id,
        receiptNumber: 'RCPT-2026-0001',
        status: PaymentStatus.ACTIVE,
      },
    });

    // Two operators kick off refund on the same receipt at the same
    // moment. Both try to create a refund row with the same
    // `refundOfPaymentId`. The @unique index permits exactly one.
    const tryRefund = (suffix: string) =>
      client.payment.create({
        data: {
          amount: -1000,
          date: new Date('2026-08-02'),
          studentId: student.id,
          schoolId: school.id,
          receiptNumber: `RCPT-2026-0001R-${suffix}`,
          status: PaymentStatus.ACTIVE,
          refundOfPaymentId: source.id,
          refundReason: 'Test refund',
        },
      });

    const results = await Promise.allSettled([tryRefund('a'), tryRefund('b')]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection.code).toBe('P2002');

    // Final state — exactly one refund row.
    const refunds = await client.payment.findMany({
      where: { refundOfPaymentId: source.id },
    });
    expect(refunds).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 2. Archiving a student must NOT cascade-delete payment history.
  //    The FK is `onDelete: Cascade` on the relation field, but archive
  //    is a soft-delete (sets archivedAt) — it does NOT remove the row,
  //    so the cascade never fires. Test that explicitly.
  // -------------------------------------------------------------------------

  it('archiving a student preserves their payment receipts', async () => {
    const school = await seedSchool(client);
    const klass = await seedClass(client, school.id);
    const student = await seedStudent(client, {
      schoolId: school.id,
      classId: klass.id,
    });
    const payment = await client.payment.create({
      data: {
        amount: 500,
        date: new Date('2026-09-01'),
        studentId: student.id,
        schoolId: school.id,
        receiptNumber: 'RCPT-2026-0010',
        status: PaymentStatus.ACTIVE,
      },
    });

    // Archive the student.
    await client.student.update({
      where: { id: student.id },
      data: {
        archivedAt: new Date(),
        archiveReason: 'Transferred',
      },
    });

    // Payment row survives.
    const stillThere = await client.payment.findUnique({
      where: { id: payment.id },
    });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.amount).toBe(500);
    expect(stillThere!.status).toBe(PaymentStatus.ACTIVE);
  });

  // -------------------------------------------------------------------------
  // 3. Restoring the same student — payment history still attached
  //    and queryable.
  // -------------------------------------------------------------------------

  it('restoring a previously-archived student returns the payment history intact', async () => {
    const school = await seedSchool(client);
    const klass = await seedClass(client, school.id);
    const student = await seedStudent(client, {
      schoolId: school.id,
      classId: klass.id,
    });
    await client.payment.create({
      data: {
        amount: 200,
        date: new Date('2026-09-15'),
        studentId: student.id,
        schoolId: school.id,
        receiptNumber: 'RCPT-2026-0050',
        status: PaymentStatus.ACTIVE,
      },
    });

    // Archive then restore.
    await client.student.update({
      where: { id: student.id },
      data: { archivedAt: new Date(), archiveReason: 'Left school' },
    });
    await client.student.update({
      where: { id: student.id },
      data: { archivedAt: null, archiveReason: null },
    });

    const payments = await client.payment.findMany({
      where: { studentId: student.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 4. Status flip determinism: two parallel UPDATE … SET status=REFUNDED
  //    on the same row commit deterministically. There's no partial
  //    state because each statement is atomic in Postgres.
  // -------------------------------------------------------------------------

  it('parallel status flips end on a well-defined value, never partial', async () => {
    const school = await seedSchool(client);
    const klass = await seedClass(client, school.id);
    const student = await seedStudent(client, {
      schoolId: school.id,
      classId: klass.id,
    });
    const payment = await client.payment.create({
      data: {
        amount: 100,
        date: new Date(),
        studentId: student.id,
        schoolId: school.id,
        receiptNumber: 'RCPT-FLIP-001',
        status: PaymentStatus.ACTIVE,
      },
    });

    const flips = await Promise.allSettled([
      client.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.REFUNDED },
      }),
      client.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.VOID },
      }),
    ]);

    expect(flips.every((f) => f.status === 'fulfilled')).toBe(true);

    const final = await client.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect([PaymentStatus.REFUNDED, PaymentStatus.VOID]).toContain(
      final.status,
    );
  });
});

import { PrismaClient, StudentSessionStatus } from '@prisma/client';
import {
  describeWithDb,
  startIntegrationDb,
  stopIntegrationDb,
  truncateAll,
} from './harness';
import {
  seedAcademicSession,
  seedAdmin,
  seedClass,
  seedSchool,
  seedStudent,
} from './fixtures';

// ============================================================================
// Promotion concurrency — Phase RELIABILITY-III Part 2.
//
// Targets the data-layer invariants that protect a school against
// two operators kicking off promotion at the same time, or a
// promotion preview racing against a live run.
//
// The integration test exercises Prisma directly. We replicate the
// shape of `PromotionService.run` inline rather than booting the
// full Nest module, because:
//   • the race we care about is on the database, not the DI graph
//   • bootstrapping the full module against a Docker Postgres
//     adds 5-10s without buying invariant coverage
// ============================================================================

describeWithDb('promotion concurrency (real DB)', () => {
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
  // 1. Two simultaneous promotion runs against the SAME student
  //    must NOT produce two StudentAcademicRecord rows. The
  //    `@@unique([studentId, sessionId])` index is the enforcement.
  // -------------------------------------------------------------------------

  it('parallel promotion runs against the same student yield exactly one snapshot', async () => {
    const school = await seedSchool(client);
    const admin = await seedAdmin(client, school.id);
    const currentSession = await seedAcademicSession(client, school.id, {
      name: 'Year 2026',
      isActive: true,
    });
    const currentClass = await seedClass(client, school.id, { name: 'Grade 5' });
    const nextClass = await seedClass(client, school.id, { name: 'Grade 6' });
    const student = await seedStudent(client, {
      schoolId: school.id,
      classId: currentClass.id,
    });

    // Two operator clicks of "Run promotion" arrive almost
    // simultaneously. Both try to snapshot the same (student, session)
    // pair. Exactly one must succeed; the second must fail with
    // P2002 on the unique index.
    const runPromotion = (attempt: number) =>
      client.studentAcademicRecord.create({
        data: {
          studentId: student.id,
          sessionId: currentSession.id,
          classId: currentClass.id,
          sectionId: null,
          schoolId: school.id,
          status: StudentSessionStatus.PROMOTED,
          nextClassId: nextClass.id,
          nextSectionId: null,
          promotedById: admin.id,
        },
      });

    const results = await Promise.allSettled([runPromotion(1), runPromotion(2)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // P2002 surfaces from the unique-index collision.
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection.code).toBe('P2002');

    // Final state: exactly one StudentAcademicRecord row.
    const snapshots = await client.studentAcademicRecord.findMany({
      where: { studentId: student.id },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].sessionId).toBe(currentSession.id);
    expect(snapshots[0].status).toBe(StudentSessionStatus.PROMOTED);
  });

  // -------------------------------------------------------------------------
  // 2. Promotion preview is purely read-only — running it during a
  //    live promotion run must NOT produce StudentAcademicRecord
  //    side-effects. We assert by counting the snapshot rows before
  //    and after a "preview" simulation.
  // -------------------------------------------------------------------------

  it('preview-shaped read does not write any rows', async () => {
    const school = await seedSchool(client);
    const session = await seedAcademicSession(client, school.id);
    const klass = await seedClass(client, school.id);
    const students = [];
    for (let i = 0; i < 3; i++) {
      students.push(
        await seedStudent(client, { schoolId: school.id, classId: klass.id }),
      );
    }

    const beforeCount = await client.studentAcademicRecord.count({
      where: { schoolId: school.id },
    });

    // Simulate a preview: fetch the students who WOULD be promoted,
    // map them to candidate snapshot rows in memory, but never write.
    const candidates = await client.student.findMany({
      where: { schoolId: school.id, classId: klass.id, archivedAt: null },
    });
    const previewPayload = candidates.map((s) => ({
      studentId: s.id,
      currentClassId: s.classId,
      sessionId: session.id,
      status: StudentSessionStatus.PROMOTED as StudentSessionStatus,
    }));

    expect(previewPayload).toHaveLength(3);

    const afterCount = await client.studentAcademicRecord.count({
      where: { schoolId: school.id },
    });
    expect(afterCount).toBe(beforeCount);
  });

  // -------------------------------------------------------------------------
  // 3. Archived students must be excluded from a default-list
  //    preview. The service-layer filter `archivedAt: null` is what
  //    enforces this; we re-prove it against real rows.
  // -------------------------------------------------------------------------

  it('archived students are excluded from default promotion candidate list', async () => {
    const school = await seedSchool(client);
    const klass = await seedClass(client, school.id);
    const active = await seedStudent(client, {
      schoolId: school.id,
      classId: klass.id,
    });
    const archived = await seedStudent(client, {
      schoolId: school.id,
      classId: klass.id,
    });
    await client.student.update({
      where: { id: archived.id },
      data: {
        archivedAt: new Date(),
        archiveReason: 'Left school',
      },
    });

    const candidates = await client.student.findMany({
      where: {
        schoolId: school.id,
        classId: klass.id,
        archivedAt: null,
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe(active.id);
  });

  // -------------------------------------------------------------------------
  // 4. Session transition race: trying to write a StudentAcademicRecord
  //    against a session that no longer exists (deleted mid-run)
  //    must fail with a FK error — not silently corrupt history.
  // -------------------------------------------------------------------------

  it('promoting into a deleted session surfaces an FK error', async () => {
    const school = await seedSchool(client);
    const session = await seedAcademicSession(client, school.id);
    const klass = await seedClass(client, school.id);
    const student = await seedStudent(client, {
      schoolId: school.id,
      classId: klass.id,
    });

    // Delete the session mid-flow. Subsequent promotion attempt must
    // surface a clean FK violation, not write an orphaned snapshot.
    await client.academicSession.delete({ where: { id: session.id } });

    await expect(
      client.studentAcademicRecord.create({
        data: {
          studentId: student.id,
          sessionId: session.id,
          classId: klass.id,
          schoolId: school.id,
          status: StudentSessionStatus.PROMOTED,
        },
      }),
    ).rejects.toThrow();

    const orphans = await client.studentAcademicRecord.count({
      where: { schoolId: school.id },
    });
    expect(orphans).toBe(0);
  });
});

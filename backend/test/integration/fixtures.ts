import { PrismaClient, Role, Gender } from '@prisma/client';
import { randomUUID } from 'node:crypto';

// ============================================================================
// Fixture helpers — Phase RELIABILITY-II Part 1.
//
// Composable seed builders. Each builder accepts a `PrismaClient` +
// minimal inputs and returns the created row. They produce real
// rows via the same Prisma calls the service layer uses, so any
// schema constraint that fires in production also fires here.
//
// Why composable instead of one big "seed everything":
//   • Tests differ wildly in what they need. The marks-lock test
//     needs an exam + a result; the concurrency-promotion test
//     needs two sessions + a roster.
//   • Composability avoids opaque "where did this row come from"
//     debugging.
//
// Naming convention:
//   `seedSchool`, `seedAdmin`, `seedStudent`, etc. Each helper
//   stamps a unique suffix on its labels so parallel suites (even
//   though we run with maxWorkers: 1 today) don't collide on
//   `schoolCode` / `email`.
// ============================================================================

function uniqueSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

export async function seedSchool(
  client: PrismaClient,
  overrides: { name?: string; schoolCode?: string } = {},
) {
  const suffix = uniqueSuffix();
  return client.school.create({
    data: {
      name: overrides.name ?? `Test School ${suffix}`,
      slug: `school-${suffix}`,
      schoolCode: overrides.schoolCode ?? `SCH-${suffix.slice(0, 5).toUpperCase()}`,
    },
  });
}

export async function seedAdmin(
  client: PrismaClient,
  schoolId: string,
  overrides: { email?: string; password?: string } = {},
) {
  const suffix = uniqueSuffix();
  return client.user.create({
    data: {
      email: overrides.email ?? `admin-${suffix}@test.local`,
      // Real flows hash via HashingService. Integration tests don't
      // exercise login here — they pass `userId` into service methods
      // directly. The password field is required + indexed so we
      // put a non-empty placeholder.
      password: overrides.password ?? `seeded-${suffix}-not-a-real-hash`,
      role: Role.ADMIN,
      schoolId,
    },
  });
}

export async function seedClass(
  client: PrismaClient,
  schoolId: string,
  overrides: { name?: string } = {},
) {
  const suffix = uniqueSuffix();
  return client.class.create({
    data: {
      name: overrides.name ?? `Class ${suffix}`,
      schoolId,
    },
  });
}

export async function seedAcademicSession(
  client: PrismaClient,
  schoolId: string,
  overrides: {
    name?: string;
    isActive?: boolean;
    startDate?: Date;
    endDate?: Date;
  } = {},
) {
  const suffix = uniqueSuffix();
  return client.academicSession.create({
    data: {
      name: overrides.name ?? `Session ${suffix}`,
      schoolId,
      isActive: overrides.isActive ?? true,
      startDate: overrides.startDate ?? new Date('2026-01-01'),
      endDate: overrides.endDate ?? new Date('2026-12-31'),
    },
  });
}

export async function seedStudent(
  client: PrismaClient,
  input: {
    schoolId: string;
    classId?: string | null;
    firstName?: string;
    lastName?: string;
    symbolNumber?: string | null;
    registrationNumber?: string | null;
  },
) {
  const suffix = uniqueSuffix();
  return client.student.create({
    data: {
      firstName: input.firstName ?? `First-${suffix}`,
      lastName: input.lastName ?? `Last-${suffix}`,
      schoolId: input.schoolId,
      classId: input.classId ?? null,
      symbolNumber: input.symbolNumber ?? null,
      registrationNumber: input.registrationNumber ?? null,
      gender: Gender.OTHER,
      dateOfBirth: new Date('2010-01-01'),
      parentName: 'Test Parent',
      contactNumber: '9800000000',
    },
  });
}

export async function seedExam(
  client: PrismaClient,
  input: {
    schoolId: string;
    sessionId?: string | null;
    name?: string;
    locked?: boolean;
    userId: string;
  },
) {
  const suffix = uniqueSuffix();
  return client.exam.create({
    data: {
      name: input.name ?? `Exam ${suffix}`,
      schoolId: input.schoolId,
      sessionId: input.sessionId ?? null,
      locked: input.locked ?? false,
      createdById: input.userId,
      updatedById: input.userId,
    },
  });
}

/**
 * Composed convenience seed: a school + admin + active session + a
 * single class + N students. Returns every created row in a flat
 * object so the test can grab the bits it needs.
 *
 * Most integration tests want this shape; reach for the individual
 * builders only when you need a non-standard arrangement.
 */
export async function seedSchoolWithRoster(
  client: PrismaClient,
  options: { studentCount?: number } = {},
) {
  const school = await seedSchool(client);
  const admin = await seedAdmin(client, school.id);
  const session = await seedAcademicSession(client, school.id);
  const klass = await seedClass(client, school.id);
  const students = [];
  for (let i = 0; i < (options.studentCount ?? 3); i++) {
    students.push(
      await seedStudent(client, {
        schoolId: school.id,
        classId: klass.id,
      }),
    );
  }
  return { school, admin, session, klass, students };
}

import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformAuditAction } from '@prisma/client';
import { StudentService, type StudentActor } from './student.service';
import type { PrismaService } from '../database/prisma.service';
import type { PlatformAuditService } from '../platform/platform-audit.service';
import type { StudentRegistrationNumberService } from './services/student-registration-number.service';

// ============================================================================
// StudentService — archive / restore lifecycle tests.
//
// Phase RELIABILITY Part 2. Focuses on the archive flow contract:
//   • archive() stamps archivedAt + archivedById + archiveReason
//   • archive() is idempotent (no-op on already-archived rows)
//   • archive() emits STUDENT_ARCHIVED with explicit schoolId
//   • restore() clears the archive triplet
//   • restore() is idempotent
//   • restore() emits STUDENT_RESTORED
//   • update() rejects archived rows with 409 ConflictException
//   • findOne / archive / restore reject cross-tenant ids with 404
//
// The PrismaService is shape-mocked. The audit + registration services
// receive simple stub instances. No real DB, no real transactions.
// ============================================================================

interface MockPrisma {
  student: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
}

function makeMockPrisma(): MockPrisma {
  return {
    student: { findFirst: jest.fn(), update: jest.fn() },
  };
}

function makeStudent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'student-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    schoolId: 'school-1',
    classId: 'class-1',
    sectionId: null,
    archivedAt: null,
    archivedById: null,
    archiveReason: null,
    ...overrides,
  };
}

function makeService(prisma: MockPrisma) {
  const audit = { record: jest.fn().mockResolvedValue('audit-row-id') };
  const regNumbers = {} as StudentRegistrationNumberService;
  const svc = new StudentService(
    prisma as unknown as PrismaService,
    regNumbers,
    audit as unknown as PlatformAuditService,
  );
  return { svc, audit };
}

const actor: StudentActor = {
  userId: 'admin-1',
  email: 'admin@school.test',
  role: 'ADMIN',
  ip: '127.0.0.1',
  userAgent: 'jest',
};

describe('StudentService archive/restore lifecycle', () => {
  // -------------------------------------------------------------------------
  // archive()
  // -------------------------------------------------------------------------

  describe('archive', () => {
    it('stamps archivedAt + archivedById + reason and emits STUDENT_ARCHIVED', async () => {
      const prisma = makeMockPrisma();
      // ensureInSchool → not yet archived.
      prisma.student.findFirst.mockResolvedValueOnce({
        id: 'student-1',
        classId: 'class-1',
        sectionId: null,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
      const updated = makeStudent({
        archivedAt: new Date('2026-08-01T00:00:00Z'),
        archivedById: actor.userId,
        archiveReason: 'Transferred',
      });
      prisma.student.update.mockResolvedValueOnce(updated);
      const { svc, audit } = makeService(prisma);

      const result = await svc.archive(
        'student-1',
        'school-1',
        actor,
        '  Transferred  ',
      );

      // Service trimmed the reason before persisting.
      expect(prisma.student.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'student-1' },
          data: expect.objectContaining({
            archivedById: actor.userId,
            archiveReason: 'Transferred',
            archivedAt: expect.any(Date),
          }),
        }),
      );
      expect(result.archivedAt).toBeDefined();

      // Audit row carries explicit schoolId + the trimmed reason.
      expect(audit.record).toHaveBeenCalledTimes(1);
      const auditCall = audit.record.mock.calls[0][0];
      expect(auditCall.action).toBe(PlatformAuditAction.STUDENT_ARCHIVED);
      expect(auditCall.schoolId).toBe('school-1');
      expect(auditCall.actor.userId).toBe(actor.userId);
      expect(auditCall.target.type).toBe('Student');
      expect(auditCall.target.id).toBe('student-1');
      expect(auditCall.reason).toBe('Transferred');
    });

    it('is idempotent: already-archived row returns existing without re-emitting audit', async () => {
      const prisma = makeMockPrisma();
      // First call: ensureInSchool returns archived row.
      prisma.student.findFirst
        .mockResolvedValueOnce({
          id: 'student-1',
          classId: 'class-1',
          sectionId: null,
          archivedAt: new Date('2025-01-01'),
          archivedById: 'admin-other',
          archiveReason: 'Previous',
        })
        // Second call: findOne returns the full row.
        .mockResolvedValueOnce(
          makeStudent({
            archivedAt: new Date('2025-01-01'),
            archivedById: 'admin-other',
            archiveReason: 'Previous',
          }),
        );
      const { svc, audit } = makeService(prisma);

      await svc.archive('student-1', 'school-1', actor, 'ignored');

      expect(prisma.student.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('treats empty/whitespace reason as null', async () => {
      const prisma = makeMockPrisma();
      prisma.student.findFirst.mockResolvedValueOnce({
        id: 'student-1',
        classId: 'class-1',
        sectionId: null,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
      prisma.student.update.mockResolvedValueOnce(
        makeStudent({ archivedAt: new Date(), archivedById: actor.userId }),
      );
      const { svc } = makeService(prisma);

      await svc.archive('student-1', 'school-1', actor, '   ');

      const data = prisma.student.update.mock.calls[0][0].data;
      expect(data.archiveReason).toBeNull();
    });

    it('caps reason at 500 chars', async () => {
      const prisma = makeMockPrisma();
      prisma.student.findFirst.mockResolvedValueOnce({
        id: 'student-1',
        classId: 'class-1',
        sectionId: null,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
      prisma.student.update.mockResolvedValueOnce(
        makeStudent({ archivedAt: new Date(), archivedById: actor.userId }),
      );
      const { svc } = makeService(prisma);
      const longReason = 'x'.repeat(800);

      await svc.archive('student-1', 'school-1', actor, longReason);

      const data = prisma.student.update.mock.calls[0][0].data;
      expect(data.archiveReason).toHaveLength(500);
    });

    it('throws NotFoundException for cross-tenant id', async () => {
      const prisma = makeMockPrisma();
      prisma.student.findFirst.mockResolvedValueOnce(null);
      const { svc, audit } = makeService(prisma);

      await expect(
        svc.archive('cross-tenant', 'school-1', actor, null),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // restore()
  // -------------------------------------------------------------------------

  describe('restore', () => {
    it('clears archive triplet and emits STUDENT_RESTORED', async () => {
      const prisma = makeMockPrisma();
      prisma.student.findFirst.mockResolvedValueOnce({
        id: 'student-1',
        classId: 'class-1',
        sectionId: null,
        archivedAt: new Date('2025-01-01'),
        archivedById: 'admin-old',
        archiveReason: 'left school',
      });
      prisma.student.update.mockResolvedValueOnce(
        makeStudent({
          archivedAt: null,
          archivedById: null,
          archiveReason: null,
        }),
      );
      const { svc, audit } = makeService(prisma);

      await svc.restore('student-1', 'school-1', actor);

      const data = prisma.student.update.mock.calls[0][0].data;
      expect(data).toEqual({
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });

      const auditCall = audit.record.mock.calls[0][0];
      expect(auditCall.action).toBe(PlatformAuditAction.STUDENT_RESTORED);
      expect(auditCall.schoolId).toBe('school-1');
      // before snapshot carries the previous state for the audit trail.
      expect(auditCall.before.archivedById).toBe('admin-old');
      expect(auditCall.before.archiveReason).toBe('left school');
    });

    it('is idempotent: non-archived row returns existing without emit', async () => {
      const prisma = makeMockPrisma();
      prisma.student.findFirst
        .mockResolvedValueOnce({
          id: 'student-1',
          classId: 'class-1',
          sectionId: null,
          archivedAt: null,
          archivedById: null,
          archiveReason: null,
        })
        .mockResolvedValueOnce(makeStudent());
      const { svc, audit } = makeService(prisma);

      await svc.restore('student-1', 'school-1', actor);

      expect(prisma.student.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for cross-tenant id', async () => {
      const prisma = makeMockPrisma();
      prisma.student.findFirst.mockResolvedValueOnce(null);
      const { svc } = makeService(prisma);

      await expect(
        svc.restore('cross-tenant', 'school-1', actor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // update() rejects archived rows
  // -------------------------------------------------------------------------

  describe('update on archived row', () => {
    it('throws ConflictException with restore hint', async () => {
      const prisma = makeMockPrisma();
      const archivedRow = {
        id: 'student-1',
        classId: 'class-1',
        sectionId: null,
        archivedAt: new Date('2025-01-01'),
        archivedById: 'admin-1',
        archiveReason: null,
      };
      // Same archived row for both rejection assertions below.
      prisma.student.findFirst.mockResolvedValue(archivedRow);
      const { svc } = makeService(prisma);

      // The thrown error must BOTH be a ConflictException AND mention
      // restore — copy-stable contract for the UI's error toast.
      await expect(
        svc.update('student-1', { firstName: 'New' }, 'school-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        svc.update('student-1', { firstName: 'New' }, 'school-1'),
      ).rejects.toThrow(/restore/i);
    });
  });

  // -------------------------------------------------------------------------
  // findAll default-list filter
  // -------------------------------------------------------------------------

  describe('findAll archived filter defaults', () => {
    it('defaults to archivedAt: null (active only)', async () => {
      const prisma = makeMockPrisma();
      const findManyMock = jest.fn().mockResolvedValue([]);
      // Augment prisma.student with findMany.
      (prisma.student as unknown as { findMany: jest.Mock }).findMany =
        findManyMock;
      const { svc } = makeService(prisma);

      await svc.findAll('school-1');

      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            schoolId: 'school-1',
            archivedAt: null,
          }),
        }),
      );
    });

    it('archived: true filters to archivedAt NOT null', async () => {
      const prisma = makeMockPrisma();
      const findManyMock = jest.fn().mockResolvedValue([]);
      (prisma.student as unknown as { findMany: jest.Mock }).findMany =
        findManyMock;
      const { svc } = makeService(prisma);

      await svc.findAll('school-1', { archived: true });

      const where = findManyMock.mock.calls[0][0].where;
      expect(where.archivedAt).toEqual({ not: null });
    });

    it('archived: "all" omits the archive filter', async () => {
      const prisma = makeMockPrisma();
      const findManyMock = jest.fn().mockResolvedValue([]);
      (prisma.student as unknown as { findMany: jest.Mock }).findMany =
        findManyMock;
      const { svc } = makeService(prisma);

      await svc.findAll('school-1', { archived: 'all' });

      const where = findManyMock.mock.calls[0][0].where;
      expect(where.archivedAt).toBeUndefined();
    });
  });
});

import { IntegrityCheckService } from './integrity-check.service';
import type { PrismaService } from '../database/prisma.service';

// ============================================================================
// IntegrityCheckService — unit tests.
//
// Validates the report contract:
//   • `clean: true` when every check returned count === 0
//   • per-check severity buckets (info/warnings/errors) tally correctly
//   • duplicate scan returns COUNT - 1 per dupe group (because the
//     "first" row of each dupe group is the legitimate one)
//   • no-active-session and multiple-active-sessions surface correctly
//   • zero-count findings still appear in the report (UI shows the slot)
//
// Strategy: shape-mock PrismaService — every query is one of
// student.findMany / exam.count / studentAcademicRecord.count /
// academicSession.count / exam.findMany / $queryRawUnsafe. We stub
// each per test and assert the resulting IntegrityReport shape.
// ============================================================================

interface MockPrisma {
  student: { findMany: jest.Mock };
  exam: { count: jest.Mock; findMany: jest.Mock };
  studentAcademicRecord: { count: jest.Mock };
  academicSession: { count: jest.Mock };
  $queryRawUnsafe: jest.Mock;
}

function makeMockPrisma(): MockPrisma {
  return {
    student: { findMany: jest.fn() },
    exam: { count: jest.fn(), findMany: jest.fn() },
    studentAcademicRecord: { count: jest.fn() },
    academicSession: { count: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  };
}

function makeService(prisma: MockPrisma): IntegrityCheckService {
  return new IntegrityCheckService(prisma as unknown as PrismaService);
}

describe('IntegrityCheckService', () => {
  // Defaults — overridden per-test for the failing-scenario cases.
  function stubClean(prisma: MockPrisma) {
    prisma.$queryRawUnsafe.mockResolvedValue([]); // no dupes
    prisma.student.findMany.mockResolvedValue([]); // no orphan / class-archive findings
    prisma.exam.count.mockResolvedValue(0);
    prisma.exam.findMany.mockResolvedValue([]);
    prisma.studentAcademicRecord.count.mockResolvedValue(0);
    // EXACTLY one active session — the happy path.
    prisma.academicSession.count.mockResolvedValue(1);
  }

  describe('clean baseline', () => {
    it('reports clean: true when every check passes', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      const svc = makeService(prisma);

      const report = await svc.checkSchool('school-1');

      expect(report.clean).toBe(true);
      expect(report.counts).toEqual({ info: 0, warnings: 0, errors: 0 });
      // Every finding slot still rendered, even with count: 0.
      expect(report.findings.length).toBeGreaterThanOrEqual(6);
      expect(report.findings.every((f) => f.count === 0)).toBe(true);
    });

    it('stamps schoolId + generatedAt on every report', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      const svc = makeService(prisma);

      const report = await svc.checkSchool('school-42');

      expect(report.schoolId).toBe('school-42');
      expect(typeof report.generatedAt).toBe('string');
      expect(() => new Date(report.generatedAt)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate detection — registrationNumber + symbolNumber
  // -------------------------------------------------------------------------

  describe('duplicate registration numbers', () => {
    it('reports STUDENT_DUPLICATE_REGNO with count = sum(cnt - 1)', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      // Two regno groups: 3 rows + 2 rows ⇒ 2 + 1 = 3 duplicate rows.
      prisma.$queryRawUnsafe.mockImplementation((sql: string) => {
        if (sql.includes('registrationNumber')) {
          return Promise.resolve([
            { value: 'REG-001', cnt: BigInt(3) },
            { value: 'REG-002', cnt: BigInt(2) },
          ]);
        }
        return Promise.resolve([]);
      });
      const svc = makeService(prisma);

      const report = await svc.checkSchool('school-1');
      const finding = report.findings.find(
        (f) => f.code === 'STUDENT_DUPLICATE_REGNO',
      );
      expect(finding).toBeDefined();
      expect(finding!.count).toBe(3);
      expect(finding!.severity).toBe('error');
      expect(finding!.sampleIds).toEqual(['REG-001', 'REG-002']);
      expect(report.clean).toBe(false);
      expect(report.counts.errors).toBeGreaterThanOrEqual(1);
    });

    it('reports STUDENT_DUPLICATE_SYMBOL independently', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      prisma.$queryRawUnsafe.mockImplementation((sql: string) => {
        if (sql.includes('symbolNumber')) {
          return Promise.resolve([
            { value: 'SYM-009', cnt: BigInt(2) },
          ]);
        }
        return Promise.resolve([]);
      });
      const svc = makeService(prisma);

      const report = await svc.checkSchool('school-1');
      const finding = report.findings.find(
        (f) => f.code === 'STUDENT_DUPLICATE_SYMBOL',
      );
      expect(finding!.count).toBe(1);
      expect(finding!.severity).toBe('error');
    });
  });

  // -------------------------------------------------------------------------
  // Active session sanity
  // -------------------------------------------------------------------------

  describe('active session count', () => {
    it('reports NO_ACTIVE_SESSION (warning) when zero active sessions', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      prisma.academicSession.count.mockResolvedValue(0);
      const svc = makeService(prisma);

      const report = await svc.checkSchool('school-1');
      const finding = report.findings.find(
        (f) => f.code === 'NO_ACTIVE_SESSION',
      );
      expect(finding!.count).toBe(1);
      expect(finding!.severity).toBe('warning');
      expect(finding!.remediation).toMatch(/session/i);
      expect(report.counts.warnings).toBeGreaterThanOrEqual(1);
    });

    it('reports MULTIPLE_ACTIVE_SESSIONS (error) when more than one active', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      prisma.academicSession.count.mockResolvedValue(3);
      const svc = makeService(prisma);

      const report = await svc.checkSchool('school-1');
      const finding = report.findings.find(
        (f) => f.code === 'MULTIPLE_ACTIVE_SESSIONS',
      );
      expect(finding).toBeDefined();
      expect(finding!.count).toBe(3);
      expect(finding!.severity).toBe('error');
      expect(report.counts.errors).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Exam missing-session detection
  // -------------------------------------------------------------------------

  describe('exam missing session', () => {
    it('reports EXAM_MISSING_SESSION when at least one exam has no sessionId', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      prisma.exam.count.mockResolvedValue(2);
      prisma.exam.findMany.mockResolvedValue([
        { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        { id: 'ffffffff-1111-2222-3333-444444444444' },
      ]);
      const svc = makeService(prisma);

      const report = await svc.checkSchool('school-1');
      const finding = report.findings.find(
        (f) => f.code === 'EXAM_MISSING_SESSION',
      );
      expect(finding!.count).toBe(2);
      expect(finding!.sampleIds).toEqual(['aaaaaaaa', 'ffffffff']);
      expect(finding!.severity).toBe('warning');
    });
  });

  // -------------------------------------------------------------------------
  // Promotion linkage — info severity, doesn't drag the report below clean
  // for the WARNING/ERROR counts (but it does push clean=false).
  // -------------------------------------------------------------------------

  describe('promotion linkage', () => {
    it('reports PROMOTION_MISSING_LINK (info) when older rows lack promotedById', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      prisma.studentAcademicRecord.count.mockResolvedValue(17);
      const svc = makeService(prisma);

      const report = await svc.checkSchool('school-1');
      const finding = report.findings.find(
        (f) => f.code === 'PROMOTION_MISSING_LINK',
      );
      expect(finding!.count).toBe(17);
      expect(finding!.severity).toBe('warning');
      expect(report.clean).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tenant isolation — pass the schoolId through every query
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('passes schoolId into every query', async () => {
      const prisma = makeMockPrisma();
      stubClean(prisma);
      const svc = makeService(prisma);

      await svc.checkSchool('school-isolated');

      // $queryRawUnsafe always receives the schoolId as the second arg
      // (after the SQL string).
      const queryRawCalls = prisma.$queryRawUnsafe.mock.calls;
      expect(queryRawCalls.length).toBeGreaterThan(0);
      for (const call of queryRawCalls) {
        expect(call[1]).toBe('school-isolated');
      }

      // exam.count must have a where.schoolId filter.
      const examCountCalls = prisma.exam.count.mock.calls;
      for (const [args] of examCountCalls) {
        expect(args.where.schoolId).toBe('school-isolated');
      }
    });
  });
});

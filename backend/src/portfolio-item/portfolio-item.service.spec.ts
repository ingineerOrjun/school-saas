import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioItemType, Role, SubjectCode } from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { TeacherScopeService } from '../common/auth/teacher-scope.service';
import { PrismaService } from '../database/prisma.service';
import type { CreatePortfolioItemDto } from './dto/create-portfolio-item.dto';
import {
  PORTFOLIO_ITEM_FAILURE,
  PortfolioItemService,
  resolveCreatedByName,
} from './portfolio-item.service';

// ============================================================================
// PortfolioItemService spec — Session 4.
//
// Mirrors continuous-record.service.spec.ts in setup style:
//   • PrismaService is a hand-rolled mock with per-test discriminators.
//   • AcademicSessionService + TeacherScopeService are jest mocks.
//   • $transaction calls its callback with the same mock object and
//     tracks commit / rollback so "transaction did not commit" can be
//     asserted without standing up Postgres.
//
// Covers the ten scenarios listed in the Session 4 spec:
//   1. Locked session blocks create.
//   2. Teacher scope rejection on create.
//   3. outcomeId null → any-subject teacher succeeds.
//   4. outcomeId set → wrong-subject teacher rejected.
//   5. PATCH happy path (extra-fields rejection is exercised by the
//      service-layer defense-in-depth assertion).
//   6. CREATE writes one history row with previousDescription = null.
//   7. PATCH writes one history row with the OLD description.
//   8. occurredOn boundaries (future rejected; before-start rejected;
//      today + session.startDate both accepted).
//   9. Tenant isolation on PATCH (other-school item → 404).
//  10. GET ordering — passes the orderBy assertion to Prisma's mock.
// ============================================================================

interface PrismaMock {
  portfolioItem: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  portfolioItemHistory: {
    create: jest.Mock;
  };
  learningOutcome: { findUnique: jest.Mock };
  student: { findFirst: jest.Mock };
  academicSession: { findFirst: jest.Mock };
  $transaction: jest.Mock;
  __lastTxCommitted: boolean;
  __txOpens: number;
}

function makePrismaMock(): PrismaMock {
  const m: PrismaMock = {
    portfolioItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    portfolioItemHistory: { create: jest.fn() },
    learningOutcome: { findUnique: jest.fn() },
    student: { findFirst: jest.fn() },
    academicSession: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    __lastTxCommitted: false,
    __txOpens: 0,
  };
  m.$transaction = jest.fn(async (fn: (tx: PrismaMock) => Promise<unknown>) => {
    m.__txOpens += 1;
    m.__lastTxCommitted = false;
    const r = await fn(m);
    m.__lastTxCommitted = true;
    return r;
  });
  return m;
}

const TENANT = '00000000-0000-0000-0000-000000000099';
const TEACHER: AuthenticatedUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'teacher@example.test',
  role: Role.TEACHER,
  schoolId: TENANT,
} as AuthenticatedUser;

const STUDENT_ID = '00000000-0000-0000-0000-0000000000aa';
const SESSION_ID = '00000000-0000-0000-0000-0000000000bb';
const SESSION_ROW = {
  id: SESSION_ID,
  // Session started March 1 2026 — a date the tests can pivot around.
  startDate: new Date('2026-03-01T00:00:00.000Z'),
};

const OUTCOME_ID_CUID = 'ck00000000english4unit1';
const OUTCOME_ROW = {
  id: OUTCOME_ID_CUID,
  subjectCode: SubjectCode.ENGLISH,
};

function makeCreateDto(
  overrides: Partial<CreatePortfolioItemDto> = {},
): CreatePortfolioItemDto {
  return {
    studentId: STUDENT_ID,
    sessionId: SESSION_ID,
    type: PortfolioItemType.PROJECT,
    description: 'Built a paper-craft solar system',
    occurredOn: '2026-05-01',
    ...overrides,
  };
}

describe('PortfolioItemService', () => {
  let service: PortfolioItemService;
  let prisma: PrismaMock;
  let sessions: { assertSessionUnlocked: jest.Mock };
  let scope: { assertPortfolioItemAccess: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    sessions = { assertSessionUnlocked: jest.fn() };
    scope = { assertPortfolioItemAccess: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioItemService,
        { provide: PrismaService, useValue: prisma },
        { provide: AcademicSessionService, useValue: sessions },
        { provide: TeacherScopeService, useValue: scope },
      ],
    }).compile();

    service = module.get(PortfolioItemService);

    // Freeze "today" so occurredOn-boundary tests are deterministic.
    jest.useFakeTimers().setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Helpers: prime the common happy-path mocks for create()
  // ---------------------------------------------------------------------------
  function primeCreateHappyPath() {
    sessions.assertSessionUnlocked.mockResolvedValue(undefined);
    prisma.student.findFirst.mockResolvedValue({
      id: STUDENT_ID,
      schoolId: TENANT,
    });
    prisma.academicSession.findFirst.mockResolvedValue(SESSION_ROW);
    scope.assertPortfolioItemAccess.mockResolvedValue(undefined);
    prisma.portfolioItem.create.mockImplementation(({ data }: any) =>
      Promise.resolve({
        id: 'item-1',
        ...data,
      }),
    );
    prisma.portfolioItemHistory.create.mockResolvedValue({});
  }

  // ---------------------------------------------------------------------------
  // TEST 1 — Locked session blocks create (same exception class as ContinuousRecord)
  // ---------------------------------------------------------------------------
  it('rejects create with BadRequestException when the session is locked', async () => {
    sessions.assertSessionUnlocked.mockRejectedValue(
      new BadRequestException(PORTFOLIO_ITEM_FAILURE.SESSION_LOCKED),
    );

    await expect(service.create(makeCreateDto(), TEACHER)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.__txOpens).toBe(0);
    expect(prisma.portfolioItem.create).not.toHaveBeenCalled();
    expect(prisma.portfolioItemHistory.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // TEST 2 — Teacher scope rejection on create
  // ---------------------------------------------------------------------------
  it('propagates ForbiddenException from TeacherScopeService.assertPortfolioItemAccess', async () => {
    sessions.assertSessionUnlocked.mockResolvedValue(undefined);
    prisma.student.findFirst.mockResolvedValue({
      id: STUDENT_ID,
      schoolId: TENANT,
    });
    prisma.academicSession.findFirst.mockResolvedValue(SESSION_ROW);
    scope.assertPortfolioItemAccess.mockRejectedValue(
      new ForbiddenException(PORTFOLIO_ITEM_FAILURE.TEACHER_NOT_ASSIGNED),
    );

    await expect(service.create(makeCreateDto(), TEACHER)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.__txOpens).toBe(0);
    expect(prisma.portfolioItem.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // TEST 3 — outcomeId NULL → scope helper is called with subjectCode=null,
  //          and the call succeeds when the helper accepts (any-subject path)
  // ---------------------------------------------------------------------------
  it('passes subjectCode=null to scope when outcomeId is omitted ("general observation" path)', async () => {
    primeCreateHappyPath();
    // No learning-outcome lookup should happen in this path.
    prisma.learningOutcome.findUnique.mockImplementation(() => {
      throw new Error('learningOutcome.findUnique must not be called when outcomeId is null');
    });

    await service.create(makeCreateDto(/* no outcomeId */), TEACHER);

    expect(scope.assertPortfolioItemAccess).toHaveBeenCalledWith(TEACHER, {
      studentId: STUDENT_ID,
      subjectCode: null,
    });
    expect(prisma.portfolioItem.create).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // TEST 4 — outcomeId set → wrong-subject teacher rejected by scope helper
  // ---------------------------------------------------------------------------
  it('passes subjectCode=outcome.subjectCode to scope when outcomeId is set, and propagates 403', async () => {
    sessions.assertSessionUnlocked.mockResolvedValue(undefined);
    prisma.student.findFirst.mockResolvedValue({
      id: STUDENT_ID,
      schoolId: TENANT,
    });
    prisma.academicSession.findFirst.mockResolvedValue(SESSION_ROW);
    prisma.learningOutcome.findUnique.mockResolvedValue(OUTCOME_ROW);
    // Wrong-subject teacher → scope helper raises 403. This is the
    // critical contract: when outcomeId IS provided, the subject MUST
    // be enforced.
    scope.assertPortfolioItemAccess.mockRejectedValue(
      new ForbiddenException(PORTFOLIO_ITEM_FAILURE.TEACHER_NOT_ASSIGNED),
    );

    await expect(
      service.create(makeCreateDto({ outcomeId: OUTCOME_ID_CUID }), TEACHER),
    ).rejects.toThrow(ForbiddenException);

    expect(scope.assertPortfolioItemAccess).toHaveBeenCalledWith(TEACHER, {
      studentId: STUDENT_ID,
      subjectCode: SubjectCode.ENGLISH,
    });
    expect(prisma.portfolioItem.create).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // TEST 5 — PATCH happy path + defense-in-depth on extra fields
  // ---------------------------------------------------------------------------
  describe('update (PATCH)', () => {
    const ITEM_ID = '00000000-0000-0000-0000-0000000000cc';

    function primeUpdateHappyPath(existing: Record<string, unknown> = {}) {
      sessions.assertSessionUnlocked.mockResolvedValue(undefined);
      scope.assertPortfolioItemAccess.mockResolvedValue(undefined);
      prisma.portfolioItem.findFirst.mockResolvedValue({
        id: ITEM_ID,
        studentId: STUDENT_ID,
        sessionId: SESSION_ID,
        outcomeId: null,
        description: 'old caption',
        outcome: null,
        ...existing,
      });
      prisma.portfolioItem.update.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: ITEM_ID,
          studentId: STUDENT_ID,
          sessionId: SESSION_ID,
          outcomeId: null,
          type: PortfolioItemType.PROJECT,
          // The update only writes `description` + `updatedById`; every
          // other field is preserved.
          description: data.description,
          occurredOn: new Date('2026-05-01'),
          fileUrl: null,
          ...data,
        }),
      );
      prisma.portfolioItemHistory.create.mockResolvedValue({});
    }

    it('accepts a description-only PATCH and writes one history row with the OLD description', async () => {
      primeUpdateHappyPath();

      await service.update(
        ITEM_ID,
        { description: 'new caption' },
        TEACHER,
      );

      // History invariant: previousDescription = OLD, newDescription = NEW.
      const historyCall = prisma.portfolioItemHistory.create.mock.calls[0][0];
      expect(historyCall.data.previousDescription).toBe('old caption');
      expect(historyCall.data.newDescription).toBe('new caption');
      expect(historyCall.data.portfolioItemId).toBe(ITEM_ID);
      expect(historyCall.data.changedById).toBe(TEACHER.id);

      // Only `description` and `updatedById` were passed to Prisma's
      // update — everything else is left untouched. Asserting on the
      // exact data shape protects against an accidental "include
      // every field in `data`" refactor that would silently allow
      // teachers to change type / occurredOn / etc.
      const updateCall = prisma.portfolioItem.update.mock.calls[0][0];
      expect(Object.keys(updateCall.data).sort()).toEqual(
        ['description', 'updatedById'].sort(),
      );
      expect(prisma.__lastTxCommitted).toBe(true);
    });

    it('rejects PATCH with extra body fields (service-layer defense in depth)', async () => {
      primeUpdateHappyPath();

      // The global ValidationPipe normally rejects this at the
      // controller boundary. The service repeats the assertion so a
      // pipe misconfiguration doesn't quietly open the door.
      await expect(
        service.update(
          ITEM_ID,
          // @ts-expect-error — exercising the defense-in-depth branch
          { description: 'ok', type: PortfolioItemType.HOMEWORK },
          TEACHER,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.portfolioItem.update).not.toHaveBeenCalled();
      expect(prisma.portfolioItemHistory.create).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // TEST 9 — Tenant isolation on PATCH
    // -------------------------------------------------------------------------
    it('returns 404 (NotFoundException) when the item belongs to another school', async () => {
      // The service's findFirst includes `schoolId: user.schoolId` —
      // a cross-tenant id returns null and the service surfaces it
      // as a 404, not a 403. Verifies the cross-tenant existence-
      // disclosure rule.
      prisma.portfolioItem.findFirst.mockResolvedValue(null);

      await expect(
        service.update(ITEM_ID, { description: 'new' }, TEACHER),
      ).rejects.toThrow(NotFoundException);
      expect(sessions.assertSessionUnlocked).not.toHaveBeenCalled();
      expect(prisma.portfolioItem.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 6 — Create writes one history row with previousDescription = null
  // ---------------------------------------------------------------------------
  it('writes exactly one history row on create with previousDescription = null', async () => {
    primeCreateHappyPath();

    await service.create(
      makeCreateDto({ description: 'Solar system poster' }),
      TEACHER,
    );

    expect(prisma.portfolioItemHistory.create).toHaveBeenCalledTimes(1);
    const data = prisma.portfolioItemHistory.create.mock.calls[0][0].data;
    expect(data.previousDescription).toBeNull();
    expect(data.newDescription).toBe('Solar system poster');
    expect(data.changedById).toBe(TEACHER.id);
    expect(prisma.__lastTxCommitted).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // TEST 8 — occurredOn envelope
  // ---------------------------------------------------------------------------
  describe('occurredOn envelope', () => {
    it('rejects a future occurredOn with 400', async () => {
      primeCreateHappyPath();
      await expect(
        service.create(
          // 2026-05-14 is "today" per jest.setSystemTime above.
          makeCreateDto({ occurredOn: '2026-05-15' }),
          TEACHER,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.__txOpens).toBe(0);
    });

    it('rejects an occurredOn before session.startDate with 400', async () => {
      primeCreateHappyPath();
      // session.startDate is 2026-03-01 — 2026-02-28 is one day before.
      await expect(
        service.create(
          makeCreateDto({ occurredOn: '2026-02-28' }),
          TEACHER,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.__txOpens).toBe(0);
    });

    it('accepts occurredOn == session.startDate (inclusive lower bound)', async () => {
      primeCreateHappyPath();
      await expect(
        service.create(
          makeCreateDto({ occurredOn: '2026-03-01' }),
          TEACHER,
        ),
      ).resolves.toBeDefined();
      expect(prisma.portfolioItem.create).toHaveBeenCalledTimes(1);
    });

    it('accepts occurredOn == today (inclusive upper bound)', async () => {
      primeCreateHappyPath();
      await expect(
        service.create(
          makeCreateDto({ occurredOn: '2026-05-14' }),
          TEACHER,
        ),
      ).resolves.toBeDefined();
      expect(prisma.portfolioItem.create).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // TEST 10 — GET ordering: passes `occurredOn DESC, createdAt DESC` to Prisma
  // ---------------------------------------------------------------------------
  it('orders list results by occurredOn DESC then createdAt DESC', async () => {
    prisma.student.findFirst.mockResolvedValue({ id: STUDENT_ID });
    scope.assertPortfolioItemAccess.mockResolvedValue(undefined);
    prisma.portfolioItem.findMany.mockResolvedValue([]);

    await service.list({ studentId: STUDENT_ID, sessionId: SESSION_ID }, TEACHER);

    expect(prisma.portfolioItem.findMany).toHaveBeenCalledTimes(1);
    const args = prisma.portfolioItem.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([
      { occurredOn: 'desc' },
      { createdAt: 'desc' },
    ]);
    // Tenant guard is part of the where clause.
    expect(args.where.schoolId).toBe(TENANT);
    expect(args.where.studentId).toBe(STUDENT_ID);
    expect(args.where.sessionId).toBe(SESSION_ID);
  });

  // ---------------------------------------------------------------------------
  // Session 4.1 — GET response createdBy shape and privacy guarantees
  // ---------------------------------------------------------------------------
  describe('GET response createdBy shape (privacy fix)', () => {
    it('does NOT request createdBy.email from Prisma (no email leak path)', async () => {
      prisma.student.findFirst.mockResolvedValue({ id: STUDENT_ID });
      scope.assertPortfolioItemAccess.mockResolvedValue(undefined);
      prisma.portfolioItem.findMany.mockResolvedValue([]);

      await service.list({ studentId: STUDENT_ID, sessionId: SESSION_ID }, TEACHER);

      const args = prisma.portfolioItem.findMany.mock.calls[0][0];
      const createdBySelect = args.include?.createdBy?.select;
      expect(createdBySelect).toBeDefined();
      expect(createdBySelect.email).toBeUndefined();
      expect(createdBySelect.id).toBe(true);
      // Profile rows are joined so the resolver can pick a display
      // name without exposing User columns.
      expect(createdBySelect.teacher).toEqual({ select: { name: true } });
      expect(createdBySelect.student).toEqual({
        select: { firstName: true, lastName: true },
      });
    });

    it('resolves createdBy { id, name } for the four expected actor cases', async () => {
      prisma.student.findFirst.mockResolvedValue({ id: STUDENT_ID });
      scope.assertPortfolioItemAccess.mockResolvedValue(undefined);
      // Four rows in random order to confirm we don't accidentally sort
      // on the resolver path — the ordering test above already covers
      // the SQL contract.
      const ITEM_BASE = {
        id: 'item-x',
        schoolId: TENANT,
        studentId: STUDENT_ID,
        sessionId: SESSION_ID,
        outcomeId: null,
        type: PortfolioItemType.OBSERVATION,
        description: '...',
        occurredOn: new Date('2026-05-01'),
        fileUrl: null,
        createdAt: new Date('2026-05-01'),
        updatedAt: new Date('2026-05-01'),
        outcome: null,
      };
      prisma.portfolioItem.findMany.mockResolvedValue([
        {
          ...ITEM_BASE,
          id: 'r-teacher',
          createdBy: {
            id: 'u-teacher',
            teacher: { name: 'Mira Thapa' },
            student: null,
          },
        },
        {
          ...ITEM_BASE,
          id: 'r-student',
          createdBy: {
            id: 'u-student',
            teacher: null,
            student: { firstName: 'Ravi', lastName: 'Shrestha' },
          },
        },
        {
          ...ITEM_BASE,
          id: 'r-admin',
          createdBy: {
            id: 'u-admin',
            teacher: null,
            student: null,
          },
        },
        {
          ...ITEM_BASE,
          id: 'r-deleted',
          // SetNull on User delete leaves a null createdBy.
          createdBy: null,
        },
      ]);

      const result = await service.list(
        { studentId: STUDENT_ID, sessionId: SESSION_ID },
        TEACHER,
      );

      // Teacher case → Teacher.name.
      expect(result[0]).toMatchObject({
        id: 'r-teacher',
        createdBy: { id: 'u-teacher', name: 'Mira Thapa' },
      });
      // Student case → firstName + lastName.
      expect(result[1]).toMatchObject({
        id: 'r-student',
        createdBy: { id: 'u-student', name: 'Ravi Shrestha' },
      });
      // Admin / staff / super-admin case → generic 'Administrator'.
      expect(result[2]).toMatchObject({
        id: 'r-admin',
        createdBy: { id: 'u-admin', name: 'Administrator' },
      });
      // Deleted user → null createdBy (frontend treats absent as
      // "actor no longer in system").
      expect(result[3]).toMatchObject({ id: 'r-deleted', createdBy: null });

      // Hard guarantee: no `email` field present anywhere in the
      // response, on any row, including nested objects.
      for (const row of result) {
        expect(JSON.stringify(row)).not.toMatch(/"email"/);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Pure-function tests on the createdBy resolver — fast, no DI.
  // ---------------------------------------------------------------------------
  describe('resolveCreatedByName (pure)', () => {
    it('returns null when the User row is gone (SetNull)', () => {
      expect(resolveCreatedByName(null)).toBeNull();
    });

    it('prefers Teacher.name over Student when both happen to be set', () => {
      // Defensive — schema today has a 1:1 (User has at most one of
      // Teacher / Student), but if someone ever changes that the
      // teacher branch wins.
      expect(
        resolveCreatedByName({
          id: 'u1',
          teacher: { name: 'T-Name' },
          student: { firstName: 'S', lastName: 'Name' },
        }),
      ).toEqual({ id: 'u1', name: 'T-Name' });
    });

    it('falls back to Administrator for admin/staff/super-admin users', () => {
      expect(
        resolveCreatedByName({ id: 'u1', teacher: null, student: null }),
      ).toEqual({ id: 'u1', name: 'Administrator' });
    });

    it('joins firstName + lastName for student authors', () => {
      expect(
        resolveCreatedByName({
          id: 'u1',
          teacher: null,
          student: { firstName: 'Ravi', lastName: 'Shrestha' },
        }),
      ).toEqual({ id: 'u1', name: 'Ravi Shrestha' });
    });

    it('handles a student row with empty names without leaking whitespace', () => {
      expect(
        resolveCreatedByName({
          id: 'u1',
          teacher: null,
          student: { firstName: '', lastName: '' },
        }),
      ).toEqual({ id: 'u1', name: 'Unknown' });
    });
  });
});

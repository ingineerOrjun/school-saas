import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChangeKind, EvalPhase, Role, SubjectCode } from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { TeacherScopeService } from '../common/auth/teacher-scope.service';
import { PrismaService } from '../database/prisma.service';
import {
  CONTINUOUS_RECORD_FAILURE,
  ContinuousRecordService,
} from './continuous-record.service';
import type { CreateContinuousRecordDto } from './dto/create-continuous-record.dto';

// ============================================================================
// ContinuousRecordService spec.
//
// Covers (Session 3 invariants):
//   1. AFTER_SUPPORT precondition — no REGULAR row → 422.
//   2. AFTER_SUPPORT precondition — REGULAR.rating == 3 → 422
//      (the ≤2 threshold is exclusive of 3).
//   3. Teacher scope — TeacherScopeService rejection → ForbiddenException.
//   4. Session lock — AcademicSessionService rejection → BadRequestException
//      (parity with exam/result writes; the exception class IS
//      BadRequestException despite the "423 Locked" comment in
//      exam.service.ts — see the audit report from Session 3's Step 1).
//   5. Optimistic concurrency — stale expectedUpdatedAt inside a bulk
//      throws ConflictException AND the rolled-back writes never commit.
//   6. Bulk transactionality — first invalid AFTER_SUPPORT row before
//      the transaction even opens → no $transaction call at all.
//   7. Idempotency on UPDATE path — the second call against an
//      already-existing row writes one history row with changeKind
//      UPDATE and the previous values snapshotted.
//
// Style mirrors `platform.service.spec.ts` / `student-archive.service.spec.ts`:
// fully-mocked dependencies, no real DB. The $transaction mock tracks
// whether its callback committed, so we can assert "no commits on
// rollback" without standing up Postgres.
// ============================================================================

interface MockTrackedFn extends jest.Mock {}

interface PrismaMock {
  continuousRecord: {
    findUnique: MockTrackedFn;
    findMany: MockTrackedFn;
    create: MockTrackedFn;
    update: MockTrackedFn;
  };
  continuousRecordHistory: {
    create: MockTrackedFn;
  };
  learningOutcome: { findUnique: MockTrackedFn };
  student: { findFirst: MockTrackedFn };
  teacher: { findFirst: MockTrackedFn };
  teachingAssignment: { findMany: MockTrackedFn };
  $transaction: MockTrackedFn;
  /** Did the most recent $transaction callback succeed (i.e. commit)? */
  __lastTxCommitted: boolean;
  /** How many times did the $transaction callback open? */
  __txOpens: number;
}

function makePrismaMock(): PrismaMock {
  const prisma: PrismaMock = {
    continuousRecord: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    continuousRecordHistory: { create: jest.fn() },
    learningOutcome: { findUnique: jest.fn() },
    student: { findFirst: jest.fn() },
    teacher: { findFirst: jest.fn() },
    teachingAssignment: { findMany: jest.fn() },
    $transaction: jest.fn(),
    __lastTxCommitted: false,
    __txOpens: 0,
  };
  // The $transaction mock invokes the callback with `prisma` as its
  // own tx-client (Prisma's real $transaction passes a transaction-
  // scoped client that shares the same surface). Tracks commit vs
  // rollback so tests can assert "writes did NOT persist" without a
  // real DB.
  prisma.$transaction = jest.fn(async (fn: (tx: PrismaMock) => Promise<unknown>) => {
    prisma.__txOpens += 1;
    prisma.__lastTxCommitted = false;
    const result = await fn(prisma);
    prisma.__lastTxCommitted = true;
    return result;
  }) as MockTrackedFn;
  return prisma;
}

const MOCK_USER: AuthenticatedUser = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'teacher@example.test',
  role: Role.TEACHER,
  schoolId: '00000000-0000-0000-0000-000000000099',
} as AuthenticatedUser;

const SAMPLE_OUTCOME = {
  id: 'cuid_outcome_1',
  classLevel: 4,
  subjectCode: SubjectCode.ENGLISH,
};

const SAMPLE_INPUT: CreateContinuousRecordDto = {
  studentId: '00000000-0000-0000-0000-0000000000aa',
  outcomeId: SAMPLE_OUTCOME.id,
  sessionId: '00000000-0000-0000-0000-0000000000bb',
  phase: EvalPhase.REGULAR,
  rating: 3,
  notes: undefined,
};

describe('ContinuousRecordService', () => {
  let service: ContinuousRecordService;
  let prisma: PrismaMock;
  let sessions: { assertSessionUnlocked: MockTrackedFn };
  let scope: {
    assertContinuousRecordAccess: MockTrackedFn;
    assertStudentsInScope: MockTrackedFn;
  };

  beforeEach(async () => {
    prisma = makePrismaMock();
    sessions = { assertSessionUnlocked: jest.fn() };
    scope = {
      assertContinuousRecordAccess: jest.fn(),
      assertStudentsInScope: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContinuousRecordService,
        { provide: PrismaService, useValue: prisma },
        { provide: AcademicSessionService, useValue: sessions },
        { provide: TeacherScopeService, useValue: scope },
      ],
    }).compile();

    service = module.get(ContinuousRecordService);
  });

  // ---------------------------------------------------------------------------
  // INVARIANT 1 — AFTER_SUPPORT precondition: REGULAR must exist
  // ---------------------------------------------------------------------------
  describe('AFTER_SUPPORT precondition', () => {
    it('rejects with 422 when no REGULAR record exists', async () => {
      sessions.assertSessionUnlocked.mockResolvedValue(undefined);
      prisma.learningOutcome.findUnique.mockResolvedValue(SAMPLE_OUTCOME);
      scope.assertContinuousRecordAccess.mockResolvedValue(undefined);
      // The REGULAR lookup returns null — the precondition fails.
      prisma.continuousRecord.findUnique.mockResolvedValue(null);

      await expect(
        service.upsertSingle(
          { ...SAMPLE_INPUT, phase: EvalPhase.AFTER_SUPPORT },
          MOCK_USER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);

      // No transaction was opened — the precondition fires BEFORE
      // we ever reach the write path.
      expect(prisma.__txOpens).toBe(0);
      expect(prisma.continuousRecord.create).not.toHaveBeenCalled();
      expect(prisma.continuousRecord.update).not.toHaveBeenCalled();
    });

    it('rejects with 422 when the REGULAR rating is 3 (above the ≤2 threshold)', async () => {
      sessions.assertSessionUnlocked.mockResolvedValue(undefined);
      prisma.learningOutcome.findUnique.mockResolvedValue(SAMPLE_OUTCOME);
      scope.assertContinuousRecordAccess.mockResolvedValue(undefined);
      // REGULAR exists with rating 3 — the precondition still fails.
      prisma.continuousRecord.findUnique.mockResolvedValue({ rating: 3 });

      await expect(
        service.upsertSingle(
          { ...SAMPLE_INPUT, phase: EvalPhase.AFTER_SUPPORT },
          MOCK_USER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(prisma.__txOpens).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // INVARIANT 2 — Teacher scope enforcement
  // ---------------------------------------------------------------------------
  describe('teacher scope enforcement', () => {
    it('propagates the ForbiddenException from TeacherScopeService', async () => {
      sessions.assertSessionUnlocked.mockResolvedValue(undefined);
      prisma.learningOutcome.findUnique.mockResolvedValue(SAMPLE_OUTCOME);
      // TeacherScopeService rejects — service must propagate the 403
      // without opening a transaction or writing anything.
      scope.assertContinuousRecordAccess.mockRejectedValue(
        new ForbiddenException(CONTINUOUS_RECORD_FAILURE.TEACHER_NOT_ASSIGNED),
      );

      await expect(
        service.upsertSingle(SAMPLE_INPUT, MOCK_USER),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.__txOpens).toBe(0);
      expect(prisma.continuousRecord.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // INVARIANT 3 — Locked session blocks writes
  // ---------------------------------------------------------------------------
  describe('locked session', () => {
    it('rejects with BadRequestException (mirroring exam/result write paths)', async () => {
      // AcademicSessionService throws the EXACT same BadRequestException
      // exams and results writes throw — see Session 3 Step 1 audit.
      sessions.assertSessionUnlocked.mockRejectedValue(
        new BadRequestException(CONTINUOUS_RECORD_FAILURE.SESSION_LOCKED),
      );

      await expect(
        service.upsertSingle(SAMPLE_INPUT, MOCK_USER),
      ).rejects.toThrow(BadRequestException);
      // Lock check is the FIRST gate — outcome lookup never runs.
      expect(prisma.learningOutcome.findUnique).not.toHaveBeenCalled();
      expect(prisma.__txOpens).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // INVARIANT 4 — Optimistic concurrency in bulk (rollback semantics)
  // ---------------------------------------------------------------------------
  describe('upsertBulk optimistic concurrency', () => {
    it('fails the whole batch with CONCURRENT_MODIFICATION when expectedUpdatedAt is stale', async () => {
      // Two inputs. The first matches expectedUpdatedAt and would
      // commit; the second mismatches and triggers a ConflictException.
      // Because both writes share the transaction, the first one's
      // would-be-create MUST NOT be committed.
      const t = new Date('2026-05-14T10:00:00.000Z');
      const stale = '2026-05-14T09:00:00.000Z';

      const inputs: CreateContinuousRecordDto[] = [
        {
          ...SAMPLE_INPUT,
          studentId: '00000000-0000-0000-0000-0000000000a1',
          expectedUpdatedAt: t.toISOString(),
        },
        {
          ...SAMPLE_INPUT,
          studentId: '00000000-0000-0000-0000-0000000000a2',
          expectedUpdatedAt: stale,
        },
      ];

      sessions.assertSessionUnlocked.mockResolvedValue(undefined);
      prisma.learningOutcome.findUnique.mockResolvedValue(SAMPLE_OUTCOME);
      scope.assertContinuousRecordAccess.mockResolvedValue(undefined);
      // Pre-validation step is now done. Inside the transaction:
      //
      //   • Record 1 expectedUpdatedAt check: findUnique returns
      //     `{ updatedAt: t }` — equal → proceed to write.
      //   • Record 1 student lookup: returns the student row.
      //   • Record 1 existing lookup: returns null → create path.
      //   • Record 2 expectedUpdatedAt check: findUnique returns
      //     `{ updatedAt: t }` — stale (`stale` < t) → ConflictException.
      //
      // The findUnique mock has to discriminate by call order.
      prisma.continuousRecord.findUnique
        .mockResolvedValueOnce({ updatedAt: t }) // record 1 expectedUpdatedAt
        .mockResolvedValueOnce(null) // record 1 inside upsertOne
        .mockResolvedValueOnce({ updatedAt: t }); // record 2 expectedUpdatedAt
      prisma.student.findFirst.mockResolvedValue({
        schoolId: MOCK_USER.schoolId,
      });
      prisma.continuousRecord.create.mockResolvedValue({
        id: 'fake-record-1',
        rating: SAMPLE_INPUT.rating,
        phase: SAMPLE_INPUT.phase,
        notes: null,
      });
      prisma.continuousRecordHistory.create.mockResolvedValue({});

      await expect(service.upsertBulk(inputs, MOCK_USER)).rejects.toThrow(
        ConflictException,
      );
      // CRITICAL: the transaction must NOT have committed. The mock's
      // $transaction sets __lastTxCommitted=true only when its callback
      // returns; the throw above aborts it.
      expect(prisma.__lastTxCommitted).toBe(false);
      expect(prisma.__txOpens).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // INVARIANT 5 — Bulk transactionality: pre-validation failure means
  //                NO transaction ever opens
  // ---------------------------------------------------------------------------
  describe('upsertBulk pre-validation', () => {
    it('rejects with 400 on duplicate composite keys without opening a transaction', async () => {
      const dup: CreateContinuousRecordDto[] = [
        SAMPLE_INPUT,
        { ...SAMPLE_INPUT }, // same studentId / outcomeId / sessionId / phase
      ];

      await expect(service.upsertBulk(dup, MOCK_USER)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.__txOpens).toBe(0);
      expect(sessions.assertSessionUnlocked).not.toHaveBeenCalled();
    });

    it('rolls back the entire batch when one row fails the AFTER_SUPPORT precondition', async () => {
      const inputs: CreateContinuousRecordDto[] = [
        { ...SAMPLE_INPUT, studentId: '00000000-0000-0000-0000-0000000000a1' },
        {
          ...SAMPLE_INPUT,
          studentId: '00000000-0000-0000-0000-0000000000a2',
          phase: EvalPhase.AFTER_SUPPORT,
          rating: 4,
        },
      ];

      sessions.assertSessionUnlocked.mockResolvedValue(undefined);
      prisma.learningOutcome.findUnique.mockResolvedValue(SAMPLE_OUTCOME);
      scope.assertContinuousRecordAccess.mockResolvedValue(undefined);
      // The AFTER_SUPPORT precondition for the SECOND input fires
      // during pre-validation. Note this REGULAR lookup returns null.
      prisma.continuousRecord.findUnique.mockResolvedValue(null);

      await expect(service.upsertBulk(inputs, MOCK_USER)).rejects.toThrow(
        UnprocessableEntityException,
      );
      // The transaction never opens because pre-validation throws first.
      expect(prisma.__txOpens).toBe(0);
      expect(prisma.continuousRecord.create).not.toHaveBeenCalled();
      expect(prisma.continuousRecord.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // INVARIANT 6 — Idempotency: re-upserting writes UPDATE history
  // ---------------------------------------------------------------------------
  describe('idempotency / history append on UPDATE', () => {
    it('writes one UPDATE history row with previous values snapshotted', async () => {
      sessions.assertSessionUnlocked.mockResolvedValue(undefined);
      prisma.learningOutcome.findUnique.mockResolvedValue(SAMPLE_OUTCOME);
      scope.assertContinuousRecordAccess.mockResolvedValue(undefined);
      prisma.student.findFirst.mockResolvedValue({
        schoolId: MOCK_USER.schoolId,
      });
      // Existing row — same composite key, older rating.
      const existing = {
        id: 'rec-1',
        rating: 2,
        notes: 'first try',
        phase: SAMPLE_INPUT.phase,
        updatedAt: new Date(),
      };
      prisma.continuousRecord.findUnique.mockResolvedValue(existing);
      prisma.continuousRecord.update.mockResolvedValue({
        ...existing,
        rating: 4,
        notes: 'better now',
      });
      prisma.continuousRecordHistory.create.mockResolvedValue({});

      await service.upsertSingle(
        { ...SAMPLE_INPUT, rating: 4, notes: 'better now' },
        MOCK_USER,
      );

      // No create — the update path fired.
      expect(prisma.continuousRecord.create).not.toHaveBeenCalled();
      expect(prisma.continuousRecord.update).toHaveBeenCalledTimes(1);

      // History row: one UPDATE with previousRating snapshotted.
      expect(prisma.continuousRecordHistory.create).toHaveBeenCalledTimes(1);
      const historyCall =
        prisma.continuousRecordHistory.create.mock.calls[0][0];
      expect(historyCall.data.changeKind).toBe(ChangeKind.UPDATE);
      expect(historyCall.data.previousRating).toBe(2);
      expect(historyCall.data.previousNotes).toBe('first try');
      expect(historyCall.data.rating).toBe(4);
      expect(historyCall.data.notes).toBe('better now');
      expect(prisma.__lastTxCommitted).toBe(true);
    });
  });
});

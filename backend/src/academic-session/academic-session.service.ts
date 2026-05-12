import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type AcademicSession } from '@prisma/client';
import { txWithRetry } from '../common/db/tx-retry';
import { PrismaService } from '../database/prisma.service';
import { CreateAcademicSessionDto } from './dto/create-academic-session.dto';

/**
 * Academic-session catalog. One row per academic year per school;
 * exactly one row per school may be marked `isActive = true`
 * (enforced by a partial unique index AND by `setActive`'s
 * transaction).
 *
 * Other modules call `getActiveSessionId(schoolId)` to fill in the
 * sessionId column on writes (Exam, Result, Attendance, Announcement)
 * when the caller didn't pass one explicitly.
 */
@Injectable()
export class AcademicSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** All sessions for a school, newest startDate first. */
  list(schoolId: string): Promise<AcademicSession[]> {
    return this.prisma.academicSession.findMany({
      where: { schoolId },
      orderBy: { startDate: 'desc' },
    });
  }

  /**
   * The school's currently-active session, or `null` when none is
   * marked active. Cheap (indexed) — safe to call inside hot write
   * paths to default a missing sessionId.
   */
  async getActive(schoolId: string): Promise<AcademicSession | null> {
    return this.prisma.academicSession.findFirst({
      where: { schoolId, isActive: true },
    });
  }

  /**
   * Convenience for write paths that just need the id. Returns null
   * when there's no active session — callers should treat null as
   * "no session", NOT as an error (legacy data path).
   *
   * For STRICT-write semantics use `requireActiveId` instead — that
   * one throws "No active academic session" so the caller doesn't
   * silently insert sessionless rows.
   */
  async getActiveId(schoolId: string): Promise<string | null> {
    const s = await this.getActive(schoolId);
    return s?.id ?? null;
  }

  /**
   * Strict write helper — every new exam, attendance row, and
   * announcement MUST be attributed to a session. Throws a clean 400
   * with the user-spec'd message when no active session exists so the
   * UI can prompt admins to create one before any data piles up
   * unattributed.
   */
  async requireActiveId(schoolId: string): Promise<string> {
    const id = await this.getActiveId(schoolId);
    if (!id) {
      throw new BadRequestException('No active academic session');
    }
    return id;
  }

  /**
   * Stricter write helper — same as `requireActiveId` PLUS rejects
   * when the active session is locked. Used by attendance.mark,
   * exam create/update, and result save/bulkSave. Lock is the
   * mechanism admins use to freeze the year before running
   * promotion; once locked the session refuses every write listed
   * in the role spec ("attendance writes, marks updates, exam edits").
   */
  async requireActiveUnlocked(schoolId: string): Promise<string> {
    const active = await this.getActive(schoolId);
    if (!active) {
      throw new BadRequestException('No active academic session');
    }
    if (active.isLocked) {
      throw new BadRequestException(
        'Active session is locked. Unlock it or run promotion to start a new session.',
      );
    }
    return active.id;
  }

  /**
   * Throws if the named session is locked. Used by writes that
   * target a SPECIFIC session (e.g. saving results against an old
   * exam whose session got locked yesterday). Pass null to bypass
   * — legacy rows with sessionId = null are unrestricted.
   */
  async assertSessionUnlocked(sessionId: string | null): Promise<void> {
    if (!sessionId) return;
    const s = await this.prisma.academicSession.findUnique({
      where: { id: sessionId },
      select: { isLocked: true },
    });
    if (s?.isLocked) {
      throw new BadRequestException(
        'This session is locked. Writes are no longer permitted.',
      );
    }
  }

  /**
   * Toggle the lock flag on a session. Idempotent — re-locking an
   * already-locked session is a no-op. Tenant-guarded; throws 404
   * cross-tenant.
   */
  async setLocked(
    id: string,
    schoolId: string,
    locked: boolean,
  ): Promise<AcademicSession> {
    const found = await this.prisma.academicSession.findFirst({
      where: { id, schoolId },
      select: { id: true, isLocked: true },
    });
    if (!found) throw new NotFoundException('Session not found.');
    if (found.isLocked === locked) {
      // No-op fast path — return the row unchanged.
      return this.prisma.academicSession.findUniqueOrThrow({
        where: { id },
      });
    }
    return this.prisma.academicSession.update({
      where: { id },
      data: { isLocked: locked },
    });
  }

  /**
   * Read-side default filter. Resolves the `sessionId` value to use
   * in a Prisma `where` clause, applying the strict-default rules:
   *
   *   • Caller passed an explicit sessionId   → use it (admins can
   *     deliberately view past sessions)
   *   • No explicit value, ACTIVE session set → filter to active
   *     session only (NULL legacy rows excluded)
   *   • No explicit value, NO active session  → filter to NULL rows
   *     (legacy fallback so a fresh school with pre-session data
   *     doesn't suddenly look empty)
   *
   * Returned shape spreads directly into a Prisma `where`:
   *
   *   const filter = await this.sessions.resolveReadFilter(schoolId, q);
   *   prisma.exam.findMany({ where: { schoolId, ...filter } });
   *
   * `sessionId: null` correctly translates to `WHERE "sessionId" IS NULL`
   * in Prisma, so the legacy fallback works without a separate code path.
   */
  async resolveReadFilter(
    schoolId: string,
    requested?: string | null,
  ): Promise<{ sessionId: string | null }> {
    if (requested) return { sessionId: requested };
    const active = await this.getActiveId(schoolId);
    return { sessionId: active ?? null };
  }

  /**
   * Create a new session. If `isActive: true` is passed, the same
   * transaction flips every OTHER session for this school to false
   * — the partial unique index would otherwise reject a second
   * active row.
   */
  async create(
    dto: CreateAcademicSessionDto,
    schoolId: string,
  ): Promise<AcademicSession> {
    if (new Date(dto.startDate) >= new Date(dto.endDate)) {
      throw new BadRequestException('startDate must be before endDate.');
    }

    try {
      // Phase RELIABILITY Part 1: txWithRetry so a P2034 (e.g. two
      // admins activating different new sessions simultaneously)
      // retries once instead of surfacing as 500. Unique-violation
      // P2002 falls through untouched and is mapped to 409 below.
      return await txWithRetry(
        this.prisma,
        async (tx) => {
          if (dto.isActive) {
            await tx.academicSession.updateMany({
              where: { schoolId, isActive: true },
              data: { isActive: false },
            });
          }
          return tx.academicSession.create({
            data: {
              name: dto.name.trim(),
              startDate: new Date(dto.startDate),
              endDate: new Date(dto.endDate),
              isActive: dto.isActive ?? false,
              schoolId,
            },
          });
        },
        { label: 'create-session' },
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `A session named "${dto.name.trim()}" already exists for this school.`,
        );
      }
      throw e;
    }
  }

  /**
   * Atomically promote the named session to active and demote any
   * existing active session in the same school. The transaction
   * makes this race-safe: even if two admins click "Activate" at
   * the same moment, the partial unique index blocks the second.
   */
  async setActive(id: string, schoolId: string): Promise<AcademicSession> {
    // Phase RELIABILITY Part 1: retry-aware wrapper. The partial
    // unique index is the source of truth for "exactly one active";
    // a concurrent flip would 409 here, but a *transient* P2034
    // (e.g. row-lock contention with a running promotion) retries
    // gracefully without changing semantics.
    return txWithRetry(
      this.prisma,
      async (tx) => {
        const target = await tx.academicSession.findFirst({
          where: { id, schoolId },
          select: { id: true, isActive: true },
        });
        if (!target) throw new NotFoundException('Session not found.');
        if (target.isActive) {
          // Already active — short-circuit, nothing to flip.
          return tx.academicSession.findUniqueOrThrow({ where: { id } });
        }
        // Demote first; a partial unique index forbids two active rows.
        await tx.academicSession.updateMany({
          where: { schoolId, isActive: true },
          data: { isActive: false },
        });
        return tx.academicSession.update({
          where: { id },
          data: { isActive: true },
        });
      },
      { label: 'activate-session' },
    );
  }

  async remove(id: string, schoolId: string): Promise<void> {
    const found = await this.prisma.academicSession.findFirst({
      where: { id, schoolId },
      select: { id: true, name: true, isActive: true },
    });
    if (!found) throw new NotFoundException('Session not found.');
    if (found.isActive) {
      // Phase ACADEMIC TRANSITION SAFETY Part 5+7 — explicit message
      // tells the operator the exact remediation step.
      throw new ConflictException(
        `Cannot delete "${found.name}" while it is the active session. Activate a different session first, then retry.`,
      );
    }
    // Block delete if there are any StudentAcademicRecord snapshots
    // pinned to this session. Promotion history is the academic
    // record of record; we don't let it be silently severed via FK
    // SetNull at delete time.
    const historyCount = await this.prisma.studentAcademicRecord.count({
      where: { sessionId: id },
    });
    if (historyCount > 0) {
      throw new ConflictException(
        `Cannot delete "${found.name}" — ${historyCount} promotion history record(s) reference it. Archive the session row in a later phase instead.`,
      );
    }
    // FKs use ON DELETE SET NULL on every child table so dropping a
    // session unlinks its rows rather than blowing them away.
    await this.prisma.academicSession.delete({ where: { id } });
  }

  /**
   * Phase ACADEMIC TRANSITION SAFETY Part 5 — guard for writes that
   * target a SPECIFIC session id (e.g. saving results against an old
   * exam, running an admissions report). Throws with explicit
   * remediation copy when the session is locked / ended.
   *
   * Unlike `assertSessionUnlocked` this also flags an ended session
   * — useful when the caller actually cares about "is this year still
   * accepting writes" rather than just the lock flag.
   */
  async assertSessionWritable(
    sessionId: string | null,
  ): Promise<void> {
    if (!sessionId) return;
    const s = await this.prisma.academicSession.findUnique({
      where: { id: sessionId },
      select: { name: true, isLocked: true, endDate: true },
    });
    if (!s) return;
    if (s.isLocked) {
      throw new BadRequestException(
        `Session "${s.name}" is locked. Unlock it from Settings → Sessions before writing.`,
      );
    }
    if (new Date() > s.endDate) {
      // ENDED is non-fatal for read paths but write paths should
      // surface it as a sanity check.
      throw new BadRequestException(
        `Session "${s.name}" ended on ${s.endDate
          .toISOString()
          .slice(0, 10)}. Promote to the next session before writing.`,
      );
    }
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

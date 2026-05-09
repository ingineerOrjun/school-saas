import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, StudentSessionStatus } from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { RunPromotionDto } from './dto/run-promotion.dto';

/**
 * Result summary returned to the caller after a successful promotion.
 * Lets the UI render a "promoted X, retained Y, left Z" toast and
 * deep-link to the new session immediately.
 */
export interface PromotionResult {
  fromSessionId: string;
  fromSessionName: string;
  toSessionId: string;
  toSessionName: string;
  counts: {
    promoted: number;
    retained: number;
    left: number;
    total: number;
  };
}

/**
 * Promotion = "close the year, roll students forward, open the next
 * year". Strictly atomic — every change for every student plus the
 * new-session creation lives in a single `prisma.$transaction`. If
 * any one row fails validation, the whole operation rolls back and
 * the school stays in its previous state.
 *
 * Preconditions (checked before the transaction starts):
 *   • An active session must exist.
 *   • The active session must be LOCKED. Lock-then-promote is the
 *     deliberate two-step UX — admins lock to freeze attendance/
 *     marks/exams, double-check the books, then promote.
 *
 * Flow:
 *   1. Snapshot every entry → StudentAcademicRecord (sessionId =
 *      current active). One row per (student, session).
 *   2. For PROMOTED entries: update Student.classId (and optional
 *      sectionId) to the next class.
 *   3. For RETAINED / LEFT entries: leave the student row alone.
 *   4. Demote the current session (isActive = false).
 *   5. Create the new session (isActive = true, isLocked = false).
 *
 * After the transaction returns, the school is in the new academic
 * year and every write target — attendance, exams, results — flows
 * into the new session via the existing strict-default rules.
 */
@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  async run(
    dto: RunPromotionDto,
    schoolId: string,
  ): Promise<PromotionResult> {
    // ----- Preconditions -----
    const active = await this.sessions.getActive(schoolId);
    if (!active) {
      throw new BadRequestException('No active academic session');
    }
    if (!active.isLocked) {
      throw new BadRequestException(
        'Active session must be locked before running promotion. Lock it from /settings/sessions first.',
      );
    }

    if (
      new Date(dto.nextSession.startDate) >=
      new Date(dto.nextSession.endDate)
    ) {
      throw new BadRequestException(
        'nextSession startDate must be before endDate.',
      );
    }

    // De-dupe studentIds in the payload — the unique index on
    // (studentId, sessionId) would catch this at insert, but a
    // pre-check returns a clearer error.
    const studentIds = dto.entries.map((e) => e.studentId);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException(
        'Duplicate studentId entries in the promotion payload.',
      );
    }

    // PROMOTED entries must carry a nextClassId. Validating at the
    // payload level (rather than per-row inside the txn) so we
    // never start the transaction with bad data.
    for (const entry of dto.entries) {
      if (
        entry.status === StudentSessionStatus.PROMOTED &&
        !entry.nextClassId
      ) {
        throw new BadRequestException(
          'PROMOTED entries must include nextClassId.',
        );
      }
    }

    // ----- Resolve students + classes in batch ahead of the txn -----
    // Validates tenant ownership of every entity referenced by the
    // payload. One round-trip per kind, much cheaper than per-row.
    const students = await this.prisma.student.findMany({
      where: { id: { in: studentIds }, schoolId },
      select: {
        id: true,
        classId: true,
        sectionId: true,
      },
    });
    if (students.length !== studentIds.length) {
      throw new BadRequestException(
        'One or more students do not belong to this school.',
      );
    }
    const studentById = new Map(students.map((s) => [s.id, s]));

    const referencedClassIds = Array.from(
      new Set(
        dto.entries
          .map((e) => e.nextClassId)
          .filter((id): id is string => !!id),
      ),
    );
    if (referencedClassIds.length > 0) {
      const validClasses = await this.prisma.class.count({
        where: { id: { in: referencedClassIds }, schoolId },
      });
      if (validClasses !== referencedClassIds.length) {
        throw new BadRequestException(
          'One or more nextClassId values do not belong to this school.',
        );
      }
    }

    // Sections, when supplied, must belong to the matching nextClassId.
    const sectionChecks = dto.entries
      .filter((e) => e.nextSectionId && e.nextClassId)
      .map((e) => ({ classId: e.nextClassId!, sectionId: e.nextSectionId! }));
    if (sectionChecks.length > 0) {
      const found = await this.prisma.section.findMany({
        where: {
          id: { in: sectionChecks.map((c) => c.sectionId) },
        },
        select: { id: true, classId: true },
      });
      const byId = new Map(found.map((s) => [s.id, s.classId]));
      for (const check of sectionChecks) {
        if (byId.get(check.sectionId) !== check.classId) {
          throw new BadRequestException(
            'One or more nextSectionId values do not belong to the matching nextClassId.',
          );
        }
      }
    }

    // Refuse if a session with the proposed name already exists.
    const dupeName = await this.prisma.academicSession.findFirst({
      where: { schoolId, name: dto.nextSession.name.trim() },
      select: { id: true },
    });
    if (dupeName) {
      throw new BadRequestException(
        `A session named "${dto.nextSession.name.trim()}" already exists.`,
      );
    }

    // Each student needs a snapshot — they MUST currently be in a
    // class (we snapshot their classId). If a student in the payload
    // has no current class, we can't honestly record where they were
    // — surface as a clear error.
    for (const entry of dto.entries) {
      const s = studentById.get(entry.studentId)!;
      if (!s.classId) {
        throw new BadRequestException(
          `Student ${entry.studentId} has no current class — cannot snapshot.`,
        );
      }
    }

    // ----- Atomic transaction -----
    const counts = { promoted: 0, retained: 0, left: 0 };

    const newSession = await this.prisma.$transaction(async (tx) => {
      // 1. Snapshot rows (one per student × session). Skip-on-conflict
      //    isn't supported via createMany without `skipDuplicates`,
      //    but we want hard failure on duplicates — better to fail
      //    cleanly than silently skip rows.
      const snapshotData: Prisma.StudentAcademicRecordCreateManyInput[] =
        dto.entries.map((entry) => {
          const s = studentById.get(entry.studentId)!;
          return {
            studentId: entry.studentId,
            sessionId: active.id,
            // classId is non-null per the precheck above.
            classId: s.classId!,
            sectionId: s.sectionId,
            schoolId,
            status: entry.status,
          };
        });
      await tx.studentAcademicRecord.createMany({ data: snapshotData });

      // 2. Roll PROMOTED students forward. We do this one at a time
      //    so the entries' nextClassId / nextSectionId map cleanly
      //    onto each row — `updateMany` with per-row data isn't
      //    available in Prisma. The transaction batches them so the
      //    wire cost is a single round-trip even at hundreds of rows.
      for (const entry of dto.entries) {
        if (entry.status === StudentSessionStatus.PROMOTED) {
          counts.promoted++;
          await tx.student.update({
            where: { id: entry.studentId },
            data: {
              classId: entry.nextClassId!,
              // Sections typically shuffle year-over-year. Reset
              // unless the caller explicitly named one.
              sectionId: entry.nextSectionId ?? null,
            },
          });
        } else if (entry.status === StudentSessionStatus.RETAINED) {
          counts.retained++;
          // No class change — student stays where they were.
        } else if (entry.status === StudentSessionStatus.LEFT) {
          counts.left++;
          // No class change — keep their last class for historical
          // reads. The school can hard-delete the student later if
          // they want to fully purge.
        }
      }

      // 3. Demote the current session (don't unlock — the partial
      //    unique index forbids two active rows, so we must clear
      //    isActive before activating the next one).
      await tx.academicSession.update({
        where: { id: active.id },
        data: { isActive: false },
      });

      // 4. Create the new session as ACTIVE + UNLOCKED. Writes
      //    immediately resume targeting it.
      return tx.academicSession.create({
        data: {
          name: dto.nextSession.name.trim(),
          startDate: new Date(dto.nextSession.startDate),
          endDate: new Date(dto.nextSession.endDate),
          isActive: true,
          isLocked: false,
          schoolId,
        },
      });
    });

    const result: PromotionResult = {
      fromSessionId: active.id,
      fromSessionName: active.name,
      toSessionId: newSession.id,
      toSessionName: newSession.name,
      counts: {
        ...counts,
        total: dto.entries.length,
      },
    };

    // Phase 20 — fire a school-wide in-app notification + email to
    // the school's first ADMIN summarising the promotion. Best-
    // effort: a notification failure NEVER rolls back the promotion
    // (which is already committed by this point).
    void this.sendPromotionCompletedNotification(schoolId, result).catch(
      (e) => {
        this.logger.error(
          `promotion-completed notification failed for school=${schoolId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      },
    );

    return result;
  }

  /**
   * Fan out the promotion-completed notification.
   * Two recipients:
   *   • School-wide IN_APP broadcast (every user sees it in the bell).
   *   • Email to the first ADMIN — the operator-of-record for the
   *     decision; getting an email summary in their inbox lets them
   *     forward / archive without opening the dashboard.
   */
  private async sendPromotionCompletedNotification(
    schoolId: string,
    result: PromotionResult,
  ): Promise<void> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true },
    });
    if (!school) return;

    const admin = await this.prisma.user.findFirst({
      where: { schoolId, role: Role.ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    });

    await this.notifications.enqueue({
      templateKey: 'school.promotion_completed',
      // Email goes to the first admin; in-app broadcast covers
      // everyone else.
      recipients: admin ? { email: admin.email } : {},
      // Per-(school, run-completion) dedupe so an idempotent re-call
      // can't double-fire.
      dedupeKey: `school:${schoolId}:promotion:${result.toSessionId}`,
      schoolId,
      // No userId → school-wide broadcast for the in-app channel.
      // Admin still gets the email (recipients.email above).
      severity: 'SUCCESS',
      title: `Promotion complete — ${result.toSessionName}`,
      payload: {
        brand: this.config.get('mail.brand'),
        schoolName: school.name,
        fromSessionName: result.fromSessionName,
        toSessionName: result.toSessionName,
        counts: {
          promoted: result.counts.promoted,
          retained: result.counts.retained,
          left: result.counts.left,
        },
      },
    });
  }

  /**
   * List academic-record history for a single student. Read-only;
   * useful for "show me this student's class history" surfaces.
   */
  async listForStudent(studentId: string, schoolId: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found.');
    return this.prisma.studentAcademicRecord.findMany({
      where: { studentId, schoolId },
      include: {
        session: { select: { id: true, name: true } },
        class: { select: { id: true, name: true } },
        section: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

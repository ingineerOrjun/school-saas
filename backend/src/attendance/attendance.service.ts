import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, PlatformAuditAction, Prisma } from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import { PrismaService } from '../database/prisma.service';
import { PlatformAuditService } from '../platform/platform-audit.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { ReportQueryDto } from './dto/report-query.dto';

/**
 * Threshold for ATTENDANCE_BULK_OVERWRITE audit emit. A single
 * mark() call writing this many or more rows is treated as a bulk
 * operation (markAll-present / markAll-absent flows on the
 * attendance page) and gets an audit event so a "the whole class
 * was marked at 9:02 AM by Y" line is recoverable.
 *
 * Single toggles stay below the threshold and don't audit — the
 * platform audit stream would otherwise flood with one entry per
 * checkbox click.
 */
const ATTENDANCE_BULK_THRESHOLD = 5;

export interface AttendanceRoster {
  studentId: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus | null;
}

/**
 * Wrapper for the roster endpoint. Adds a `version` string so
 * frontend caches can detect when their stored copy has drifted from
 * the server.
 *
 * Version semantics: the ISO timestamp of the most recently-touched
 * student in the roster (`max(student.updatedAt)`). New enrollments,
 * profile edits, and section transfers all bump this. Deletions are
 * NOT directly captured — but in practice deletions tend to come
 * paired with edits elsewhere, AND the next online fetch always
 * replaces the cache regardless. The version is a hint to clients,
 * not a perfect oracle.
 */
export interface RosterResponse {
  students: AttendanceRoster[];
  /** ISO timestamp — max(updatedAt) across queried students, or
   *  the unix epoch when the roster is empty (so clients can still
   *  compare strings without a special-case). */
  version: string;
}

export interface ReportSummary {
  totalDays: number;
  presentDays: number;
  absentDays: number;
  /** Null when `totalDays` is 0 (no data to compute over). */
  percentage: number | null;
}

/**
 * One bucket in an attendance trend series — the per-day breakdown
 * the dashboard charts plot. `percentage` is null on days with no
 * recorded marks (weekends, holidays) so the chart can show gaps
 * instead of a misleading 0%.
 */
export interface TrendDayBucket {
  /** YYYY-MM-DD. */
  date: string;
  presentCount: number;
  absentCount: number;
  /** presentCount + absentCount. */
  totalCount: number;
  /** 0..100, or null when there were no marks that day. */
  percentage: number | null;
}

export interface AttendanceTrend {
  fromDate: string;
  toDate: string;
  /**
   * Scope label rendered in chart titles. "School" when no scope
   * was specified; the class / section name otherwise.
   */
  scopeLabel: string;
  daily: TrendDayBucket[];
  totals: ReportSummary;
}

export interface StudentReportRow extends ReportSummary {
  studentId: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
}

export interface StudentAttendanceReport extends ReportSummary {
  scope: 'student';
  fromDate: string;
  toDate: string;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    symbolNumber: string | null;
    section: { name: string; className: string } | null;
  };
}

export interface SectionAttendanceReport extends ReportSummary {
  scope: 'section';
  fromDate: string;
  toDate: string;
  section: { id: string; name: string; className: string };
  students: StudentReportRow[];
  /** Number of students with percentage < 75% over the range. */
  lowAttendanceCount: number;
}

/** Whole-class attendance report for schools without sections. */
export interface ClassAttendanceReport extends ReportSummary {
  scope: 'class';
  fromDate: string;
  toDate: string;
  class: { id: string; name: string };
  students: StudentReportRow[];
  /** Number of students with percentage < 75% over the range. */
  lowAttendanceCount: number;
}

/** Below this percentage a student is considered at-risk. */
export const LOW_ATTENDANCE_THRESHOLD = 75;

export type AttendanceReport =
  | StudentAttendanceReport
  | SectionAttendanceReport
  | ClassAttendanceReport;

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * Return the roster for a section or a whole class on a given date.
   *
   * Scope resolution:
   *   - `sectionId` set → students in that section.
   *   - `classId` set (without sectionId) → students directly assigned to
   *     that class with no section (the "class has no sections" case).
   *   - Neither → 400.
   *
   * Each row carries the student's attendance status (PRESENT / ABSENT)
   * or `null` if nothing has been recorded for that day yet.
   */
  async getRoster(
    dateISO: string,
    scope: { sectionId?: string; classId?: string },
    schoolId: string,
    sessionId?: string,
  ): Promise<RosterResponse> {
    let studentWhere: Prisma.StudentWhereInput;

    if (scope.sectionId) {
      // Cross-tenant guard: section must belong to caller's school.
      const section = await this.prisma.section.findFirst({
        where: { id: scope.sectionId, class: { schoolId } },
        select: { id: true },
      });
      if (!section) {
        throw new NotFoundException('Section not found.');
      }
      studentWhere = { sectionId: scope.sectionId };
    } else if (scope.classId) {
      // Cross-tenant guard: class must belong to caller's school.
      const klass = await this.prisma.class.findFirst({
        where: { id: scope.classId, schoolId },
        select: { id: true },
      });
      if (!klass) {
        throw new NotFoundException('Class not found.');
      }
      // "Whole class" attendance covers students linked directly to this
      // class with no section assigned. Students placed into a section of
      // this class are rostered via their section instead, so there's no
      // double-counting the same student on the same day.
      studentWhere = { classId: scope.classId, sectionId: null };
    } else {
      throw new BadRequestException(
        'Provide either sectionId or classId.',
      );
    }

    const date = parseDate(dateISO);

    const students = await this.prisma.student.findMany({
      where: studentWhere,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      // updatedAt is read purely to derive the response's `version` —
      // not exposed to clients in the row data itself.
      select: {
        id: true,
        firstName: true,
        lastName: true,
        updatedAt: true,
      },
    });

    // Compose `version` once. Even when the roster is empty we return
    // a string (the unix epoch) so clients can do a uniform string
    // compare — null/undefined would force a special case at every
    // call site.
    const version = computeRosterVersion(students);

    if (students.length === 0) {
      return { students: [], version };
    }

    // Strict-default session filter — only show attendance attributed
    // to the active session unless the caller explicitly requested
    // another. Falls back to NULL legacy rows when no session exists.
    const sessionFilter = await this.sessions.resolveReadFilter(
      schoolId,
      sessionId,
    );

    const records = await this.prisma.attendance.findMany({
      where: {
        date,
        studentId: { in: students.map((s) => s.id) },
        ...sessionFilter,
      },
      select: { studentId: true, status: true },
    });

    const statusByStudent = new Map(
      records.map((r) => [r.studentId, r.status]),
    );

    return {
      students: students.map((s) => ({
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        status: statusByStudent.get(s.id) ?? null,
      })),
      version,
    };
  }

  /**
   * Bulk upsert attendance records. Per (studentId, date) the unique index
   * guarantees one row — conflicts update, absences create.
   *
   * Optimistic concurrency: when `lastKnownVersion` is provided (sent
   * by the offline sync engine via the `X-Last-Known-Version` header),
   * we compare it against `max(student.updatedAt)` for the affected
   * students. If anything has been edited since the client's snapshot
   * (a student joined / left / was renamed), we throw 409 so the
   * client can flag the queue item as a conflict instead of silently
   * applying potentially-stale marks.
   */
  async mark(
    dto: MarkAttendanceDto,
    schoolId: string,
    lastKnownVersion?: string,
    deviceId?: string,
    /**
     * Actor context — passed by the controller so the bulk-overwrite
     * audit row can record who triggered the mass mark. Optional
     * because legacy callers (offline-replay, etc.) may not have it;
     * the audit emit is gated on `actor != null` so missing context
     * silently skips the audit rather than crashing.
     */
    actor?: {
      userId: string;
      email?: string | null;
      role?: string | null;
      ip?: string | null;
      userAgent?: string | null;
    },
  ): Promise<{ marked: number; date: string }> {
    const date = parseDate(dto.date);
    const studentIds = [...new Set(dto.entries.map((e) => e.studentId))];

    if (studentIds.length !== dto.entries.length) {
      throw new BadRequestException(
        'Duplicate studentId entries in the request.',
      );
    }

    // Verify every student in the request belongs to the caller's
    // school AND, when the caller supplied a version stamp, gather
    // their current `updatedAt` for the conflict check below.
    const owners = await this.prisma.student.findMany({
      where: { id: { in: studentIds }, schoolId },
      select: { id: true, updatedAt: true },
    });
    if (owners.length !== studentIds.length) {
      throw new BadRequestException(
        'One or more students do not belong to this school.',
      );
    }

    // Optimistic-concurrency guard. Skip when the caller didn't send a
    // version (online flows that haven't read a roster yet) or when
    // the parsed version is malformed (treat as not-supplied — better
    // to allow the write than reject on a header parse error).
    if (lastKnownVersion) {
      const lastKnownMs = Date.parse(lastKnownVersion);
      if (!Number.isNaN(lastKnownMs)) {
        let currentVersionMs = 0;
        for (const o of owners) {
          const ms = o.updatedAt.getTime();
          if (ms > currentVersionMs) currentVersionMs = ms;
        }
        if (currentVersionMs > lastKnownMs) {
          throw new ConflictException(
            'Roster changed since you went offline. Review and re-mark.',
          );
        }
      }
    }

    // STRICT — every new attendance row must belong to the active
    // session AND the active session must not be locked. Throws:
    //   • "No active academic session"          → none set up yet
    //   • "Active session is locked. …"         → admin froze the year
    // Inserts only — the update path leaves sessionId alone so
    // re-marking a stale day never accidentally moves it forward.
    const sessionId = await this.sessions.requireActiveUnlocked(schoolId);

    const results = await this.prisma.$transaction(
      dto.entries.map((e) =>
        this.prisma.attendance.upsert({
          where: { studentId_date: { studentId: e.studentId, date } },
          create: {
            studentId: e.studentId,
            date,
            status: e.status,
            schoolId,
            sessionId,
          },
          update: { status: e.status },
          select: { id: true },
        }),
      ),
    );

    // Audit log — surfaces the originating device so multi-device
    // edits to the same roster can be triaged from the server log
    // alone. Falls back to "(unknown)" when the client didn't send
    // a header (older builds, direct API calls from curl, etc.).
    this.logger.log(
      `[mark] ${results.length} record(s) on ${dto.date} from ${
        deviceId ? `Device-${deviceId.replace(/-/g, '').slice(0, 8)}` : '(unknown)'
      } · schoolId=${schoolId}`,
    );

    // ATTENDANCE_BULK_OVERWRITE — fires whenever a single mark()
    // call writes ATTENDANCE_BULK_THRESHOLD or more rows. Single
    // toggles stay below the line and DON'T audit (would drown
    // the platform stream). Best-effort: a failed audit emit
    // never rolls back the attendance write itself.
    if (actor && results.length >= ATTENDANCE_BULK_THRESHOLD) {
      void this.audit
        .record({
          action: PlatformAuditAction.ATTENDANCE_BULK_OVERWRITE,
          // Tenant scope — surfaces on the school-side audit feed
          // even when an admin from a parent platform context
          // triggers it.
          schoolId,
          actor: {
            userId: actor.userId,
            email: actor.email,
            role: actor.role,
          },
          target: {
            type: 'Attendance',
            // No single attendance row to point at — use the date
            // string as the stable per-day identifier so the
            // audit timeline shows one row per day.
            id: dto.date,
            label: `Attendance ${dto.date}`,
          },
          before: null,
          after: {
            date: dto.date,
            entryCount: results.length,
            // Mode is informational — most bulk writes are all-
            // present or all-absent, but a heterogeneous bulk is
            // legal too (e.g., "mark all then individually
            // toggle a few absent before saving").
            allSameStatus: areAllSameStatus(dto.entries),
          },
          ip: actor.ip,
          userAgent: actor.userAgent,
        })
        .catch((err) => {
          this.logger.error(
            `[audit] ATTENDANCE_BULK_OVERWRITE failed for ${dto.date}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    return { marked: results.length, date: dto.date };
  }

  /**
   * Attendance report for a date range.
   * - `studentId` alone → single-student summary.
   * - `sectionId` alone → per-student breakdown + aggregate for the section.
   * - Both → same as `studentId` (narrower scope wins).
   * - Neither → 400.
   */
  async getReport(
    query: ReportQueryDto,
    schoolId: string,
    sessionId?: string,
  ): Promise<AttendanceReport> {
    const from = parseDate(query.fromDate);
    const to = parseDate(query.toDate);
    if (to < from) {
      throw new BadRequestException('toDate must be on or after fromDate.');
    }

    // Resolve the session filter ONCE and pass to whichever private
    // does the heavy lifting — they all run the same attendance
    // query shape under the hood.
    const sessionFilter = await this.sessions.resolveReadFilter(
      schoolId,
      sessionId,
    );

    if (query.studentId) {
      return this.getStudentReport(
        query.studentId,
        from,
        to,
        query.fromDate,
        query.toDate,
        schoolId,
        sessionFilter,
      );
    }

    if (query.sectionId) {
      return this.getSectionReport(
        query.sectionId,
        from,
        to,
        query.fromDate,
        query.toDate,
        schoolId,
        sessionFilter,
      );
    }

    if (query.classId) {
      return this.getClassReport(
        query.classId,
        from,
        to,
        query.fromDate,
        query.toDate,
        schoolId,
        sessionFilter,
      );
    }

    throw new BadRequestException(
      'Provide one of `studentId`, `sectionId`, or `classId`.',
    );
  }

  private async getStudentReport(
    studentId: string,
    from: Date,
    to: Date,
    fromIso: string,
    toIso: string,
    schoolId: string,
    sessionFilter: { sessionId: string | null },
  ): Promise<StudentAttendanceReport> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, schoolId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        symbolNumber: true,
        section: {
          select: { name: true, class: { select: { name: true } } },
        },
      },
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }

    const grouped = await this.prisma.attendance.groupBy({
      by: ['status'],
      where: {
        studentId,
        date: { gte: from, lte: to },
        ...sessionFilter,
      },
      _count: { _all: true },
    });
    const present = countFor(grouped, AttendanceStatus.PRESENT);
    const absent = countFor(grouped, AttendanceStatus.ABSENT);
    const summary = summarize(present, absent);

    return {
      scope: 'student',
      fromDate: fromIso,
      toDate: toIso,
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        symbolNumber: student.symbolNumber,
        section: student.section
          ? {
              name: student.section.name,
              className: student.section.class.name,
            }
          : null,
      },
      ...summary,
    };
  }

  private async getSectionReport(
    sectionId: string,
    from: Date,
    to: Date,
    fromIso: string,
    toIso: string,
    schoolId: string,
    sessionFilter: { sessionId: string | null },
  ): Promise<SectionAttendanceReport> {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, class: { schoolId } },
      select: {
        id: true,
        name: true,
        class: { select: { name: true } },
      },
    });
    if (!section) {
      throw new NotFoundException('Section not found.');
    }

    const students = await this.prisma.student.findMany({
      where: { sectionId },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        symbolNumber: true,
      },
    });

    if (students.length === 0) {
      return {
        scope: 'section',
        fromDate: fromIso,
        toDate: toIso,
        section: {
          id: section.id,
          name: section.name,
          className: section.class.name,
        },
        students: [],
        lowAttendanceCount: 0,
        ...summarize(0, 0),
      };
    }

    const records = await this.prisma.attendance.findMany({
      where: {
        studentId: { in: students.map((s) => s.id) },
        date: { gte: from, lte: to },
        ...sessionFilter,
      },
      select: { studentId: true, status: true },
    });

    const agg = new Map<string, { present: number; absent: number }>();
    for (const r of records) {
      const cur = agg.get(r.studentId) ?? { present: 0, absent: 0 };
      if (r.status === AttendanceStatus.PRESENT) cur.present++;
      else cur.absent++;
      agg.set(r.studentId, cur);
    }

    let totalPresent = 0;
    let totalAbsent = 0;
    const studentRows: StudentReportRow[] = students.map((s) => {
      const a = agg.get(s.id) ?? { present: 0, absent: 0 };
      totalPresent += a.present;
      totalAbsent += a.absent;
      return {
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        symbolNumber: s.symbolNumber,
        ...summarize(a.present, a.absent),
      };
    });

    // Sort worst-first by default so at-risk students surface immediately.
    // Null percentages (no data) fall to the end so they don't outrank
    // students with an actually-bad record.
    sortByPercentageAsc(studentRows);
    const lowAttendanceCount = countBelowThreshold(studentRows);

    return {
      scope: 'section',
      fromDate: fromIso,
      toDate: toIso,
      section: {
        id: section.id,
        name: section.name,
        className: section.class.name,
      },
      students: studentRows,
      lowAttendanceCount,
      ...summarize(totalPresent, totalAbsent),
    };
  }

  /**
   * Whole-class report — same shape as the section report, scoped to
   * students linked directly to the class (classId = X, sectionId IS
   * NULL). These are the students that the class-level roster covers.
   */
  private async getClassReport(
    classId: string,
    from: Date,
    to: Date,
    fromIso: string,
    toIso: string,
    schoolId: string,
    sessionFilter: { sessionId: string | null },
  ): Promise<ClassAttendanceReport> {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, schoolId },
      select: { id: true, name: true },
    });
    if (!klass) {
      throw new NotFoundException('Class not found.');
    }

    const students = await this.prisma.student.findMany({
      where: { classId, sectionId: null },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        symbolNumber: true,
      },
    });

    if (students.length === 0) {
      return {
        scope: 'class',
        fromDate: fromIso,
        toDate: toIso,
        class: { id: klass.id, name: klass.name },
        students: [],
        lowAttendanceCount: 0,
        ...summarize(0, 0),
      };
    }

    const records = await this.prisma.attendance.findMany({
      where: {
        studentId: { in: students.map((s) => s.id) },
        date: { gte: from, lte: to },
        ...sessionFilter,
      },
      select: { studentId: true, status: true },
    });

    const agg = new Map<string, { present: number; absent: number }>();
    for (const r of records) {
      const cur = agg.get(r.studentId) ?? { present: 0, absent: 0 };
      if (r.status === AttendanceStatus.PRESENT) cur.present++;
      else cur.absent++;
      agg.set(r.studentId, cur);
    }

    let totalPresent = 0;
    let totalAbsent = 0;
    const studentRows: StudentReportRow[] = students.map((s) => {
      const a = agg.get(s.id) ?? { present: 0, absent: 0 };
      totalPresent += a.present;
      totalAbsent += a.absent;
      return {
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        symbolNumber: s.symbolNumber,
        ...summarize(a.present, a.absent),
      };
    });

    // Worst-first by default so admins see at-risk students at the top.
    sortByPercentageAsc(studentRows);
    const lowAttendanceCount = countBelowThreshold(studentRows);

    return {
      scope: 'class',
      fromDate: fromIso,
      toDate: toIso,
      class: { id: klass.id, name: klass.name },
      students: studentRows,
      lowAttendanceCount,
      ...summarize(totalPresent, totalAbsent),
    };
  }

  /**
   * Daily attendance series for a date range. Powers the dashboard
   * charts:
   *   • Admin (no scope)  — school-wide trend.
   *   • Class / section   — narrowed to that roster.
   *
   * Buckets only include days with at least one recorded mark. Days
   * with no data (weekends, holidays, mark-not-taken) are dropped
   * from the series so the chart shows real signal — adding zero-
   * day buckets would make the line collapse repeatedly. The chart
   * connects across gaps; client decides whether to show that as a
   * dotted segment or just continuous.
   */
  async getTrend(
    query: { fromDate: string; toDate: string; sectionId?: string; classId?: string },
    schoolId: string,
    sessionId?: string,
  ): Promise<AttendanceTrend> {
    // Resolve scope. Empty scope → school-wide aggregate.
    let studentWhere: Prisma.StudentWhereInput = { schoolId };
    let scopeLabel = 'School';
    if (query.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: query.sectionId, class: { schoolId } },
        select: {
          id: true,
          name: true,
          class: { select: { name: true } },
        },
      });
      if (!section) {
        throw new NotFoundException('Section not found.');
      }
      studentWhere = { ...studentWhere, sectionId: query.sectionId };
      scopeLabel = `${section.class.name} · ${section.name}`;
    } else if (query.classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: query.classId, schoolId },
        select: { id: true, name: true },
      });
      if (!klass) {
        throw new NotFoundException('Class not found.');
      }
      // Whole-class trend covers BOTH directly-linked and sectioned
      // students under the class — same shape as the class ledger
      // so the chart matches the report numbers.
      studentWhere = {
        ...studentWhere,
        OR: [
          { classId: query.classId, sectionId: null },
          { section: { classId: query.classId } },
        ],
      };
      scopeLabel = klass.name;
    }

    const students = await this.prisma.student.findMany({
      where: studentWhere,
      select: { id: true },
    });

    if (students.length === 0) {
      return {
        fromDate: query.fromDate,
        toDate: query.toDate,
        scopeLabel,
        daily: [],
        totals: {
          totalDays: 0,
          presentDays: 0,
          absentDays: 0,
          percentage: null,
        },
      };
    }

    const fromDate = parseDate(query.fromDate);
    const toDate = parseDate(query.toDate);
    const sessionFilter = await this.sessions.resolveReadFilter(
      schoolId,
      sessionId,
    );

    const records = await this.prisma.attendance.findMany({
      where: {
        studentId: { in: students.map((s) => s.id) },
        date: { gte: fromDate, lte: toDate },
        ...sessionFilter,
      },
      select: { date: true, status: true },
    });

    // Bucket by ISO date. Map insertion order doesn't matter — we
    // sort at the end.
    const byDate = new Map<string, { present: number; absent: number }>();
    for (const r of records) {
      const key = r.date.toISOString().slice(0, 10);
      const bucket = byDate.get(key) ?? { present: 0, absent: 0 };
      if (r.status === AttendanceStatus.PRESENT) bucket.present += 1;
      else bucket.absent += 1;
      byDate.set(key, bucket);
    }

    const daily: TrendDayBucket[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, c]) => {
        const total = c.present + c.absent;
        return {
          date,
          presentCount: c.present,
          absentCount: c.absent,
          totalCount: total,
          percentage: total > 0 ? round1((c.present / total) * 100) : null,
        };
      });

    let presentDays = 0;
    let absentDays = 0;
    for (const d of daily) {
      presentDays += d.presentCount;
      absentDays += d.absentCount;
    }
    const totalDays = presentDays + absentDays;

    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      scopeLabel,
      daily,
      totals: {
        presentDays,
        absentDays,
        totalDays,
        percentage: totalDays > 0 ? round1((presentDays / totalDays) * 100) : null,
      },
    };
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function countFor(
  rows: Array<{ status: AttendanceStatus; _count: { _all: number } }>,
  status: AttendanceStatus,
): number {
  return rows.find((r) => r.status === status)?._count._all ?? 0;
}

function summarize(present: number, absent: number): ReportSummary {
  const total = present + absent;
  return {
    totalDays: total,
    presentDays: present,
    absentDays: absent,
    percentage: total === 0 ? null : round((present / total) * 100, 2),
  };
}

function round(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

/**
 * Sort student rows in-place: worst attendance first. Null percentages
 * (no data recorded) sink to the end so they don't leapfrog students
 * with an actual bad record.
 */
function sortByPercentageAsc(rows: StudentReportRow[]): void {
  rows.sort((a, b) => {
    const pa = a.percentage ?? Number.POSITIVE_INFINITY;
    const pb = b.percentage ?? Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

/**
 * Count students whose attendance is strictly below the at-risk threshold.
 * Nulls (no recorded attendance) aren't counted — they represent "unknown",
 * not "bad".
 */
function countBelowThreshold(rows: StudentReportRow[]): number {
  return rows.filter(
    (r) => r.percentage !== null && r.percentage < LOW_ATTENDANCE_THRESHOLD,
  ).length;
}

/**
 * Convert a YYYY-MM-DD string to a UTC-midnight Date. Using UTC avoids
 * timezone drift — the DB stores a DATE column so only the y/m/d matter.
 */
function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Roster version derivation. Returns max(updatedAt) across the queried
 * students as an ISO string — clients use it to detect drift between
 * a cached snapshot and the live roster. Empty roster → unix epoch
 * (lexicographically smaller than any real timestamp), so a freshly-
 * empty class compares cleanly against later snapshots that have
 * students.
 */
function computeRosterVersion(
  students: ReadonlyArray<{ updatedAt: Date }>,
): string {
  if (students.length === 0) return new Date(0).toISOString();
  let latest = students[0].updatedAt;
  for (const s of students) {
    if (s.updatedAt > latest) latest = s.updatedAt;
  }
  return latest.toISOString();
}

/**
 * Tiny helper — returns true when every entry in the bulk write
 * carries the same status (pure mark-all-present / mark-all-absent).
 * Recorded on the audit row so the operator can tell at a glance
 * whether a 30-row write was uniform or a heterogeneous bulk.
 */
function areAllSameStatus(
  entries: ReadonlyArray<{ status: AttendanceStatus }>,
): boolean {
  if (entries.length <= 1) return true;
  const first = entries[0].status;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].status !== first) return false;
  }
  return true;
}

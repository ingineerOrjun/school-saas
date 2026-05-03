import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import { AcademicSessionService } from '../academic-session/academic-session.service';
import { PrismaService } from '../database/prisma.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';
import { ReportQueryDto } from './dto/report-query.dto';

export interface AttendanceRoster {
  studentId: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus | null;
}

export interface ReportSummary {
  totalDays: number;
  presentDays: number;
  absentDays: number;
  /** Null when `totalDays` is 0 (no data to compute over). */
  percentage: number | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AcademicSessionService,
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
  ): Promise<AttendanceRoster[]> {
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
      select: { id: true, firstName: true, lastName: true },
    });

    if (students.length === 0) return [];

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

    return students.map((s) => ({
      studentId: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      status: statusByStudent.get(s.id) ?? null,
    }));
  }

  /**
   * Bulk upsert attendance records. Per (studentId, date) the unique index
   * guarantees one row — conflicts update, absences create.
   */
  async mark(
    dto: MarkAttendanceDto,
    schoolId: string,
  ): Promise<{ marked: number; date: string }> {
    const date = parseDate(dto.date);
    const studentIds = [...new Set(dto.entries.map((e) => e.studentId))];

    if (studentIds.length !== dto.entries.length) {
      throw new BadRequestException(
        'Duplicate studentId entries in the request.',
      );
    }

    // Verify every student in the request belongs to the caller's school.
    const owned = await this.prisma.student.count({
      where: { id: { in: studentIds }, schoolId },
    });
    if (owned !== studentIds.length) {
      throw new BadRequestException(
        'One or more students do not belong to this school.',
      );
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

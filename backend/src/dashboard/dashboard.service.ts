import { Injectable } from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { PrismaService } from '../database/prisma.service';

/** One row in the "Recent enrollments" card on the dashboard. */
export interface DashboardRecentStudent {
  id: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
  className: string | null;
  sectionName: string | null;
  /** Derived from /fees/dues: 'Paid' | 'Pending' | 'Overdue'. */
  feeStatus: 'Paid' | 'Pending' | 'Overdue';
  createdAt: string;
}

export interface DashboardSummary {
  school: { id: string; name: string; slug: string } | null;

  stats: {
    totalStudents: number;
    totalTeachers: number;
    totalClasses: number;
    /** 0–100. 0 when no attendance has been marked today. */
    attendanceTodayPct: number;
    /** How many students had attendance recorded today (either status). */
    attendanceMarkedToday: number;
    /** Roster size used to normalize the % (sum across sections + whole-class rosters). */
    attendanceTotalToday: number;
    /** Sum of every recorded payment amount, ever. */
    feesCollected: number;
    /** Sum of outstanding dues across all students. */
    feesOutstanding: number;
    /**
     * School-wide General Credit pool — the RAW sum of unlinked payment
     * amounts (feeAssignmentId IS NULL). This is the single source of
     * truth for "available credit"; never derived from assignment math.
     */
    totalCredit: number;

    // Deltas are reserved for when we start tracking historical baselines.
    studentsDelta: number;
    teachersDelta: number;
    attendanceDelta: number;
    feesDelta: number;
  };

  recentStudents: DashboardRecentStudent[];

  onboarding: {
    hasStudents: boolean;
    hasTeachers: boolean;
    hasClasses: boolean;
  };

  generatedAt: string;
}

/** Matches the shape of /fees/dues so we can classify each student. */
type DuesRow = {
  studentId: string;
  totalAssigned: number;
  totalPaid: number;
  totalDue: number;
  overdue: boolean;
};

// ---------------------------------------------------------------------------
// Teacher dashboard payload
// ---------------------------------------------------------------------------

export interface TeacherDashboardStudent {
  id: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
  /** Today's attendance status — null if nothing recorded yet. */
  todayStatus: AttendanceStatus | null;
}

/** One row in the teacher's "Exams pending" list. */
export interface TeacherDashboardPendingExam {
  id: string;
  name: string;
  /** When the exam was created — used to nudge teachers to act on stale exams. */
  createdAt: string;
}

/**
 * One assignment row in the dashboard payload. Each row pairs a class
 * (with optional section + subject) and the count of students in scope
 * for that row — so the UI can render a per-class breakdown card.
 */
export interface TeacherDashboardAssignment {
  id: string;
  classId: string;
  className: string;
  sectionId: string | null;
  sectionName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  /** Students covered by this specific assignment. */
  studentCount: number;
  /**
   * Querystring (without leading "?") that pre-fills the attendance
   * page for this row — `sectionId=X` if section-bound, otherwise
   * `classId=X`. The frontend just appends it to /attendance.
   */
  attendanceQuery: string;
}

export interface TeacherDashboardSummary {
  school: { id: string; name: string; slug: string } | null;

  teacher: {
    name: string;
    /** True when no assignments exist — UI shows the "ask admin" state. */
    isUnassigned: boolean;
    /** All (class × section? × subject?) tuples this teacher owns. */
    assignments: TeacherDashboardAssignment[];
    /**
     * The "primary" assignment used by the hero CTA. First row when set;
     * null when the teacher has no assignments.
     */
    primaryAssignment: TeacherDashboardAssignment | null;
  };

  /** Today's attendance snapshot for the teacher's roster. */
  today: {
    /** ISO date (YYYY-MM-DD) used for the snapshot. */
    date: string;
    studentsInScope: number;
    studentsMarked: number;
    presentCount: number;
    absentCount: number;
    /** 0–100 across the marked subset. Null when nothing marked yet. */
    attendancePct: number | null;
    /** Convenience flag — true when at least one student has been marked. */
    attendanceMarked: boolean;
  };

  /** Aggregate attendance % over the trailing 30 days. */
  classAttendance30d: {
    fromDate: string;
    toDate: string;
    presentDays: number;
    absentDays: number;
    totalDays: number;
    /** 0–100. Null when no attendance recorded in the window. */
    percentage: number | null;
  };

  /** Outstanding work surfaced as a punch list. */
  pending: {
    /** True when nobody in the roster has been marked today yet. */
    attendanceNotMarkedToday: boolean;
    /** Exams in the school with NO results yet for this teacher's roster. */
    examsWithoutResults: TeacherDashboardPendingExam[];
  };

  /** Roster (capped at 10). The frontend links out for the full list. */
  students: TeacherDashboardStudent[];
  /** Total students in scope (for the "+N more" counter). */
  studentsTotal: number;

  generatedAt: string;
}

const TEACHER_DASHBOARD_ROSTER_LIMIT = 10;
const TEACHER_DASHBOARD_PENDING_EXAMS_LIMIT = 5;
const TEACHER_DASHBOARD_WINDOW_DAYS = 30;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate every dashboard metric for a single tenant into one payload.
   * Runs all independent queries in parallel so the p50 response stays
   * close to the slowest single query, not the sum.
   */
  async getSummary(schoolId: string): Promise<DashboardSummary> {
    const today = startOfDayUTC(new Date());

    const [
      school,
      totalStudents,
      totalTeachers,
      totalClasses,
      attendanceCounts,
      feesCollected,
      feesOutstanding,
      totalCredit,
      recentRows,
      duesRows,
    ] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.student.count({ where: { schoolId } }),
      this.prisma.teacher.count({ where: { schoolId } }),
      this.prisma.class.count({ where: { schoolId } }),
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: { schoolId, date: today },
        _count: { _all: true },
      }),
      this.prisma.payment
        .aggregate({
          where: { schoolId },
          _sum: { amount: true },
        })
        .then((r) => toNumber(r._sum?.amount)),
      // Outstanding = total assigned − total collected. Cheaper than
      // fanning out per-student, and the dashboard only needs the rollup.
      Promise.all([
        this.prisma.feeAssignment
          .aggregate({
            where: { schoolId },
            _sum: { amount: true },
          })
          .then((r) => toNumber(r._sum?.amount)),
        this.prisma.payment
          .aggregate({
            where: { schoolId },
            _sum: { amount: true },
          })
          .then((r) => toNumber(r._sum?.amount)),
      ]).then(([assigned, collected]) => Math.max(0, assigned - collected)),
      // totalCredit — the RAW sum of unlinked payments. Single source
      // of truth for credit across the whole school. Never derived from
      // assignment math.
      this.prisma.payment
        .aggregate({
          where: { schoolId, feeAssignmentId: null },
          _sum: { amount: true },
        })
        .then((r) => toNumber(r._sum?.amount)),
      this.prisma.student.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          symbolNumber: true,
          createdAt: true,
          class: { select: { name: true } },
          section: {
            select: { name: true, class: { select: { name: true } } },
          },
        },
      }),
      // For fee status badges on the recent-enrollments list. We pull
      // dues for just the 5 most recent students to keep this cheap.
      this.fetchDuesForRecentStudents(schoolId),
    ]);

    const presentToday = countFor(attendanceCounts, AttendanceStatus.PRESENT);
    const absentToday = countFor(attendanceCounts, AttendanceStatus.ABSENT);
    const totalMarked = presentToday + absentToday;
    const attendanceTodayPct =
      totalMarked > 0 ? (presentToday / totalMarked) * 100 : 0;

    const duesByStudent = new Map(duesRows.map((d) => [d.studentId, d]));
    const recentStudents: DashboardRecentStudent[] = recentRows.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      symbolNumber: s.symbolNumber,
      className: s.class?.name ?? s.section?.class?.name ?? null,
      sectionName: s.section?.name ?? null,
      feeStatus: classifyFee(duesByStudent.get(s.id)),
      createdAt: s.createdAt.toISOString(),
    }));

    return {
      school: school ?? null,
      stats: {
        totalStudents,
        totalTeachers,
        totalClasses,
        attendanceTodayPct,
        attendanceMarkedToday: totalMarked,
        attendanceTotalToday: totalStudents,
        feesCollected,
        feesOutstanding,
        totalCredit,
        studentsDelta: 0,
        teachersDelta: 0,
        attendanceDelta: 0,
        feesDelta: 0,
      },
      recentStudents,
      onboarding: {
        hasStudents: totalStudents > 0,
        hasTeachers: totalTeachers > 0,
        hasClasses: totalClasses > 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Teacher dashboard payload — aggregates across ALL assignments the
   * teacher owns. Returns enough to render:
   *   • Header card: list of assigned classes/subjects
   *   • "Take attendance" CTA targeting the primary assignment
   *   • Pending tasks (attendance not marked, exams without results)
   *   • Roster (capped) — union of students across every assignment
   *   • 30-day class attendance % across the union
   *
   * Caller MUST be a TEACHER. We resolve the teacher row via the
   * userId↔Teacher link, then walk TeachingAssignment rows.
   */
  async getTeacherSummary(
    user: AuthenticatedUser,
  ): Promise<TeacherDashboardSummary> {
    const today = startOfDayUTC(new Date());
    const todayIso = toIsoDate(today);

    // Resolve the teacher row + every assignment with the related class,
    // section, and subject names. One round-trip via include is cheaper
    // than per-assignment lookups.
    const [school, teacher] = await Promise.all([
      this.prisma.school.findUnique({
        where: { id: user.schoolId },
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.teacher.findFirst({
        where: { userId: user.id, schoolId: user.schoolId },
        select: {
          name: true,
          assignments: {
            // Stable order so the "primary" assignment is deterministic.
            orderBy: [{ createdAt: 'asc' }],
            select: {
              id: true,
              classId: true,
              sectionId: true,
              subjectId: true,
              class: { select: { id: true, name: true } },
              section: { select: { id: true, name: true } },
              subject: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    const teacherName = teacher?.name ?? 'Teacher';
    const rawAssignments = teacher?.assignments ?? [];
    const isUnassigned = rawAssignments.length === 0;

    // Unassigned teacher: short-circuit with empty/zero data so the UI
    // can render the "ask admin to assign you a class" state cleanly
    // without blowing N more queries to compute zeros.
    if (isUnassigned) {
      const fromDate = addDaysUTC(today, -(TEACHER_DASHBOARD_WINDOW_DAYS - 1));
      return {
        school: school ?? null,
        teacher: {
          name: teacherName,
          isUnassigned: true,
          assignments: [],
          primaryAssignment: null,
        },
        today: {
          date: todayIso,
          studentsInScope: 0,
          studentsMarked: 0,
          presentCount: 0,
          absentCount: 0,
          attendancePct: null,
          attendanceMarked: false,
        },
        classAttendance30d: {
          fromDate: toIsoDate(fromDate),
          toDate: todayIso,
          presentDays: 0,
          absentDays: 0,
          totalDays: 0,
          percentage: null,
        },
        pending: {
          attendanceNotMarkedToday: false,
          examsWithoutResults: [],
        },
        students: [],
        studentsTotal: 0,
        generatedAt: new Date().toISOString(),
      };
    }

    // ----- Roster scope (union across every assignment) -----
    // Build an OR clause that mirrors TeacherScopeService.assertStudentsInScope:
    //   • section-bound row → student must be in that exact section
    //   • class-bound row   → direct (classId, sectionId=null) OR any
    //                         section under that class
    const orClauses: Prisma.StudentWhereInput[] = rawAssignments.map((a) =>
      a.sectionId
        ? { sectionId: a.sectionId }
        : {
            OR: [
              { classId: a.classId, sectionId: null },
              { section: { classId: a.classId } },
            ],
          },
    );
    const studentWhere: Prisma.StudentWhereInput = {
      schoolId: user.schoolId,
      OR: orClauses,
    };

    const [studentsTotal, rosterRows] = await Promise.all([
      this.prisma.student.count({ where: studentWhere }),
      this.prisma.student.findMany({
        where: studentWhere,
        orderBy: [
          { symbolNumber: 'asc' },
          { firstName: 'asc' },
          { lastName: 'asc' },
        ],
        take: TEACHER_DASHBOARD_ROSTER_LIMIT,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          symbolNumber: true,
        },
      }),
    ]);

    const rosterIds = rosterRows.map((s) => s.id);

    // ----- Attendance: today + 30-day window + every-student-in-scope check -----
    const fromDate = addDaysUTC(today, -(TEACHER_DASHBOARD_WINDOW_DAYS - 1));

    // For "all students in scope" pull every studentId so the today/30-day
    // aggregations cover the WHOLE roster, not just the 10 visible rows.
    const allInScope = await this.prisma.student.findMany({
      where: studentWhere,
      select: { id: true },
    });
    const allInScopeIds = allInScope.map((s) => s.id);

    const [todayRecords, todayGrouped, windowGrouped] =
      allInScopeIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            // Per-student status for the visible roster only — used to
            // badge each row in the table.
            rosterIds.length > 0
              ? this.prisma.attendance.findMany({
                  where: { studentId: { in: rosterIds }, date: today },
                  select: { studentId: true, status: true },
                })
              : Promise.resolve(
                  [] as { studentId: string; status: AttendanceStatus }[],
                ),
            // School-wide rollup for today across the whole scope.
            this.prisma.attendance.groupBy({
              by: ['status'],
              where: {
                studentId: { in: allInScopeIds },
                date: today,
              },
              _count: { _all: true },
            }),
            // 30-day aggregate (used for the class % card).
            this.prisma.attendance.groupBy({
              by: ['status'],
              where: {
                studentId: { in: allInScopeIds },
                date: { gte: fromDate, lte: today },
              },
              _count: { _all: true },
            }),
          ]);

    const presentToday = countFor(todayGrouped, AttendanceStatus.PRESENT);
    const absentToday = countFor(todayGrouped, AttendanceStatus.ABSENT);
    const studentsMarkedToday = presentToday + absentToday;

    const presentWindow = countFor(windowGrouped, AttendanceStatus.PRESENT);
    const absentWindow = countFor(windowGrouped, AttendanceStatus.ABSENT);
    const totalWindow = presentWindow + absentWindow;

    const todayStatusByStudent = new Map<string, AttendanceStatus>(
      todayRecords.map((r) => [r.studentId, r.status]),
    );

    const students: TeacherDashboardStudent[] = rosterRows.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      symbolNumber: s.symbolNumber,
      todayStatus: todayStatusByStudent.get(s.id) ?? null,
    }));

    // ----- Pending exams -----
    // An exam is "pending" when no Result row exists yet for ANY student
    // in this teacher's roster. We pull the exams + their result counts
    // in one round-trip, then filter to zero-coverage.
    let examsWithoutResults: TeacherDashboardPendingExam[] = [];
    if (allInScopeIds.length > 0) {
      const exams = await this.prisma.exam.findMany({
        where: { schoolId: user.schoolId },
        select: {
          id: true,
          name: true,
          createdAt: true,
          results: {
            where: { studentId: { in: allInScopeIds } },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      examsWithoutResults = exams
        .filter((e) => e.results.length === 0)
        .slice(0, TEACHER_DASHBOARD_PENDING_EXAMS_LIMIT)
        .map((e) => ({
          id: e.id,
          name: e.name,
          createdAt: e.createdAt.toISOString(),
        }));
    }

    // ----- Per-assignment student counts -----
    // For each assignment, count students that match its OWN scope
    // (not the union). These power the "Your assignments" card on the
    // dashboard. We pull them in parallel so the wall time stays close
    // to the slowest single count.
    const perAssignmentCounts = await Promise.all(
      rawAssignments.map((a) =>
        this.prisma.student.count({
          where: {
            schoolId: user.schoolId,
            ...(a.sectionId
              ? { sectionId: a.sectionId }
              : {
                  OR: [
                    { classId: a.classId, sectionId: null },
                    { section: { classId: a.classId } },
                  ],
                }),
          },
        }),
      ),
    );

    const assignments: TeacherDashboardAssignment[] = rawAssignments.map(
      (a, i) => ({
        id: a.id,
        classId: a.classId,
        className: a.class.name,
        sectionId: a.sectionId,
        sectionName: a.section?.name ?? null,
        subjectId: a.subjectId,
        subjectName: a.subject?.name ?? null,
        studentCount: perAssignmentCounts[i] ?? 0,
        // Section-bound rows pre-fill sectionId so the picker lands on
        // the exact section; class-bound rows pre-fill classId so the
        // picker lands on the whole-class roster.
        attendanceQuery: a.sectionId
          ? `sectionId=${a.sectionId}`
          : `classId=${a.classId}`,
      }),
    );

    return {
      school: school ?? null,
      teacher: {
        name: teacherName,
        isUnassigned: false,
        assignments,
        // First assignment by createdAt is the "primary" — the one the
        // hero CTA targets. Stable across reloads as long as the admin
        // doesn't delete the original row.
        primaryAssignment: assignments[0] ?? null,
      },
      today: {
        date: todayIso,
        studentsInScope: allInScopeIds.length,
        studentsMarked: studentsMarkedToday,
        presentCount: presentToday,
        absentCount: absentToday,
        attendancePct:
          studentsMarkedToday > 0
            ? round((presentToday / studentsMarkedToday) * 100, 1)
            : null,
        attendanceMarked: studentsMarkedToday > 0,
      },
      classAttendance30d: {
        fromDate: toIsoDate(fromDate),
        toDate: todayIso,
        presentDays: presentWindow,
        absentDays: absentWindow,
        totalDays: totalWindow,
        percentage:
          totalWindow > 0 ? round((presentWindow / totalWindow) * 100, 1) : null,
      },
      pending: {
        // Show as pending when nothing has been marked yet today —
        // partial marking still counts as "started".
        attendanceNotMarkedToday: studentsMarkedToday === 0,
        examsWithoutResults,
      },
      students,
      studentsTotal,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Fetch dues rows only for the 5 most-recent students. Keeps the
   * dashboard query cheap on large schools (no need to materialize dues
   * for every student just to badge five rows).
   */
  private async fetchDuesForRecentStudents(
    schoolId: string,
  ): Promise<DuesRow[]> {
    const recentIds = (
      await this.prisma.student.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true },
      })
    ).map((r) => r.id);
    if (recentIds.length === 0) return [];

    // Pull assignments and payments in parallel, then roll up per-student
    // in JS. Cheaper than a correlated subquery and easy to reason about.
    const [assignments, payments] = await Promise.all([
      this.prisma.feeAssignment.findMany({
        where: { studentId: { in: recentIds } },
        select: {
          studentId: true,
          amount: true,
          dueDate: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { studentId: { in: recentIds } },
        select: {
          studentId: true,
          amount: true,
        },
      }),
    ]);

    const today = startOfDayUTC(new Date());
    const byStudent = new Map<string, DuesRow>();
    for (const id of recentIds) {
      byStudent.set(id, {
        studentId: id,
        totalAssigned: 0,
        totalPaid: 0,
        totalDue: 0,
        overdue: false,
      });
    }
    for (const a of assignments) {
      const row = byStudent.get(a.studentId);
      if (!row) continue;
      row.totalAssigned += toNumber(a.amount);
      // overdue flag is set later, after we know paid vs. assigned.
      if (a.dueDate < today) row.overdue = true;
    }
    for (const p of payments) {
      const row = byStudent.get(p.studentId);
      if (!row) continue;
      row.totalPaid += toNumber(p.amount);
    }
    for (const row of byStudent.values()) {
      row.totalDue = Math.max(0, row.totalAssigned - row.totalPaid);
      // If there's no money still owed, the "overdue" flag is moot.
      if (row.totalDue === 0) row.overdue = false;
    }
    return Array.from(byStudent.values());
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countFor(
  grouped: { status: AttendanceStatus; _count: { _all: number } }[],
  status: AttendanceStatus,
): number {
  return grouped.find((g) => g.status === status)?._count._all ?? 0;
}

function classifyFee(row: DuesRow | undefined): 'Paid' | 'Pending' | 'Overdue' {
  if (!row || row.totalAssigned === 0) return 'Pending';
  if (row.totalDue === 0) return 'Paid';
  if (row.overdue) return 'Overdue';
  return 'Pending';
}

/**
 * Prisma's `_sum` returns a Decimal (which is a wrapped BigNumber) or
 * null. Normalize to a plain JS number for the JSON payload.
 */
function toNumber(v: Prisma.Decimal | number | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number(v);
}

/**
 * Produce the same UTC-midnight Date that the attendance service stores
 * when a user marks attendance. The frontend sends today's date derived
 * from LOCAL time (YYYY-MM-DD in the user's timezone), and the backend's
 * `parseDate` builds `YYYY-MM-DDT00:00:00.000Z` from it. To match that
 * here we must also start from local y/m/d — using UTC components would
 * be off by one day for any timezone ahead of UTC (e.g., Nepal UTC+5:45)
 * during the first hours of the local day.
 */
function startOfDayUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()),
  );
}

/** YYYY-MM-DD form of a UTC-midnight Date — what the frontend expects. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add (positive or negative) days to a UTC-midnight date. */
function addDaysUTC(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Round to N decimal places — same convention as the attendance service. */
function round(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}


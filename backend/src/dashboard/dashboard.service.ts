import { Injectable } from '@nestjs/common';
import { AttendanceStatus, Prisma } from '@prisma/client';
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

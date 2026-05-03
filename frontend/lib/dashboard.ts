import { api } from "./api";

/** One row in the dashboard's "Recent enrollments" card. */
export interface DashboardRecentStudent {
  id: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
  className: string | null;
  sectionName: string | null;
  feeStatus: "Paid" | "Pending" | "Overdue";
  createdAt: string;
}

export interface DashboardStats {
  totalStudents: number;
  totalTeachers: number;
  totalClasses: number;
  /** 0–100. 0 when no attendance has been marked today. */
  attendanceTodayPct: number;
  attendanceMarkedToday: number;
  attendanceTotalToday: number;
  feesCollected: number;
  feesOutstanding: number;
  /** School-wide General Credit pool (raw sum of unlinked payments). */
  totalCredit: number;
  studentsDelta: number;
  teachersDelta: number;
  attendanceDelta: number;
  feesDelta: number;
}

export interface DashboardSummary {
  school: { id: string; name: string; slug: string } | null;
  stats: DashboardStats;
  recentStudents: DashboardRecentStudent[];
  onboarding: {
    hasStudents: boolean;
    hasTeachers: boolean;
    hasClasses: boolean;
  };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Teacher dashboard
// ---------------------------------------------------------------------------

/** Roster row in the teacher dashboard table. */
export interface TeacherDashboardStudent {
  id: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
  /** Today's attendance status — null if nothing marked yet. */
  todayStatus: "PRESENT" | "ABSENT" | null;
}

export interface TeacherDashboardPendingExam {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * One assignment row in the teacher dashboard payload. Mirrors the
 * backend's `TeacherDashboardAssignment`. Used by the "Your assignments"
 * card and to build deep links into /attendance.
 */
export interface TeacherDashboardAssignment {
  id: string;
  classId: string;
  className: string;
  sectionId: string | null;
  sectionName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  studentCount: number;
  /** Querystring (no leading "?") — append to /attendance to deep-link. */
  attendanceQuery: string;
}

export interface TeacherDashboardSummary {
  school: { id: string; name: string; slug: string } | null;
  teacher: {
    name: string;
    isUnassigned: boolean;
    /** All (class × section? × subject?) tuples this teacher owns. */
    assignments: TeacherDashboardAssignment[];
    /** First assignment by createdAt — drives the hero CTA. */
    primaryAssignment: TeacherDashboardAssignment | null;
  };
  today: {
    date: string;
    studentsInScope: number;
    studentsMarked: number;
    presentCount: number;
    absentCount: number;
    /** 0–100. Null when nothing marked yet today. */
    attendancePct: number | null;
    attendanceMarked: boolean;
  };
  classAttendance30d: {
    fromDate: string;
    toDate: string;
    presentDays: number;
    absentDays: number;
    totalDays: number;
    /** 0–100. Null when no attendance recorded in the window. */
    percentage: number | null;
  };
  pending: {
    attendanceNotMarkedToday: boolean;
    examsWithoutResults: TeacherDashboardPendingExam[];
  };
  students: TeacherDashboardStudent[];
  studentsTotal: number;
  generatedAt: string;
}

export const dashboardApi = {
  /**
   * GET /dashboard/summary
   * School-wide aggregate consumed by the ADMIN dashboard.
   */
  getSummary: () => api<DashboardSummary>("/dashboard/summary"),

  /**
   * GET /dashboard/teacher-summary
   * Teacher-scoped: assigned class info, today's attendance, 30-day %,
   * pending tasks, capped roster. TEACHER role only on the backend.
   */
  getTeacherSummary: () =>
    api<TeacherDashboardSummary>("/dashboard/teacher-summary"),
};

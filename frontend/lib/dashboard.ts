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

export const dashboardApi = {
  /**
   * GET /dashboard/summary
   * Auth: required. The JWT is attached automatically by `api()`.
   * Returns the summary object directly (no `{ data: ... }` wrapper on
   * this backend — the payload IS the data).
   */
  getSummary: () => api<DashboardSummary>("/dashboard/summary"),
};

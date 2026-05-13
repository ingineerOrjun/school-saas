import { useQuery } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/useAuthReady";
import { api, isNetworkError } from "./api";
import { qk } from "./query-keys";
import { STALE } from "./query-client";

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

// ---------------------------------------------------------------------------
// useTeacherSummary — shared cache for the teacher-dashboard endpoint.
//
// Previously the TeacherDashboardView called `dashboardApi.getTeacherSummary()`
// directly inside a useEffect, which:
//   • Bypassed React Query's automatic in-flight dedupe — in dev,
//     React StrictMode double-fires every effect, producing TWO
//     identical /dashboard/teacher-summary requests 1ms apart.
//   • Couldn't share state with future consumers that need the same
//     data (other dashboard widgets, future re-render previews).
//   • Forced manual `loading` / `refreshing` / `error` / `data` state
//     scaffolding in every consumer.
//
// Migrating to this hook fixes all three:
//   • React Query dedupes by `queryKey` automatically. The StrictMode
//     double-mount becomes ONE request because the second mount sees
//     an in-flight query against the same key and joins it.
//   • Future consumers reuse the cache.
//   • The hook owns loading/refreshing/error.
//
// Refetch policy:
//   • `staleTime: STALE.LIVE_OPERATOR` (30s) — attendance counters
//     move during the day. 30s keeps the dashboard live-feeling
//     while still serving cache hits across rapid SPA navigation.
//   • `refetchOnWindowFocus: false` — the TeacherDashboardView wires
//     its own visibility-wake handler with a 2s cooldown that filters
//     spurious focus events (DevTools attach, OS notification steal,
//     etc.). The hook trusts that handler to call `.refetch()` when
//     appropriate.
//   • `refetchOnMount: false` — share cache across page navigation
//     within the 30s staleTime window.
//   • Auth errors (401/403) are NEVER retried.
//   • Otherwise one retry on transient failures.
// ---------------------------------------------------------------------------
export function useTeacherSummary(options?: { enabled?: boolean }) {
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery({
    queryKey: qk.dashboardTeacherSummary,
    queryFn: () => dashboardApi.getTeacherSummary(),
    enabled: (options?.enabled ?? true) && authReady && isAuthenticated,
    staleTime: STALE.LIVE_OPERATOR,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403) return false;
      return failureCount < 1;
    },
  });
}

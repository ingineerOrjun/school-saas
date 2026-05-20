import { useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { useAuthReady } from "@/hooks/useAuthReady";
import { qk } from "./query-keys";

export type AttendanceStatus = "PRESENT" | "ABSENT";

export interface AttendanceRoster {
  studentId: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus | null;
}

/**
 * Wrapper for `GET /attendance` — students plus a `version` string
 * the frontend cache uses to detect drift. Mirrors the backend's
 * `RosterResponse`.
 *
 * `version` is the ISO timestamp of the most recently-touched student
 * in the roster (max(student.updatedAt)). Empty rosters return the
 * unix epoch so string comparisons work uniformly.
 */
export interface RosterResponse {
  students: AttendanceRoster[];
  version: string;
}

export interface AttendanceEntry {
  studentId: string;
  status: AttendanceStatus;
}

export interface MarkAttendanceInput {
  date: string; // YYYY-MM-DD
  entries: AttendanceEntry[];
}

export interface ReportSummary {
  totalDays: number;
  presentDays: number;
  absentDays: number;
  /** Null when `totalDays` is 0. */
  percentage: number | null;
}

export interface StudentReportRow extends ReportSummary {
  studentId: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
}

export interface StudentAttendanceReport extends ReportSummary {
  scope: "student";
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
  scope: "section";
  fromDate: string;
  toDate: string;
  section: { id: string; name: string; className: string };
  students: StudentReportRow[];
  /** Students with percentage < 75% (excludes nulls / no-data rows). */
  lowAttendanceCount: number;
}

/** Whole-class attendance report (for classes without sections). */
export interface ClassAttendanceReport extends ReportSummary {
  scope: "class";
  fromDate: string;
  toDate: string;
  class: { id: string; name: string };
  students: StudentReportRow[];
  /** Students with percentage < 75% (excludes nulls / no-data rows). */
  lowAttendanceCount: number;
}

export type AttendanceReport =
  | StudentAttendanceReport
  | SectionAttendanceReport
  | ClassAttendanceReport;

/**
 * One bucket in an attendance trend series — the per-day breakdown
 * the dashboard charts plot. `percentage` is null on days with no
 * recorded marks (weekends, holidays) so the chart can show gaps
 * instead of a misleading 0%.
 */
export interface TrendDayBucket {
  date: string;
  presentCount: number;
  absentCount: number;
  totalCount: number;
  percentage: number | null;
}

export interface AttendanceTrend {
  fromDate: string;
  toDate: string;
  /** "School" for school-wide trends, otherwise the class/section name. */
  scopeLabel: string;
  daily: TrendDayBucket[];
  totals: ReportSummary;
}

export interface TrendQuery {
  fromDate: string;
  toDate: string;
  sectionId?: string;
  classId?: string;
}

export interface ReportQuery {
  fromDate: string;
  toDate: string;
  sectionId?: string;
  studentId?: string;
  classId?: string;
}

export interface RosterScope {
  /** Marking attendance for a specific section. */
  sectionId?: string;
  /**
   * Marking attendance for a whole class (no sections). The backend
   * returns students linked directly to the class with no section.
   */
  classId?: string;
}

export const attendanceApi = {
  /**
   * Roster for a date + scope. Backend strict-defaults to the
   * active session; pass `sessionId` to view a different year.
   */
  getRoster: (date: string, scope: RosterScope, sessionId?: string) => {
    const params = new URLSearchParams({ date });
    if (scope.sectionId) params.set("sectionId", scope.sectionId);
    else if (scope.classId) params.set("classId", scope.classId);
    if (sessionId) params.set("sessionId", sessionId);
    return api<RosterResponse>(`/attendance?${params.toString()}`);
  },
  mark: (input: MarkAttendanceInput) =>
    api<{ marked: number; date: string }>("/attendance/mark", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getReport: (q: ReportQuery, sessionId?: string) => {
    const params = new URLSearchParams({
      fromDate: q.fromDate,
      toDate: q.toDate,
    });
    if (q.sectionId) params.set("sectionId", q.sectionId);
    else if (q.classId) params.set("classId", q.classId);
    if (q.studentId) params.set("studentId", q.studentId);
    if (sessionId) params.set("sessionId", sessionId);
    return api<AttendanceReport>(`/attendance/report?${params.toString()}`);
  },
  /**
   * Daily attendance trend. School-wide (admin / staff) when neither
   * scope id is supplied; class- or section-scoped when one is. The
   * `redirectOn403: false` opt-out means a teacher hitting the
   * school-wide endpoint surfaces a graceful empty state instead of
   * being kicked to /login.
   */
  getTrend: (q: TrendQuery, sessionId?: string) => {
    const params = new URLSearchParams({
      fromDate: q.fromDate,
      toDate: q.toDate,
    });
    if (q.sectionId) params.set("sectionId", q.sectionId);
    else if (q.classId) params.set("classId", q.classId);
    if (sessionId) params.set("sessionId", sessionId);
    return api<AttendanceTrend>(`/attendance/trend?${params.toString()}`, {
      redirectOn403: false,
    });
  },
};

/**
 * Normalize a date string to the strict YYYY-MM-DD format the
 * `/attendance/report` DTO accepts (its `@Matches(/^\d{4}-\d{2}-\d{2}$/)`
 * validator rejects anything else with a 400).
 *
 * Why this is needed:
 *   • The AcademicSession DTO's `startDate` / `endDate` fields are
 *     documented as "YYYY-MM-DD" but actually arrive over the wire as
 *     ISO timestamps (e.g. "2026-04-01T00:00:00.000Z") because Postgres
 *     DATE columns serialize through Prisma → JSON as full Date objects.
 *   • Other attendance callers (e.g. /attendance/insights) sidestep
 *     this by building dates locally via `todayISO()` / `daysAgoISO()`
 *     — they never round-trip a session DTO date through this endpoint.
 *     The student-detail hook is the first to do so, hence the gap.
 *
 * Behavior: accepts either format and returns the YYYY-MM-DD slice.
 * Returns the input unchanged if it's already 10 chars or doesn't
 * match the ISO shape — keeps the function defensive without throwing.
 */
function toYMD(dateLike: string): string {
  // Already YYYY-MM-DD-shaped? Trust the caller.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateLike)) return dateLike;
  // ISO timestamp? Take the date portion before the "T".
  if (/^\d{4}-\d{2}-\d{2}T/.test(dateLike)) return dateLike.slice(0, 10);
  // Unknown shape — return as-is and let the backend's validator
  // surface a clear error.
  return dateLike;
}

/**
 * useStudentAttendanceReport — fetches a single student's attendance
 * summary for a given date range, scoped to the active (or specified)
 * academic session. Used by the student-detail page's Attendance
 * section (Session 6c-detail).
 *
 * The backend `attendanceApi.getReport({ studentId, ... })` returns a
 * discriminated union; we narrow to `scope: "student"` at the call
 * site. Errors propagate to the section's local error state — the
 * page-level renderer handles them per-section instead of failing
 * the whole page.
 *
 * Date normalization: `fromDate` / `toDate` accept either YYYY-MM-DD
 * or full ISO timestamps. The backend's strict `@Matches` validator
 * only accepts YYYY-MM-DD, so we normalize via `toYMD()` before the
 * request goes out. The cache key uses the normalized form too so
 * "2026-04-01" and "2026-04-01T00:00:00.000Z" share a cache slot.
 */
export function useStudentAttendanceReport(
  studentId: string | undefined,
  options: {
    fromDate: string;
    toDate: string;
    sessionId?: string | null;
    enabled?: boolean;
  },
) {
  const { authReady, isAuthenticated } = useAuthReady();
  const fromDate = toYMD(options.fromDate);
  const toDate = toYMD(options.toDate);
  const ready =
    (options.enabled ?? true) &&
    authReady &&
    isAuthenticated &&
    Boolean(studentId) &&
    Boolean(fromDate) &&
    Boolean(toDate);
  return useQuery({
    queryKey: qk.studentAttendanceReport(
      studentId ?? "",
      // sessionId is kept as a CACHE-KEY discriminator only — two
      // sessions for the same student need separate cache slots so
      // switching the topbar session selector doesn't serve stale
      // numbers. The wire request below does NOT include sessionId.
      options.sessionId ?? null,
      fromDate,
      toDate,
    ),
    queryFn: () =>
      // Do NOT pass sessionId to the API. The backend's controller
      // declares `@Query('sessionId') sessionId?: string`, BUT the
      // global ValidationPipe has `forbidNonWhitelisted: true` and
      // the ReportQueryDto doesn't list sessionId — so any request
      // carrying sessionId in the query string is 400'd with
      // "property sessionId should not exist" before the controller
      // body ever runs. The session window is already encoded in
      // fromDate/toDate, which the caller computed from the active
      // session's startDate/endDate. The controller's sessionId
      // parameter is effectively dead code today; fixing that is a
      // separate backend session.
      attendanceApi.getReport({
        studentId: studentId as string,
        fromDate,
        toDate,
      }),
    enabled: ready,
    // 1m stale — attendance is daily-write data; the detail page
    // doesn't need second-by-second freshness.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403 || status === 404) return false;
      return failureCount < 1;
    },
  });
}

/** Returns `today - nDays` as a YYYY-MM-DD string (local). */
export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Today's date in YYYY-MM-DD format (local time). */
export function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

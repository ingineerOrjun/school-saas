import { api } from "./api";

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

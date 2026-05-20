import { api } from "./api";

/**
 * Academic session — one row per academic year per school. Drives
 * year-scoped reports and (eventually) the promotion workflow.
 *
 * The backend marks exactly one session per school as `isActive`.
 * Writes that don't pass an explicit sessionId default to the active
 * session; reads accept an optional `?sessionId=` filter and return
 * everything when omitted.
 */
export interface AcademicSessionDto {
  id: string;
  name: string;
  /**
   * ISO-8601 timestamp string. Despite the backend column being a
   * Postgres DATE (no time component), Prisma serializes Date objects
   * through JSON as full ISO timestamps — e.g. "2026-04-01T00:00:00.000Z".
   *
   * Callers passing this value to an endpoint that accepts YYYY-MM-DD
   * (notably `/attendance/report`, whose DTO has a strict
   * `^\d{4}-\d{2}-\d{2}$` regex validator) MUST slice the leading 10
   * characters first. The `useStudentAttendanceReport` hook handles
   * this transparently via its internal `toYMD()` helper.
   */
  startDate: string;
  /** ISO-8601 timestamp string. See `startDate` for the format gotcha. */
  endDate: string;
  isActive: boolean;
  /**
   * When true, the session is read-only — attendance writes, marks
   * updates, and exam edits all 400. Lock is the precondition for
   * running promotion.
   */
  isLocked: boolean;
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAcademicSessionInput {
  name: string;
  /** YYYY-MM-DD; backend coerces to a Date. */
  startDate: string;
  endDate: string;
  /** When true, this session becomes active and any existing active is demoted. */
  isActive?: boolean;
}

export const academicSessionsApi = {
  list: () => api<AcademicSessionDto[]>("/academic-sessions"),
  /** Returns null when no session is active yet. */
  getActive: () =>
    api<AcademicSessionDto | null>("/academic-sessions/active"),
  create: (input: CreateAcademicSessionInput) =>
    api<AcademicSessionDto>("/academic-sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** Atomically promote one session to active (demoting the previous). */
  activate: (id: string) =>
    api<AcademicSessionDto>(`/academic-sessions/${id}/activate`, {
      method: "POST",
    }),
  /**
   * Lock a session — freezes attendance, marks, and exam writes
   * targeting it. Required precondition for running promotion.
   * Idempotent.
   */
  lock: (id: string) =>
    api<AcademicSessionDto>(`/academic-sessions/${id}/lock`, {
      method: "POST",
    }),
  /** Reverse of `lock`. Idempotent. */
  unlock: (id: string) =>
    api<AcademicSessionDto>(`/academic-sessions/${id}/unlock`, {
      method: "POST",
    }),
  remove: (id: string) =>
    api<void>(`/academic-sessions/${id}`, { method: "DELETE" }),
};

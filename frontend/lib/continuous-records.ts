import { useQueries, useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { qk } from "./query-keys";
import type { SkillArea } from "./learning-outcomes";
import type { SubjectCode } from "./subject-aliases";

// ============================================================================
// continuous-records — typed client + hooks for GET /continuous-records.
//
// Backend contract (read backend/src/continuous-record/continuous-record.
// controller.ts + dto/list-continuous-record.dto.ts):
//
//   GET /continuous-records?studentId=<UUID>&sessionId=<UUID>
//     [&subjectCode=<SubjectCode>]
//     [&classLevel=<n>]
//
//   • studentId + sessionId are REQUIRED (DTO @IsUUID validators).
//     There is NO class-wide query endpoint — the rating screen
//     therefore fans out N parallel single-student queries via
//     `useContinuousRecordsForClassStudents` below.
//   • Returns a flat array of ContinuousRecord rows for that student
//     in that session, ordered outcome.unitNumber → outcome.sortOrder
//     → phase (REGULAR before AFTER_SUPPORT).
//   • Empty array (not 404) when the student is unrated. The rating
//     screen renders unrated rows with empty buttons.
//   • Feature-gated behind `conEvaluation` (403 when off).
//   • Teacher scope: a TEACHER caller must be assigned to the
//     student's class. Otherwise 403.
//
// Cache shape:
//   • staleTime: 2 min — rating data moves more often than
//     curriculum but not so fast that every navigation needs a
//     refetch. Tuned for "teacher rates a few students, navigates
//     back, sees fresh state" without burning RPS on every tap.
//   • refetchOnMount: true — coming back to the rating screen
//     should always reflect the latest committed ratings.
//   • retry: 2 — these requests are heavier than curriculum reads;
//     a transient failure mid-class should self-heal.
// ============================================================================

export type EvalPhase = "REGULAR" | "AFTER_SUPPORT";

/**
 * One ContinuousRecord row. The Prisma model joins LearningOutcome on
 * the backend list query (per the service's include); we type the
 * minimum the rating screen needs. If a future caller needs more
 * outcome fields, widen this type — the backend already returns the
 * full join (see continuous-record.service.list).
 */
export interface ContinuousRecordDto {
  id: string;
  schoolId: string;
  studentId: string;
  outcomeId: string;
  sessionId: string;
  phase: EvalPhase;
  rating: 1 | 2 | 3 | 4;
  notes: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  /** Joined outcome metadata. Backend includes this on every list row. */
  outcome?: {
    id: string;
    unitNumber: number;
    sortOrder: number;
    skillArea: SkillArea;
    descriptionEn: string | null;
  };
}

function buildQuery(
  studentId: string,
  sessionId: string,
  subjectCode?: SubjectCode,
): string {
  const params = new URLSearchParams();
  params.set("studentId", studentId);
  params.set("sessionId", sessionId);
  if (subjectCode) params.set("subjectCode", subjectCode);
  return params.toString();
}

export const continuousRecordsApi = {
  listForStudent: (
    studentId: string,
    sessionId: string,
    subjectCode?: SubjectCode,
  ) =>
    api<ContinuousRecordDto[]>(
      `/continuous-records?${buildQuery(studentId, sessionId, subjectCode)}`,
      { redirectOn403: false },
    ),
};

// ---------------------------------------------------------------------------
// useContinuousRecordsForStudent — per-student fetch.
//
// One cache entry per (studentId, sessionId, subjectCode?). The home
// page and the rating screen never call this directly for the SAME
// student → the cache slots stay independent.
// ---------------------------------------------------------------------------
export function useContinuousRecordsForStudent(
  studentId: string,
  sessionId: string,
  options?: { enabled?: boolean; subjectCode?: SubjectCode },
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(studentId) && Boolean(sessionId);
  return useQuery({
    queryKey: qk.continuousRecordsForStudent(
      studentId,
      sessionId,
      options?.subjectCode,
    ),
    queryFn: () =>
      continuousRecordsApi.listForStudent(
        studentId,
        sessionId,
        options?.subjectCode,
      ),
    enabled,
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403) return false;
      if (status && status >= 400 && status < 500) return false;
      return failureCount < 2;
    },
  });
}

// ---------------------------------------------------------------------------
// useContinuousRecordsForClassStudents — fan-out for the rating screen.
//
// The backend doesn't expose a class-wide GET, so we issue N parallel
// per-student queries via `useQueries`. Each query gets its own cache
// slot (matching `useContinuousRecordsForStudent`'s key), so multiple
// rating screens in the same tab share the cache without redundant
// fetches.
//
// Returned shape:
//   • `byStudentId` — Map<studentId, ContinuousRecordDto[]>
//   • `isLoading`   — any one query still loading
//   • `isError`     — any query failed
//   • `errorCount`  — how many failed (UI surfaces partial-success
//                     differently from full failure)
//
// Edge cases:
//   • Empty `studentIds` → returns an empty Map, never fires.
//   • A student id that 403s → we capture it under `errorCount` but
//     the others still render — partial render is acceptable for
//     the rating screen since the teacher can still rate students
//     whose records loaded.
// ---------------------------------------------------------------------------
export interface ClassRecordsResult {
  byStudentId: Map<string, ContinuousRecordDto[]>;
  isLoading: boolean;
  isError: boolean;
  errorCount: number;
}

export function useContinuousRecordsForClassStudents(
  studentIds: ReadonlyArray<string>,
  sessionId: string,
  options?: { enabled?: boolean; subjectCode?: SubjectCode },
): ClassRecordsResult {
  const enabled =
    (options?.enabled ?? true) && Boolean(sessionId) && studentIds.length > 0;

  const queries = useQueries({
    queries: studentIds.map((studentId) => ({
      queryKey: qk.continuousRecordsForStudent(
        studentId,
        sessionId,
        options?.subjectCode,
      ),
      queryFn: () =>
        continuousRecordsApi.listForStudent(
          studentId,
          sessionId,
          options?.subjectCode,
        ),
      enabled,
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      retry: (failureCount: number, error: unknown) => {
        if (isNetworkError(error)) return false;
        const status = (error as { status?: number } | null)?.status;
        if (status === 401 || status === 403) return false;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    })),
  });

  const byStudentId = new Map<string, ContinuousRecordDto[]>();
  let anyLoading = false;
  let errorCount = 0;
  studentIds.forEach((id, idx) => {
    const q = queries[idx];
    if (q.isLoading) anyLoading = true;
    if (q.isError) errorCount += 1;
    if (q.data) byStudentId.set(id, q.data);
  });

  return {
    byStudentId,
    isLoading: anyLoading,
    isError: errorCount > 0 && errorCount === studentIds.length,
    errorCount,
  };
}

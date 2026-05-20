import * as React from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError, api, isNetworkError } from "./api";
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

/** Payload accepted by POST /continuous-records. Mirrors the backend
 *  `CreateContinuousRecordDto` field set (notes + expectedUpdatedAt
 *  optional). Required-field types match the @IsUUID / @IsString
 *  validators on the DTO: studentId + sessionId are UUIDs;
 *  outcomeId is a plain cuid string. */
export interface UpsertContinuousRecordPayload {
  studentId: string;
  outcomeId: string;
  sessionId: string;
  phase: EvalPhase;
  rating: 1 | 2 | 3 | 4;
  notes?: string;
  /** Round-trip the GET's updatedAt for stale-write protection. */
  expectedUpdatedAt?: string;
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

  /**
   * POST /continuous-records — single upsert. Returns the saved row.
   *
   * The backend treats this as an UPSERT keyed on
   * (studentId, outcomeId, sessionId, phase): first call creates,
   * subsequent calls with the same composite update. Either way the
   * response is a single ContinuousRecord — we use it to reconcile
   * the per-student cache without an extra fetch.
   *
   * `redirectOn403: false` so a teacher-scope rejection surfaces as
   * an ApiError the caller can show as a toast, not a logout.
   */
  upsertSingle: (payload: UpsertContinuousRecordPayload) =>
    api<ContinuousRecordDto>("/continuous-records", {
      method: "POST",
      body: JSON.stringify(payload),
      redirectOn403: false,
    }),
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

  // ---------------------------------------------------------------------------
  // Stable result identity (Session 6a infinite-loop fix).
  //
  // Without memoization, `useQueries` returns a brand-new array of
  // result objects on every render of this hook, and the previous
  // implementation rebuilt `byStudentId` (a Map) + the return object
  // in the render body — both with fresh identities every render.
  // Consumers that put `records.byStudentId` in a useEffect dep array
  // saw a new Map every render → effect re-fired every render → if
  // the effect called setState (e.g. the rating screen's seed
  // effect) → infinite re-render loop.
  //
  // Stabilization strategy:
  //   • Build a SINGLE primitive "signature" string capturing each
  //     query's status + `dataUpdatedAt` + `errorUpdatedAt`. Those
  //     three primitives flip when React Query has new info for any
  //     given subscription; otherwise they're stable across renders.
  //   • Memo the result on (signature, studentIds-as-string). When
  //     nothing has changed, the memo returns the SAME object and
  //     SAME Map references → consumer dep arrays stable → no loop.
  //
  // The signature approach side-steps React's "constant deps length"
  // rule (we can't spread queries.map(...) into the deps array
  // because studentIds.length varies between renders during
  // navigation). A single concatenated string is one slot, period.
  // ---------------------------------------------------------------------------
  const querySignature = queries
    .map((q) => `${q.status}:${q.dataUpdatedAt}:${q.errorUpdatedAt}`)
    .join("|");
  const studentIdsKey = studentIds.join(",");

  return React.useMemo<ClassRecordsResult>(
    () => {
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
    },
    // The two deps fully describe the result: studentIdsKey captures
    // roster changes, querySignature captures any query's state
    // transition. `queries` and `studentIds` themselves are NOT in
    // the deps — they wobble on identity every render, but the
    // signature/key fully gate when we need to rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studentIdsKey, querySignature],
  );
}

// ============================================================================
// useUpsertContinuousRecord — POST /continuous-records mutation (Session 6b).
//
// One HTTP call per teacher tap. The backend treats the endpoint as an
// upsert keyed on (studentId, outcomeId, sessionId, phase) — first
// call creates, subsequent same-composite calls update. Response is
// a single ContinuousRecord; we splice it directly into the per-
// student cache via `setQueryData` (decision 5 in the spec — no
// invalidation, no extra round-trip).
//
// Failure model — strict, no auto-retry:
//   • 4xx (400 locked session, 403 teacher-scope, 422 AFTER_SUPPORT
//     precondition, 409 concurrent modification): caller handles UX.
//     We surface the backend's `message` verbatim so the teacher
//     sees exactly what went wrong.
//   • 5xx: same as 4xx — no retry. Teacher manually retries via the
//     failed-row tap.
//   • 429: api.ts throws this immediately (never retries). Same
//     surface as any other ApiError to the caller.
//   • Network failure (status=0): also no retry — manual retry.
//
// The mutation hook is INTENTIONALLY slim: it owns cache
// reconciliation on success, nothing else. Optimistic UI + rollback
// + toasts live in the rating-screen component so the visual choreo
// stays close to the JSX that owns the cell state. This mirrors the
// codebase's prevailing pattern (see `AnnouncementBanner.dismiss`
// for the colocated-optimistic variant; we keep optimistic in the
// caller to enable the WhatsApp-style "keep attempted value visible
// on failure" UX, which is hard to do from inside the mutation).
//
// `subjectCode` is required on the input ONLY for cache reconciliation
// — the backend doesn't need it on POST (it's derived from the
// outcome). It's the discriminator on the per-student cache key,
// which is keyed on (studentId, sessionId, subjectCode). Without it
// here we'd write into the wrong cache slot when the rating screen's
// list query was scoped by subject.
// ============================================================================

export interface UpsertRatingInput extends UpsertContinuousRecordPayload {
  /** Subject code for the cache slot this rating belongs in. NOT sent
   *  to the server — the backend derives subject from the outcome. */
  subjectCode: SubjectCode;
}

export function useUpsertContinuousRecord() {
  const queryClient = useQueryClient();

  return useMutation<ContinuousRecordDto, ApiError, UpsertRatingInput>({
    mutationFn: ({ subjectCode: _subjectCode, ...payload }) =>
      continuousRecordsApi.upsertSingle(payload),

    onSuccess: (saved, variables) => {
      // Update the per-student cache slice IN PLACE. The slice's
      // shape is ContinuousRecordDto[] (everything for that student
      // in this session/subject). We replace any existing record
      // with the same (outcomeId, phase) — that's the composite the
      // backend upserts on — and append the new one if it wasn't
      // already there.
      const key = qk.continuousRecordsForStudent(
        variables.studentId,
        variables.sessionId,
        variables.subjectCode,
      );
      queryClient.setQueryData<ContinuousRecordDto[]>(key, (old) => {
        if (!old) return [saved];
        const filtered = old.filter(
          (r) =>
            !(r.outcomeId === saved.outcomeId && r.phase === saved.phase),
        );
        return [...filtered, saved];
      });
    },

    // Strict no-retry on every failure class. See header comment for
    // the rationale (4xx, 5xx, 429, network all surface to the
    // caller for UX-level retry, not silent re-POST).
    retry: false,
  });
}

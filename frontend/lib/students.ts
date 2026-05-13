import { useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { useAuthReady } from "@/hooks/useAuthReady";
import { qk } from "./query-keys";
import { STALE } from "./query-client";
import type { ClassDto } from "./classes";

export type Gender = "MALE" | "FEMALE" | "OTHER";

export interface StudentSectionDto {
  id: string;
  name: string;
  classId: string;
  createdAt: string;
  updatedAt: string;
  class: ClassDto;
}

export interface StudentDto {
  id: string;
  firstName: string;
  lastName: string;
  /** Nepal-style Symbol / Roll number. Unique within a school when present. */
  symbolNumber: string | null;
  schoolId: string;
  userId: string | null;
  /** Required demographic + contact fields. */
  gender: Gender;
  dateOfBirth: string;
  parentName: string;
  contactNumber: string;
  /** Optional. */
  address: string | null;
  admissionDate: string | null;
  /**
   * Direct class link. Populated for every student who has been assigned to
   * either a class or a section (the backend derives classId from the
   * section when only a section is provided). Null for unassigned students.
   */
  classId: string | null;
  class: ClassDto | null;
  sectionId: string | null;
  section: StudentSectionDto | null;
  /**
   * Phase DATA LIFECYCLE Part 1: soft-delete state. Non-null
   * `archivedAt` means the row is hidden from default listings and
   * read-only until restored.
   */
  archivedAt: string | null;
  archivedById: string | null;
  archiveReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  symbolNumber?: string | null;
  /** Required by the backend. */
  gender: Gender;
  dateOfBirth: string;
  parentName: string;
  contactNumber: string;
  /** Optional. */
  address?: string | null;
  admissionDate?: string | null;
  userId?: string;
  classId?: string | null;
  sectionId?: string | null;
}

export interface UpdateStudentInput {
  firstName?: string;
  lastName?: string;
  symbolNumber?: string | null;
  gender?: Gender;
  dateOfBirth?: string;
  parentName?: string;
  contactNumber?: string;
  address?: string | null;
  admissionDate?: string | null;
  userId?: string;
  classId?: string | null;
  sectionId?: string | null;
  /**
   * Phase FINAL-HARDENING Part 2: optimistic-concurrency stamp.
   * Round-trip the value the GET returned so the backend can
   * detect a cross-tab race. Omitted → backend falls back to
   * last-write-wins (legacy clients during rollout).
   */
  updatedAt?: string;
}

export interface ListStudentsFilter {
  /** When set, only students in this class are returned. */
  classId?: string;
  /** When true, only students without any class assignment are returned. */
  unassigned?: boolean;
  /**
   * Phase DATA LIFECYCLE Part 1 archive filter:
   *   • true        → only archived rows (drives the "Archived" tab)
   *   • "all"       → both active + archived
   *   • undefined   → default (active only)
   */
  archived?: boolean | "all";
}

function buildListQuery(filter?: ListStudentsFilter): string {
  if (!filter) return "";
  const params = new URLSearchParams();
  if (filter.unassigned) params.set("unassigned", "1");
  else if (filter.classId) params.set("classId", filter.classId);
  if (filter.archived === true) params.set("archived", "1");
  else if (filter.archived === "all") params.set("archived", "all");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** One row in a bulk-import payload — mirrors backend BulkStudentInput. */
export interface BulkStudentInput {
  firstName: string;
  lastName: string;
  symbolNumber?: string | null;
  gender: Gender;
  dateOfBirth: string;
  parentName: string;
  contactNumber: string;
  address?: string | null;
  admissionDate?: string | null;
  className?: string | null;
}

export interface BulkFailure {
  rowIndex: number;
  reason: string;
}

export interface BulkCreateResult {
  successCount: number;
  failed: BulkFailure[];
}

/**
 * Aggregated student analytics — mirror of the backend `StudentAnalytics`.
 * Powers the Analytics Center's Student tab.
 */
export interface StudentAnalytics {
  total: number;
  genderSplit: Array<{
    gender: "MALE" | "FEMALE" | "OTHER";
    count: number;
  }>;
  classStrength: Array<{
    classId: string | null;
    className: string;
    count: number;
  }>;
  admissionsTrend: Array<{
    month: string;
    count: number;
  }>;
  generatedAt: string;
}

export const studentsApi = {
  list: (filter?: ListStudentsFilter) =>
    api<StudentDto[]>(`/students${buildListQuery(filter)}`),
  /**
   * Multi-field typeahead used by the cashier workspace. Matches `q`
   * against name, symbol no, phone, and parent name. Empty query
   * returns the most-recently-created students (the "no input yet"
   * dropdown state). Capped at `limit` (default 10).
   */
  search: (q: string, limit = 10) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("limit", String(limit));
    return api<StudentDto[]>(`/students/search?${params.toString()}`);
  },
  /**
   * Aggregated student analytics for the Analytics Center. Admin-only
   * server-side; the page-level role gate ensures non-admins never
   * even reach the call site.
   */
  getAnalytics: () => api<StudentAnalytics>("/students/analytics"),
  get: (id: string) => api<StudentDto>(`/students/${id}`),
  create: (input: CreateStudentInput) =>
    api<StudentDto>("/students", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  bulkCreate: (students: BulkStudentInput[]) =>
    api<BulkCreateResult>("/students/bulk", {
      method: "POST",
      body: JSON.stringify({ students }),
    }),
  update: (id: string, input: UpdateStudentInput) =>
    api<StudentDto>(`/students/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/students/${id}`, { method: "DELETE" }),
  /**
   * Phase DATA LIFECYCLE Part 1+2: soft-archive a student. Reason
   * surfaces in the audit feed and ArchivedBadge tooltip.
   * Idempotent on the server.
   */
  archive: (id: string, reason?: string) =>
    api<StudentDto>(`/students/${id}/archive`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? undefined }),
    }),
  /**
   * Restore a previously archived student. Idempotent on the server.
   */
  restore: (id: string) =>
    api<StudentDto>(`/students/${id}/restore`, { method: "POST" }),
};

// ---------------------------------------------------------------------------
// useStudents — Phase α follow-up shared hook.
//
// Replaces the legacy `useEffect(() => studentsApi.list().then(setState), [])`
// pattern. Routes through React Query so multiple consumers on the
// same page (or fast back/forward navigation between /students and
// /attendance) collapse to one underlying request.
//
// Filter normalisation lives in qk.students(): equivalent inputs
// produce the same key, so two pages calling `useStudents({ classId })`
// share the cache.
//
// Auth gating: queries don't fire until the auth-store publishes
// authReady=true. Fixes the user=<anon> 429 storm — protected
// requests no longer fan out during the bootstrap window before
// localStorage is restored.
// ---------------------------------------------------------------------------

export function useStudents(filter?: ListStudentsFilter) {
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery({
    queryKey: qk.students(filter),
    queryFn: () => studentsApi.list(filter),
    enabled: authReady && isAuthenticated,
    // 1m staleTime — student data moves with enrolment; the heavy
    // /students endpoint shouldn't refetch on every modal mount.
    staleTime: STALE.SEMI_STATIC,
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

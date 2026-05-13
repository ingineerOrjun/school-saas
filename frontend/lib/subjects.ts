import { useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { useAuthReady } from "@/hooks/useAuthReady";
import { qk } from "./query-keys";
import { STALE } from "./query-client";

/**
 * School-owned subject catalog. Used by `TeachingAssignment` to express
 * "this teacher teaches Math to Class 8". Read by anyone authenticated;
 * writes are admin-only on the backend.
 */
export interface SubjectDto {
  id: string;
  name: string;
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubjectInput {
  name: string;
}

export interface UpdateSubjectInput {
  name?: string;
}

export const subjectsApi = {
  list: () => api<SubjectDto[]>("/subjects"),
  create: (input: CreateSubjectInput) =>
    api<SubjectDto>("/subjects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateSubjectInput) =>
    api<SubjectDto>(`/subjects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/subjects/${id}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// useSubjects — Phase γ canonical reference hook.
//
// Reference data (operator-driven changes only). 10m staleTime
// means every dialog / picker / list page that needs the subject
// catalog shares ONE underlying request per stale window.
//
// Mutations (create/update/remove) call subjectsApi.* directly +
// invalidate qk.subjects() targeted, NOT a global invalidation.
// ---------------------------------------------------------------------------

export function useSubjects() {
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery({
    queryKey: qk.subjects(),
    queryFn: () => subjectsApi.list(),
    enabled: authReady && isAuthenticated,
    staleTime: STALE.REFERENCE_DATA,
    gcTime: 30 * 60_000,
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

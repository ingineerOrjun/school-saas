import { useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { useAuthReady } from "@/hooks/useAuthReady";
import { qk } from "./query-keys";
import { STALE } from "./query-client";
import type { SectionDto } from "./sections";

export interface ClassDto {
  id: string;
  name: string;
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassWithSections extends ClassDto {
  sections: SectionDto[];
}

export interface CreateClassInput {
  name: string;
}

export interface UpdateClassInput {
  name?: string;
}

export const classesApi = {
  list: () => api<ClassWithSections[]>("/classes"),
  create: (input: CreateClassInput) =>
    api<ClassDto>("/classes", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateClassInput) =>
    api<ClassDto>(`/classes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/classes/${id}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// useClasses() — singleton-cached classes list.
//
// Reference data (10m staleTime). Every consumer that previously
// did `useEffect(() => classesApi.list().then(setState), [])`
// should switch to:
//
//   const { data: classes = [], isLoading } = useClasses();
//
// Same query key across the app means: ONE underlying fetch, one
// cache entry, instant back/forward navigation, no fan-out on
// modal mounts.
//
// Mutations (create/update/remove) should call the imperative
// classesApi.* method directly + then invalidate the cache:
//
//   const qc = useQueryClient();
//   await classesApi.create(input);
//   qc.invalidateQueries({ queryKey: qk.classes() });
// ---------------------------------------------------------------------------

export function useClasses() {
  // Phase α follow-up — gate on the subscribable auth-store, not on
  // a synchronous `getToken()` read. The latter could return a token
  // mid-bootstrap before the api() client + React Query had stable
  // state, producing the user=<anon> 429 storm. authReady fires
  // exactly once after localStorage is restored; isAuthenticated
  // gates out the logged-out state cleanly.
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery({
    queryKey: qk.classes(),
    queryFn: () => classesApi.list(),
    enabled: authReady && isAuthenticated,
    staleTime: STALE.REFERENCE_DATA,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // 401 → no point retrying; the user is logged out. Other errors
    // get one retry via the global default in lib/query-client.
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403) return false;
      return failureCount < 1;
    },
  });
}

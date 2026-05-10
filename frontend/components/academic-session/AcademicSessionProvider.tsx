"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthReady } from "@/hooks/useAuthReady";
import {
  academicSessionsApi,
  type AcademicSessionDto,
} from "@/lib/academic-sessions";
import { qk } from "@/lib/query-keys";
import { STALE } from "@/lib/query-client";

/**
 * Holds the user's currently-selected academic session for the
 * frontend. Defaults to the school's active session on first load;
 * the user can switch via the topbar selector to view a previous
 * year's data without affecting writes (writes still target the
 * BACKEND's active session unless the page explicitly passes one).
 *
 *   • `sessions` — the list of all sessions for this school
 *   • `selected` — the session whose ID should be used as a filter
 *                   on read endpoints (?sessionId=…)
 *   • `setSelected(id)` — change the selection. Persisted to
 *                          localStorage so it survives reloads.
 *
 * Auth-failure tolerant: if the user isn't logged in (the lib API
 * call 401s), we just leave the lists empty and let the page-level
 * auth guard handle the redirect.
 */
interface AcademicSessionContextValue {
  sessions: AcademicSessionDto[];
  selected: AcademicSessionDto | null;
  active: AcademicSessionDto | null;
  loading: boolean;
  setSelectedId: (id: string | null) => void;
  /** Re-fetch the list — call after creating or activating a session. */
  refresh: () => Promise<void>;
}

const Ctx = React.createContext<AcademicSessionContextValue | null>(null);

const STORAGE_KEY = "academic-session";

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AcademicSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reference data — operator-driven changes only. 10m staleTime
  // means the topbar selector + every page that filters by session
  // share ONE underlying fetch over the full SPA navigation cycle.
  //
  // Phase α follow-up — gate on the subscribable auth-store. The
  // synchronous getToken() check raced bootstrap and produced
  // user=<anon> 429s on /academic-sessions during cold reloads.
  const { authReady, isAuthenticated } = useAuthReady();
  const query = useQuery<AcademicSessionDto[]>({
    queryKey: qk.academicSessions(),
    queryFn: () => academicSessionsApi.list(),
    enabled: authReady && isAuthenticated,
    // Phase γ — academic sessions change at most a few times per
    // year. 30m stale + 30m gc — the topbar selector + every page
    // share one fetch across the entire SPA navigation cycle.
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403) return false;
      return failureCount < 1;
    },
  });

  const sessions = query.data ?? [];
  const loading = query.isLoading;

  const [selectedId, setSelectedIdState] = React.useState<string | null>(null);

  // Resolve the selected session ID once data lands:
  //   stored preference (if still in the list) → active → first → null
  // Computed in an effect so it only runs when sessions change.
  React.useEffect(() => {
    if (sessions.length === 0) return;
    setSelectedIdState((prev) => {
      const stored = prev ?? readStoredId();
      if (stored && sessions.some((s) => s.id === stored)) return stored;
      const active = sessions.find((s) => s.isActive);
      if (active) return active.id;
      return sessions[0]?.id ?? null;
    });
  }, [sessions]);

  // Persist the selection. Skip null to avoid stomping a legit
  // stored value during the initial-loading window.
  React.useEffect(() => {
    if (selectedId == null) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, selectedId);
    } catch {
      /* no-op */
    }
  }, [selectedId]);

  // Expose `refresh` for code paths that just created / activated
  // a session and want immediate read-after-write. Goes through
  // the React Query cache so other consumers get the update too.
  const refresh = React.useCallback(async () => {
    await query.refetch();
  }, [query]);

  const value = React.useMemo<AcademicSessionContextValue>(() => {
    const selected = sessions.find((s) => s.id === selectedId) ?? null;
    const active = sessions.find((s) => s.isActive) ?? null;
    return {
      sessions,
      selected,
      active,
      loading,
      setSelectedId: setSelectedIdState,
      refresh,
    };
  }, [sessions, selectedId, loading, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAcademicSession(): AcademicSessionContextValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useAcademicSession must be used within an <AcademicSessionProvider>",
    );
  }
  return ctx;
}

"use client";

import * as React from "react";
import { ApiError } from "@/lib/api";
import { getToken } from "@/lib/auth";
import {
  academicSessionsApi,
  type AcademicSessionDto,
} from "@/lib/academic-sessions";

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
  const [sessions, setSessions] = React.useState<AcademicSessionDto[]>([]);
  const [selectedId, setSelectedIdState] = React.useState<string | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    // The provider sits at the root layout level — above /login — so
    // it mounts before the user has a token. Firing an authenticated
    // request in that state used to throw a noisy 401 in the console
    // every time the login page loaded, AND now (with the global 401
    // handler) was being treated as a session failure even though the
    // user simply hadn't logged in yet. Skip the call when there's no
    // token and let the next remount (after login → hard reload) kick
    // off a real fetch.
    if (!getToken()) {
      setSessions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await academicSessionsApi.list();
      setSessions(list);
      // Resolve the selected session: stored preference wins if it
      // still exists; otherwise fall back to the active session;
      // otherwise the most recent by startDate; otherwise null.
      setSelectedIdState((prev) => {
        const stored = prev ?? readStoredId();
        if (stored && list.some((s) => s.id === stored)) return stored;
        const active = list.find((s) => s.isActive);
        if (active) return active.id;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      // 401 → page-level guard handles it. Anything else → empty
      // list so the selector renders "no sessions yet" instead of
      // crashing the topbar.
      if (err instanceof ApiError && err.status === 401) return;
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load — once on mount.
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Persist the selection. Skip when null so we don't overwrite a
  // legit stored value during the initial-loading window.
  React.useEffect(() => {
    if (selectedId == null) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, selectedId);
    } catch {
      /* no-op */
    }
  }, [selectedId]);

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

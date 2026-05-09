import { api } from "./api";

// ---------------------------------------------------------------------------
// Sessions API client — Phase 17 follow-up.
//
// School-side surface for the logged-in user to see + revoke their
// active sessions. Backed by `/me/sessions` on the backend.
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: string;
  lastActiveAt: string;
  ip: string | null;
  userAgent: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
}

export interface MySessionsResponse {
  /** Server tells us which row corresponds to the calling token. */
  currentSessionId: string | null;
  sessions: SessionRow[];
}

export const sessionsApi = {
  list: () => api<MySessionsResponse>("/me/sessions"),

  revoke: (sessionId: string, reason?: string) =>
    api<SessionRow>(
      `/me/sessions/${encodeURIComponent(sessionId)}/revoke`,
      {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? undefined }),
      },
    ),

  revokeOthers: () =>
    api<{ count: number }>("/me/sessions/revoke-others", {
      method: "POST",
    }),
};

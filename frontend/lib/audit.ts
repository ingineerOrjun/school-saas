import { useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { useAuthReady } from "@/hooks/useAuthReady";
import { qk } from "./query-keys";
import { STALE } from "./query-client";

// ---------------------------------------------------------------------------
// School-side audit feed — tenant-scoped read of PlatformAuditEvent.
//
// The full audit infrastructure lives on the backend (one append-only
// table, one ingestion path). This module is just the frontend
// projection: types + an `api` namespace + a React Query hook that
// the dashboard `RecentActivityPanel` and entity-history sections
// consume.
//
// Identity boundary:
//   The backend hard-locks `schoolId = req.user.schoolId` so the
//   client cannot escape its tenant. No `schoolId` parameter is
//   exposed here.
// ---------------------------------------------------------------------------

/**
 * Every PlatformAuditAction enum value exported by the backend.
 * Kept as a string union so the frontend can render switch-style
 * helpers (icon, copy, color) without importing a Prisma enum.
 */
export type AuditAction =
  | "SCHOOL_STATUS_CHANGED"
  | "IMPERSONATION_STARTED"
  | "IMPERSONATION_ENDED"
  | "SUBSCRIPTION_CREATED"
  | "SCHOOL_MAINTENANCE_TOGGLED"
  | "FEATURE_FLAG_CHANGED"
  | "USER_FORCE_LOGOUT"
  | "SCHOOL_FORCE_LOGOUT"
  | "ADMIN_PASSWORD_RESET"
  | "SCHOOL_CODE_ASSIGNED"
  | "SCHOOL_CODE_UPDATED"
  | "MARKS_LOCKED"
  | "MARKS_UNLOCKED"
  | "ATTENDANCE_BULK_OVERWRITE";

/**
 * One audit row as returned by `/audit/recent`. Mirrors the backend
 * `PlatformAuditRow` shape one-for-one (string-typed timestamps,
 * `before`/`after` as `unknown` JSON blobs the renderer
 * deliberately doesn't try to interpret beyond a few well-known keys).
 */
export interface AuditEvent {
  id: string;
  action: AuditAction;
  schoolId: string | null;
  actorUserId: string;
  actorEmail: string | null;
  actorRole: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AuditPage {
  rows: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditFilters {
  action?: AuditAction;
  targetType?: string;
  targetId?: string;
  q?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export const auditApi = {
  listRecent: (filters: AuditFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.targetType) params.set("targetType", filters.targetType);
    if (filters.targetId) params.set("targetId", filters.targetId);
    if (filters.q) params.set("q", filters.q);
    if (filters.fromDate) params.set("fromDate", filters.fromDate);
    if (filters.toDate) params.set("toDate", filters.toDate);
    if (filters.page) params.set("page", filters.page.toString());
    if (filters.pageSize) params.set("pageSize", filters.pageSize.toString());
    const qs = params.toString();
    return api<AuditPage>(`/audit/recent${qs ? `?${qs}` : ""}`);
  },
};

// ---------------------------------------------------------------------------
// useRecentActivity — React Query hook.
//
// staleTime: 30s. The audit feed is operational — fresh enough that
// a 30-second cache window collapses fast successive mounts (e.g.,
// the dashboard panel + an entity-history sidebar referencing the
// same target id) onto one underlying fetch. No background polling
// — the panel either reflects user-driven invalidations (a fresh
// marks-lock returns and the renderer calls invalidateQueries) or
// the next manual visit.
// ---------------------------------------------------------------------------

export function useRecentActivity(filters: AuditFilters = {}) {
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery({
    queryKey: qk.auditRecent(filters),
    queryFn: () => auditApi.listRecent(filters),
    enabled: authReady && isAuthenticated,
    staleTime: STALE.LIVE_OPERATOR,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      const status = (error as { status?: number } | null)?.status;
      // 403 → user isn't ADMIN/STAFF; no point retrying. Render an
      // empty state and move on.
      if (status === 401 || status === 403) return false;
      return failureCount < 1;
    },
  });
}

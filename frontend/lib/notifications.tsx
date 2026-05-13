"use client";

import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { ApiError, api, isNetworkError } from "./api";
import { useAuthReady } from "@/hooks/useAuthReady";

// ---------------------------------------------------------------------------
// School-side notifications client + hooks — Phase 20.
//
// Phase-20-followup: rebuilt on @tanstack/react-query so the bell,
// the dropdown preview, and the /notifications page share ONE
// underlying cache via shared query keys. Same key → one fetch
// regardless of how many components mount the hook.
//
// Shared query keys are the entire dedupe story:
//   notificationKeys.unreadCount          → bell badge + provider sentinel
//   notificationKeys.list(filters)        → page list AND dropdown list
//   notificationKeys.detail(id)           → side drawer
//
// Every mutation (mark read, mark unread, mark all read) flips the
// cached entries optimistically — onMutate updates cache before
// the network call lands. onError rolls back. onSuccess is a no-op
// (the optimistic state is already correct).
//
// React StrictMode safety:
//   useQuery handles double-mount + double-effect via internal
//   request dedupe + the staleTime check. No setInterval in
//   useEffect — the polling is React Query's own scheduler.
// ---------------------------------------------------------------------------

export type NotificationSeverity =
  | "INFO"
  | "SUCCESS"
  | "WARNING"
  | "ERROR"
  | "CRITICAL";

export interface SchoolNotificationListRow {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  readAt: string | null;
  createdAt: string;
  targetedToMe: boolean;
}

export interface SchoolNotificationListResponse {
  rows: SchoolNotificationListRow[];
  total: number;
  page: number;
  pageSize: number;
  unreadCount: number;
}

export interface SchoolNotificationDetailRow extends SchoolNotificationListRow {
  templateKey: string;
  payload: unknown;
  deliveries: Array<{
    channel: string;
    status: string;
    sentAt: string | null;
  }>;
}

export interface NotificationListQuery {
  severity?: NotificationSeverity[];
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

// ---------------------------------------------------------------------------
// Raw API client. Kept exported for the rare caller that needs an
// imperative call outside the React tree (none today).
// ---------------------------------------------------------------------------

export const notificationsApi = {
  list: (query: NotificationListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.severity && query.severity.length > 0) {
      // Sort to make the URL stable across permutations — same
      // selection order = same query key = cache hit.
      params.set("severity", [...query.severity].sort().join(","));
    }
    if (query.unreadOnly) params.set("unread", "true");
    if (query.page) params.set("page", String(query.page));
    if (query.pageSize) params.set("pageSize", String(query.pageSize));
    const qs = params.toString();
    return api<SchoolNotificationListResponse>(
      qs ? `/notifications?${qs}` : "/notifications",
    );
  },

  unreadCount: () => api<{ count: number }>("/notifications/unread-count"),

  get: (id: string) =>
    api<SchoolNotificationDetailRow>(
      `/notifications/${encodeURIComponent(id)}`,
    ),

  markRead: (id: string) =>
    api<SchoolNotificationListRow>(
      `/notifications/${encodeURIComponent(id)}/read`,
      { method: "PATCH" },
    ),

  markUnread: (id: string) =>
    api<SchoolNotificationListRow>(
      `/notifications/${encodeURIComponent(id)}/unread`,
      { method: "PATCH" },
    ),

  markAllRead: () =>
    api<{ count: number }>("/notifications/mark-all-read", { method: "POST" }),
};

// ---------------------------------------------------------------------------
// Shared query keys — the dedupe contract. Any two components
// using the same key get the same cache entry.
//
// `list` accepts the SAME filters object the API takes — the key
// is structurally compared so different filter shapes get different
// caches (same filter shape = cache hit, even across components).
// ---------------------------------------------------------------------------

export const notificationKeys = {
  /** Root key — bulk-invalidated when any mutation lands. */
  all: ["notifications"] as const,
  unreadCount: ["notifications", "unread-count"] as const,
  /**
   * List key includes the filter shape. We normalise undefined →
   * defaults so {} and {page: 1, pageSize: 25} produce the same key.
   */
  list: (filters: NotificationListQuery = {}) =>
    [
      "notifications",
      "list",
      {
        severity: filters.severity ? [...filters.severity].sort() : [],
        unreadOnly: !!filters.unreadOnly,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      },
    ] as const,
  detail: (id: string) => ["notifications", "detail", id] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Live unread count. Polled at fixed interval; otherwise served
 * from cache. Bell badge + drawer "x unread" indicator both read
 * from this single hook.
 *
 * Rate budget: 60s refetchInterval × N tabs. Backend bucket is
 * 30/min/user — comfortable headroom even for 5 open tabs.
 */
export function useUnreadCount() {
  // Phase α follow-up — gate on the auth-store. Was: getToken()
  // synchronous read which raced bootstrap.
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: () => notificationsApi.unreadCount(),
    enabled: authReady && isAuthenticated,
    // 30s stale → identical reads collapse to one network call.
    staleTime: 30_000,
    // 60s background poll keeps the badge live without hammering.
    refetchInterval: 60_000,
    // Don't refetch on focus — the interval is already enough for
    // a long-lived ERP tab.
    refetchOnWindowFocus: false,
    // One retry on transient hiccups; the next 60s poll reconciles
    // any failure that survives. Network errors are skipped — see
    // `isNetworkError` rationale in `lib/api.ts`. Without this
    // guard, an offline backend produced 2 unread-count attempts
    // per poll across every tab.
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      return failureCount < 1;
    },
  });
}

/**
 * Notification list. Bell dropdown + inbox page read from this.
 * Same filter shape = same cache entry.
 *
 * `keepPreviousData` lets the inbox page show the previous page
 * while the next one fetches — no flash of skeleton on pagination.
 */
export function useNotificationList(
  filters: NotificationListQuery = {},
  options: Pick<
    UseQueryOptions<SchoolNotificationListResponse, ApiError>,
    "enabled" | "refetchOnMount"
  > = {},
) {
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery<SchoolNotificationListResponse, ApiError>({
    queryKey: notificationKeys.list(filters),
    queryFn: () => notificationsApi.list(filters),
    enabled: (options.enabled ?? true) && authReady && isAuthenticated,
    refetchOnMount: options.refetchOnMount ?? false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    // Skip retry on network failure (matches the global policy).
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return false;
      return failureCount < 1;
    },
    placeholderData: (prev) => prev,
  });
}

/** Drawer detail. Lazy — only fetches when the drawer opens. */
export function useNotificationDetail(id: string | null) {
  const { authReady, isAuthenticated } = useAuthReady();
  return useQuery({
    queryKey: id ? notificationKeys.detail(id) : ["notifications", "detail", "__noop__"],
    queryFn: () => notificationsApi.get(id!),
    enabled: !!id && authReady && isAuthenticated,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Mutations — optimistic updates against the shared cache.
//
// Pattern: onMutate flips local state, returns a snapshot for
// rollback. onError rolls back. onSettled invalidates so the next
// poll reconciles with the server.
//
// We DO NOT eagerly refetch after a mutation — the optimistic
// state is the truth until the next scheduled poll (or the next
// time the user opens a stale view).
// ---------------------------------------------------------------------------

interface MarkReadContext {
  /** Snapshots of every cached entry we touched, for rollback. */
  snapshots: Array<[readonly unknown[], unknown]>;
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation<SchoolNotificationListRow, ApiError, string, MarkReadContext>({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: async (id) => {
      // Pause any in-flight refetches so they don't overwrite our
      // optimistic state with stale data.
      await qc.cancelQueries({ queryKey: notificationKeys.all });

      const snapshots: Array<[readonly unknown[], unknown]> = [];
      const now = new Date().toISOString();

      // Walk every cached list entry; flip the row if present.
      // queryClient.setQueriesData with a predicate would do this
      // in one call but we want the snapshots for rollback.
      const cached = qc.getQueriesData<SchoolNotificationListResponse>({
        queryKey: ["notifications", "list"],
      });
      for (const [key, value] of cached) {
        if (!value) continue;
        const found = value.rows.find((r) => r.id === id);
        if (!found || found.readAt) continue; // already read — no change
        snapshots.push([key, value]);
        qc.setQueryData<SchoolNotificationListResponse>(key, {
          ...value,
          rows: value.rows.map((r) =>
            r.id === id ? { ...r, readAt: now } : r,
          ),
          unreadCount: Math.max(0, value.unreadCount - 1),
        });
      }

      // Bump the badge.
      const prevUnread = qc.getQueryData<{ count: number }>(
        notificationKeys.unreadCount,
      );
      if (prevUnread) {
        snapshots.push([notificationKeys.unreadCount, prevUnread]);
        qc.setQueryData(notificationKeys.unreadCount, {
          count: Math.max(0, prevUnread.count - 1),
        });
      }

      // Detail cache, if open.
      const detailKey = notificationKeys.detail(id);
      const prevDetail = qc.getQueryData<SchoolNotificationDetailRow>(detailKey);
      if (prevDetail && !prevDetail.readAt) {
        snapshots.push([detailKey, prevDetail]);
        qc.setQueryData(detailKey, { ...prevDetail, readAt: now });
      }

      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      // Roll back every cache entry we mutated.
      if (!ctx) return;
      for (const [key, value] of ctx.snapshots) {
        qc.setQueryData(key, value);
      }
    },
    // Intentionally NO onSuccess invalidate — the optimistic state
    // is correct. The next scheduled poll reconciles.
  });
}

export function useMarkUnread() {
  const qc = useQueryClient();
  return useMutation<SchoolNotificationListRow, ApiError, string, MarkReadContext>({
    mutationFn: (id: string) => notificationsApi.markUnread(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: notificationKeys.all });

      const snapshots: Array<[readonly unknown[], unknown]> = [];

      const cached = qc.getQueriesData<SchoolNotificationListResponse>({
        queryKey: ["notifications", "list"],
      });
      for (const [key, value] of cached) {
        if (!value) continue;
        const found = value.rows.find((r) => r.id === id);
        if (!found || !found.readAt) continue;
        snapshots.push([key, value]);
        qc.setQueryData<SchoolNotificationListResponse>(key, {
          ...value,
          rows: value.rows.map((r) =>
            r.id === id ? { ...r, readAt: null } : r,
          ),
          unreadCount: value.unreadCount + 1,
        });
      }

      const prevUnread = qc.getQueryData<{ count: number }>(
        notificationKeys.unreadCount,
      );
      if (prevUnread) {
        snapshots.push([notificationKeys.unreadCount, prevUnread]);
        qc.setQueryData(notificationKeys.unreadCount, {
          count: prevUnread.count + 1,
        });
      }

      const detailKey = notificationKeys.detail(id);
      const prevDetail = qc.getQueryData<SchoolNotificationDetailRow>(detailKey);
      if (prevDetail && prevDetail.readAt) {
        snapshots.push([detailKey, prevDetail]);
        qc.setQueryData(detailKey, { ...prevDetail, readAt: null });
      }

      return { snapshots };
    },
    onError: (_err, _id, ctx) => {
      if (!ctx) return;
      for (const [key, value] of ctx.snapshots) {
        qc.setQueryData(key, value);
      }
    },
  });
}

interface MarkAllReadContext {
  snapshots: Array<[readonly unknown[], unknown]>;
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation<{ count: number }, ApiError, void, MarkAllReadContext>({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: notificationKeys.all });
      const snapshots: Array<[readonly unknown[], unknown]> = [];
      const now = new Date().toISOString();

      // Flip every list entry's unread rows in cache.
      const cached = qc.getQueriesData<SchoolNotificationListResponse>({
        queryKey: ["notifications", "list"],
      });
      for (const [key, value] of cached) {
        if (!value) continue;
        const hasUnread = value.rows.some((r) => !r.readAt);
        if (!hasUnread && value.unreadCount === 0) continue;
        snapshots.push([key, value]);
        qc.setQueryData<SchoolNotificationListResponse>(key, {
          ...value,
          rows: value.rows.map((r) => (r.readAt ? r : { ...r, readAt: now })),
          unreadCount: 0,
        });
      }

      // Zero the badge.
      const prevUnread = qc.getQueryData<{ count: number }>(
        notificationKeys.unreadCount,
      );
      if (prevUnread && prevUnread.count > 0) {
        snapshots.push([notificationKeys.unreadCount, prevUnread]);
        qc.setQueryData(notificationKeys.unreadCount, { count: 0 });
      }

      return { snapshots };
    },
    onError: (_err, _v, ctx) => {
      if (!ctx) return;
      for (const [key, value] of ctx.snapshots) {
        qc.setQueryData(key, value);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Cross-tab nudge — kept from the previous implementation so writes
// in tab A invalidate caches in tab B.
//
// Setup is in the QueryProvider at app boot via useNotificationsCrossTabSync,
// or any component (idempotent) — adding a listener twice is fine,
// React Query's invalidateQueries dedupes the resulting refetches.
// ---------------------------------------------------------------------------

const NOTIFICATIONS_TICK_KEY = "scholaris:notifications:tick";

export function pingNotificationsAcrossTabs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIFICATIONS_TICK_KEY, String(Date.now()));
  } catch {
    /* storage unavailable — skip */
  }
}

/**
 * Mount this hook ONCE inside the QueryClient subtree (e.g. from
 * NotificationsBell). Listens for the cross-tab sentinel and
 * invalidates the notifications root key when another tab signals.
 */
export function useNotificationsCrossTabSync() {
  const qc = useQueryClient();
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== NOTIFICATIONS_TICK_KEY) return;
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [qc]);
}

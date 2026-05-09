"use client";

import * as React from "react";
import { api } from "./api";
import { getToken } from "./auth";

// ---------------------------------------------------------------------------
// School-side notifications client + context — Phase 20.
//
// Two surfaces use this file:
//
//   • The /notifications inbox page (full list, drawer, filters).
//   • The topbar NotificationsBell (live unread counter + dropdown
//     preview).
//
// The provider is mounted ONCE in the dashboard layout. It owns:
//   • The unread counter (polled every 30s).
//   • An optimistic mark-read helper that bumps the counter
//     immediately so the bell updates without round-tripping.
//
// Why polling and not WebSockets / SSE: spec explicitly defers
// real-time. 30s is fast enough that the UI feels live without
// new infrastructure.
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
  /** True when targeted to this user vs school-wide broadcast. */
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

export const notificationsApi = {
  list: (query: NotificationListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.severity && query.severity.length > 0) {
      params.set("severity", query.severity.join(","));
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
// Provider — owns the live unread counter for the topbar bell.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000;

interface NotificationsContextValue {
  unreadCount: number;
  /**
   * Refresh the counter immediately. Called by the inbox page after
   * a mutation so the bell stays in sync.
   */
  refresh: () => Promise<void>;
  /**
   * Optimistic delta — call with -1 after mark-read, +1 after
   * mark-unread, -N after mark-all-read. Saves a round-trip when
   * we already know the result.
   */
  bumpUnread: (delta: number) => void;
}

const NotificationsContext =
  React.createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [unreadCount, setUnreadCount] = React.useState(0);

  const refresh = React.useCallback(async () => {
    if (!getToken()) return;
    try {
      const result = await notificationsApi.unreadCount();
      setUnreadCount(result.count);
    } catch {
      // Silent — the bell just doesn't update. Fewer log lines
      // than complaining on every poll tick when offline.
    }
  }, []);

  const bumpUnread = React.useCallback((delta: number) => {
    setUnreadCount((prev) => Math.max(0, prev + delta));
  }, []);

  React.useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Cross-tab sync: when another tab changes the unread count
  // (e.g., user marks read on /notifications in tab A, the bell
  // in tab B should update). Triggered by writes to a sentinel
  // localStorage key from the inbox page.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === NOTIFICATIONS_TICK_KEY) void refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const value = React.useMemo<NotificationsContextValue>(
    () => ({ unreadCount, refresh, bumpUnread }),
    [unreadCount, refresh, bumpUnread],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = React.useContext(NotificationsContext);
  if (ctx) return ctx;
  // Standalone fallback for code paths that don't mount the
  // provider (e.g., login page). Returns a no-op shape.
  return {
    unreadCount: 0,
    refresh: async () => {},
    bumpUnread: () => {},
  };
}

const NOTIFICATIONS_TICK_KEY = "scholaris:notifications:tick";

/**
 * Cross-tab nudge — writes a sentinel timestamp to localStorage
 * so other tabs' NotificationsProvider instances refetch the
 * unread counter. Called by the inbox page after any mutation.
 */
export function pingNotificationsAcrossTabs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIFICATIONS_TICK_KEY, String(Date.now()));
  } catch {
    /* storage unavailable — skip */
  }
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Info,
  Inbox,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  notificationsApi,
  pingNotificationsAcrossTabs,
  useNotifications,
  type NotificationSeverity,
  type SchoolNotificationListRow,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// NotificationsBell — Phase 20.
//
// Topbar bell with:
//   • live unread badge (from NotificationsProvider, polled every 30s)
//   • dropdown preview panel (latest 8 rows, fetched on first open
//     and refreshed each subsequent open)
//   • "Mark all read" affordance
//   • "View all" link → /notifications
//
// Optimistic mark-read on row click: we PATCH /notifications/:id/read,
// flip local state immediately, AND bump the provider's counter so
// the badge updates without a round-trip. Cross-tab nudge via
// localStorage so other tabs converge.
// ---------------------------------------------------------------------------

const PREVIEW_LIMIT = 8;

const SEVERITY_DOT: Record<NotificationSeverity, string> = {
  INFO: "bg-sky-500",
  SUCCESS: "bg-emerald-500",
  WARNING: "bg-amber-500",
  ERROR: "bg-red-500",
  CRITICAL: "bg-red-600",
};

const SEVERITY_ICON: Record<
  NotificationSeverity,
  React.ComponentType<{ className?: string }>
> = {
  INFO: Info,
  SUCCESS: CheckCheck,
  WARNING: AlertTriangle,
  ERROR: ShieldAlert,
  CRITICAL: ShieldAlert,
};

export function NotificationsBell() {
  const { unreadCount, refresh, bumpUnread } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<SchoolNotificationListRow[]>([]);
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Outside-click + Escape to close — same pattern as other topbar
  // dropdowns.
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /**
   * Fetch the preview list. Called on every open — cheap because
   * we cap at PREVIEW_LIMIT and the table is well-indexed by
   * (createdAt DESC).
   */
  const loadPreview = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await notificationsApi.list({ pageSize: PREVIEW_LIMIT });
      setItems(result.rows);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load notifications.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [open, loadPreview]);

  const onRowClick = async (row: SchoolNotificationListRow) => {
    if (row.readAt) return; // already read — nothing to do
    // Optimistic flip on the local list + provider counter.
    setItems((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, readAt: new Date().toISOString() } : r,
      ),
    );
    bumpUnread(-1);
    try {
      await notificationsApi.markRead(row.id);
      pingNotificationsAcrossTabs();
    } catch {
      // Roll back on failure — refresh from the server so we have
      // ground truth.
      void refresh();
      void loadPreview();
    }
  };

  const onMarkAllRead = async () => {
    if (unreadCount === 0) return;
    // Optimistic — flip every row in the preview + zero the badge.
    const previousUnread = unreadCount;
    setItems((prev) =>
      prev.map((r) =>
        r.readAt ? r : { ...r, readAt: new Date().toISOString() },
      ),
    );
    bumpUnread(-previousUnread);
    try {
      await notificationsApi.markAllRead();
      pingNotificationsAcrossTabs();
    } catch {
      void refresh();
      void loadPreview();
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
            : "Notifications"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white ring-2 ring-surface tabular-nums",
            )}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[380px] max-w-[calc(100vw-1.5rem)] origin-top-right rounded-lg border border-border bg-surface shadow-xl animate-scale-in"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Notifications
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : "You're all caught up"}
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-[11px] font-medium text-primary hover:underline focus-ring rounded"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}

            {error && (
              <div className="px-4 py-3 text-xs text-destructive">{error}</div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Inbox className="h-4 w-4" />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">
                  No notifications
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Activity from your school will appear here.
                </p>
              </div>
            )}

            {items.length > 0 && (
              <ul className="divide-y divide-border">
                {items.map((row) => (
                  <PreviewRow
                    key={row.id}
                    row={row}
                    onClick={() => void onRowClick(row)}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border px-2 py-2">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block w-full rounded-md px-2.5 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PreviewRow({
  row,
  onClick,
  onNavigate,
}: {
  row: SchoolNotificationListRow;
  onClick: () => void;
  onNavigate: () => void;
}) {
  const Icon = SEVERITY_ICON[row.severity];
  const unread = !row.readAt;
  return (
    <li>
      <Link
        href={`/notifications?id=${encodeURIComponent(row.id)}`}
        onClick={() => {
          onClick();
          onNavigate();
        }}
        className={cn(
          "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60",
          unread && "bg-primary/5",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ring-border/40 text-muted-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {unread && (
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  SEVERITY_DOT[row.severity],
                )}
                aria-hidden
              />
            )}
            <p
              className={cn(
                "truncate text-sm leading-snug",
                unread
                  ? "font-semibold text-foreground"
                  : "font-medium text-foreground/80",
              )}
            >
              {row.title}
            </p>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground leading-snug">
            {row.body}
          </p>
          <p className="mt-1 text-[10px] tabular-nums text-muted-foreground/80">
            {timeAgo(row.createdAt)}
          </p>
        </div>
      </Link>
    </li>
  );
}

function timeAgo(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

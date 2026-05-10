"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Info,
  Loader2,
  ShieldAlert,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  pingNotificationsAcrossTabs,
  useMarkAllRead,
  useMarkRead,
  useMarkUnread,
  useNotificationDetail,
  useNotificationList,
  type NotificationSeverity,
  type SchoolNotificationListRow,
} from "@/lib/notifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /notifications — Phase 20 inbox (rebuilt on React Query).
//
// Shared cache via notificationKeys.list(filters) — bell preview
// + this page hit the same query when filter shapes match. Different
// filter shapes get different keys + their own cache entries; the
// previous page stays visible during pagination via placeholderData.
//
// Mutations (mark read, mark unread, mark all read) flip the cache
// optimistically. The bell badge updates synchronously because it
// reads from the same shared unread-count cache.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const SEVERITY_OPTIONS: ReadonlyArray<{
  key: NotificationSeverity;
  label: string;
}> = [
  { key: "INFO", label: "Info" },
  { key: "SUCCESS", label: "Success" },
  { key: "WARNING", label: "Warning" },
  { key: "ERROR", label: "Error" },
  { key: "CRITICAL", label: "Critical" },
];

const SEVERITY_TONE: Record<
  NotificationSeverity,
  { dot: string; tint: string; ring: string; label: string }
> = {
  INFO: {
    dot: "bg-sky-500",
    tint: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    ring: "ring-sky-200 dark:ring-sky-900",
    label: "Info",
  },
  SUCCESS: {
    dot: "bg-emerald-500",
    tint: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    ring: "ring-emerald-200 dark:ring-emerald-900",
    label: "Success",
  },
  WARNING: {
    dot: "bg-amber-500",
    tint: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    ring: "ring-amber-200 dark:ring-amber-900",
    label: "Warning",
  },
  ERROR: {
    dot: "bg-red-500",
    tint: "bg-red-500/10 text-red-700 dark:text-red-400",
    ring: "ring-red-200 dark:ring-red-900",
    label: "Error",
  },
  CRITICAL: {
    dot: "bg-red-600",
    tint: "bg-red-600/15 text-red-800 dark:text-red-300",
    ring: "ring-red-300 dark:ring-red-900",
    label: "Critical",
  },
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

export default function NotificationsPage() {
  const searchParams = useSearchParams();
  const initialId = searchParams?.get("id") ?? null;

  const [severity, setSeverity] = React.useState<NotificationSeverity[]>([]);
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);

  const [selectedId, setSelectedId] = React.useState<string | null>(initialId);

  // Reset to page 1 when filters change. State, not derived — so
  // the user can navigate forward/back within the same filter set.
  React.useEffect(() => {
    setPage(1);
  }, [severity, unreadOnly]);

  // List query — shared key with the bell when filters happen to
  // match. Same network call dedupes via React Query.
  const filters = React.useMemo(
    () => ({
      severity: severity.length > 0 ? severity : undefined,
      unreadOnly: unreadOnly || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    [severity, unreadOnly, page],
  );
  const {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useNotificationList(filters);

  // Detail query — lazy on selectedId.
  const {
    data: detail,
    isLoading: detailLoading,
  } = useNotificationDetail(selectedId);

  const markRead = useMarkRead();
  const markUnread = useMarkUnread();
  const markAllRead = useMarkAllRead();

  // When the user opens a row, mark it read (if unread). The
  // mutation's onMutate handles the cache flip — no manual state.
  const openDetail = (id: string) => {
    setSelectedId(id);
    const existing = data?.rows.find((r) => r.id === id);
    if (existing && !existing.readAt) {
      markRead.mutate(id, {
        onSuccess: () => pingNotificationsAcrossTabs(),
      });
    }
  };

  const toggleSelectedRead = () => {
    if (!detail) return;
    if (detail.readAt) {
      markUnread.mutate(detail.id, {
        onSuccess: () => pingNotificationsAcrossTabs(),
      });
    } else {
      markRead.mutate(detail.id, {
        onSuccess: () => pingNotificationsAcrossTabs(),
      });
    }
  };

  const onMarkAllRead = () => {
    if (!data || data.unreadCount === 0) return;
    markAllRead.mutate(undefined, {
      onSuccess: (result) => {
        toast.success(
          result.count === 0
            ? "All caught up."
            : `Marked ${result.count} as read.`,
        );
        pingNotificationsAcrossTabs();
      },
      onError: (e) => {
        toast.error(e.message ?? "Failed to mark all read.");
      },
    });
  };

  const grouped = React.useMemo(() => {
    if (!data) return [];
    return groupByDay(data.rows);
  }, [data]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / PAGE_SIZE))
    : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data
              ? `${data.unreadCount} unread of ${data.total} total`
              : "Activity from your school."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => void refetch()}
            disabled={isFetching}
            leftIcon={
              <Loader2
                className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
              />
            }
          >
            Refresh
          </Button>
          <Button
            onClick={onMarkAllRead}
            disabled={
              !data || data.unreadCount === 0 || markAllRead.isPending
            }
            leftIcon={
              markAllRead.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )
            }
          >
            Mark all read
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <SeverityMultiSelect value={severity} onChange={setSeverity} />
          <label className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Unread only
          </label>
          {(severity.length > 0 || unreadOnly) && (
            <button
              type="button"
              onClick={() => {
                setSeverity([]);
                setUnreadOnly(false);
              }}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear filters
            </button>
          )}
          {data && (
            <span className="ml-auto text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
          )}
        </CardContent>
      </Card>

      {isLoading && !data ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error?.message ?? "Failed to load notifications."}
          </CardContent>
        </Card>
      ) : !data || grouped.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-base font-semibold text-foreground">
              {severity.length > 0 || unreadOnly
                ? "Nothing matches these filters"
                : "No notifications"}
            </p>
            <p className="text-sm text-muted-foreground">
              {severity.length > 0 || unreadOnly
                ? "Try widening the filters."
                : "Activity from your school will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <Card key={g.label}>
              <CardHeader>
                <CardTitle className="text-sm">{g.label}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {g.rows.map((row) => (
                    <NotificationRow
                      key={row.id}
                      row={row}
                      onClick={() => openDetail(row.id)}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}

          {data.total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                leftIcon={<ChevronLeft className="h-3 w-3" />}
              >
                Prev
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                rightIcon={<ChevronRight className="h-3 w-3" />}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}

      <DetailDrawer
        open={!!selectedId}
        notification={detail ?? null}
        loading={detailLoading}
        onClose={() => setSelectedId(null)}
        onToggleRead={toggleSelectedRead}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function NotificationRow({
  row,
  onClick,
}: {
  row: SchoolNotificationListRow;
  onClick: () => void;
}) {
  const Icon = SEVERITY_ICON[row.severity];
  const tone = SEVERITY_TONE[row.severity];
  const unread = !row.readAt;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40",
          unread && "bg-primary/5",
        )}
      >
        <span
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset",
            tone.tint,
            tone.ring,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {unread && (
              <span
                className={cn(
                  "inline-block h-2 w-2 shrink-0 rounded-full",
                  tone.dot,
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
            {row.targetedToMe ? null : (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                School-wide
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground leading-snug">
            {row.body}
          </p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/80">
          {timeOnly(row.createdAt)}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function DetailDrawer({
  open,
  notification,
  loading,
  onClose,
  onToggleRead,
}: {
  open: boolean;
  notification: ReturnType<typeof useNotificationDetail>["data"] extends infer T | undefined
    ? Exclude<T, undefined> | null
    : never;
  loading: boolean;
  onClose: () => void;
  onToggleRead: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          {loading || !notification ? (
            <div className="flex h-10 w-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    SEVERITY_TONE[notification.severity].tint,
                  )}
                >
                  {SEVERITY_TONE[notification.severity].label}
                </span>
                {notification.targetedToMe ? null : (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    School-wide
                  </span>
                )}
              </div>
              <h2 className="mt-1.5 text-base font-semibold text-foreground">
                {notification.title}
              </h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {new Date(notification.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {notification && !loading && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <div>
              <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
                {notification.body}
              </p>
            </div>

            {notification.deliveries.length > 0 && (
              <Section label="Delivery">
                <ul className="space-y-1.5">
                  {notification.deliveries.map((d, i) => (
                    <li
                      key={`${d.channel}-${i}`}
                      className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {d.channel}
                      </span>
                      <span className="text-foreground/80">{d.status}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section label="Reference">
              <code className="block rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                {notification.templateKey}
              </code>
            </Section>
          </div>
        )}

        {notification && (
          <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleRead}
              leftIcon={
                notification.readAt ? (
                  <Undo2 className="h-3 w-3" />
                ) : (
                  <CheckCheck className="h-3 w-3" />
                )
              }
            >
              {notification.readAt ? "Mark unread" : "Mark read"}
            </Button>
            <Button onClick={onClose} size="sm">
              Done
            </Button>
          </footer>
        )}
      </aside>
    </>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity multi-select
// ---------------------------------------------------------------------------

function SeverityMultiSelect({
  value,
  onChange,
}: {
  value: NotificationSeverity[];
  onChange: (next: NotificationSeverity[]) => void;
}) {
  const toggle = (s: NotificationSeverity) => {
    onChange(value.includes(s) ? value.filter((v) => v !== s) : [...value, s]);
  };
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5">
      {SEVERITY_OPTIONS.map((opt) => {
        const active = value.includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => toggle(opt.key)}
            className={cn(
              "rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
              active
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DayGroup {
  label: string;
  rows: SchoolNotificationListRow[];
}

function groupByDay(rows: SchoolNotificationListRow[]): DayGroup[] {
  const todayKey = dayKey(new Date());
  const yesterdayKey = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const groups = new Map<string, DayGroup>();
  for (const r of rows) {
    const k = dayKey(new Date(r.createdAt));
    const label =
      k === todayKey
        ? "Today"
        : k === yesterdayKey
          ? "Yesterday"
          : new Date(r.createdAt).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            });
    const existing = groups.get(k);
    if (existing) existing.rows.push(r);
    else groups.set(k, { label, rows: [r] });
  }
  return [...groups.values()];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

void Bell;

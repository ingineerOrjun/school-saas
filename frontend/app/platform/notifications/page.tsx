"use client";

import * as React from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Inbox,
  Mail,
  RotateCw,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type NotificationDetailRow,
  type NotificationListResponse,
  type NotificationListRow,
  type NotificationSeverity,
} from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  FilterToolbar,
  PageHeader,
  PanelEmptyState,
  PanelErrorState,
  PanelLoadingState,
  SectionCard,
  SkeletonRows,
  StatusPill,
  type PillTone,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform/notifications — Phase 14 Notification Center.
//
// Layout:
//   • Header + filter toolbar (severity multi-select + unread toggle).
//   • Grouped list (today / yesterday / earlier).
//   • Side drawer with full row detail + per-channel deliveries.
//   • Mark read on row click; mark unread via the drawer footer.
//
// Polling:
//   No live updates yet (the spec calls for "real-time-ready
//   architecture" — we'll wire SSE/WebSocket in a future iteration).
//   For now the operator hits Refresh; the bell badge stays in
//   sync via the topbar's own poll.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const SEVERITY_TONE: Record<NotificationSeverity, PillTone> = {
  INFO: "default",
  SUCCESS: "success",
  WARNING: "warning",
  ERROR: "danger",
  CRITICAL: "danger",
};

const SEVERITY_OPTIONS: ReadonlyArray<NotificationSeverity> = [
  "INFO",
  "SUCCESS",
  "WARNING",
  "ERROR",
  "CRITICAL",
];

export default function PlatformNotificationsPage() {
  const [data, setData] = React.useState<NotificationListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState("");
  const [severity, setSeverity] = React.useState<NotificationSeverity[]>([]);
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);

  const [selected, setSelected] = React.useState<NotificationDetailRow | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = React.useState(false);

  const load = React.useCallback(
    async (initial: boolean) => {
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const result = await platformApi.listNotifications({
          severity: severity.length > 0 ? severity : undefined,
          unreadOnly,
          page,
          pageSize: PAGE_SIZE,
        });
        setData(result);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load notifications.",
        );
      } finally {
        if (initial) setLoading(false);
        setRefreshing(false);
      }
    },
    [severity, unreadOnly, page],
  );

  React.useEffect(() => {
    void load(true);
  }, [load]);

  // Reset to page 1 when filters change.
  React.useEffect(() => {
    setPage(1);
  }, [severity, unreadOnly]);

  const openDetail = React.useCallback(
    async (row: NotificationListRow) => {
      setDetailLoading(true);
      try {
        const detail = await platformApi.getNotification(row.id);
        setSelected(detail);
        // Mark read on open. Optimistic — patch local list state too.
        if (!detail.readAt) {
          await platformApi
            .markNotificationRead(row.id)
            .catch(() => {
              /* swallow — list refresh will reconcile */
            });
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  rows: prev.rows.map((r) =>
                    r.id === row.id
                      ? { ...r, readAt: new Date().toISOString() }
                      : r,
                  ),
                  unreadCount: Math.max(0, prev.unreadCount - 1),
                }
              : prev,
          );
        }
      } catch (e) {
        toast.error(
          e instanceof ApiError ? e.message : "Failed to load notification.",
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  const toggleRead = async () => {
    if (!selected) return;
    try {
      const updated = selected.readAt
        ? await platformApi.markNotificationUnread(selected.id)
        : await platformApi.markNotificationRead(selected.id);
      setSelected({ ...selected, readAt: updated.readAt });
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((r) =>
                r.id === selected.id ? { ...r, readAt: updated.readAt } : r,
              ),
              unreadCount: updated.readAt
                ? Math.max(0, prev.unreadCount - 1)
                : prev.unreadCount + 1,
            }
          : prev,
      );
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Failed to update notification.",
      );
    }
  };

  const grouped = React.useMemo(() => {
    if (!data) return [];
    const filtered = search
      ? data.rows.filter(
          (r) =>
            r.title.toLowerCase().includes(search.toLowerCase()) ||
            r.templateKey.toLowerCase().includes(search.toLowerCase()),
        )
      : data.rows;
    return groupByDay(filtered);
  }, [data, search]);

  const activeFilters = [
    ...severity.map((s) => ({
      label: `Severity: ${s}`,
      onClear: () => setSeverity((cur) => cur.filter((v) => v !== s)),
    })),
    ...(unreadOnly
      ? [{ label: "Unread only", onClear: () => setUnreadOnly(false) }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description={
          data ? `${data.unreadCount} unread of ${data.total} total` : undefined
        }
        icon={<Bell className="h-4 w-4" />}
        actions={
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            Refresh
          </button>
        }
      />

      <FilterToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Filter by title or template…"
        activeFilters={activeFilters}
        onClearAll={
          activeFilters.length > 0
            ? () => {
                setSeverity([]);
                setUnreadOnly(false);
              }
            : undefined
        }
      >
        <SeverityMultiSelect value={severity} onChange={setSeverity} />
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Unread only
        </label>
      </FilterToolbar>

      {loading ? (
        <SectionCard bare>
          <SkeletonRows rows={8} />
        </SectionCard>
      ) : error ? (
        <PanelErrorState message={error} onRetry={() => void load(true)} />
      ) : !data || grouped.length === 0 ? (
        <SectionCard bare>
          <PanelEmptyState
            icon={<Inbox className="h-4 w-4" />}
            title={
              activeFilters.length > 0 || search
                ? "No notifications match these filters"
                : "Inbox zero"
            }
            description={
              activeFilters.length > 0 || search
                ? "Try widening the search or clearing the filters."
                : "Platform events will land here as they happen."
            }
          />
        </SectionCard>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <SectionCard
              key={g.label}
              title={g.label}
              description={`${g.rows.length} event${g.rows.length === 1 ? "" : "s"}`}
              icon={<Inbox className="h-3.5 w-3.5" />}
              bodyClassName="p-0"
            >
              <ul className="divide-y divide-slate-100">
                {g.rows.map((row) => (
                  <NotificationRow
                    key={row.id}
                    row={row}
                    onOpen={() => void openDetail(row)}
                  />
                ))}
              </ul>
            </SectionCard>
          ))}

          {data.total > PAGE_SIZE && (
            <Pagination
              page={page}
              total={data.total}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          )}
        </div>
      )}

      <DetailDrawer
        notification={selected}
        loading={detailLoading}
        onClose={() => setSelected(null)}
        onToggleRead={toggleRead}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function NotificationRow({
  row,
  onOpen,
}: {
  row: NotificationListRow;
  onOpen: () => void;
}) {
  const unread = !row.readAt;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50",
          unread && "bg-sky-50/30",
        )}
      >
        <span
          className={cn(
            "mt-1 inline-block h-2 w-2 shrink-0 rounded-full",
            unread ? "bg-sky-500" : "bg-transparent",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                "truncate text-sm",
                unread
                  ? "font-semibold text-slate-900"
                  : "font-medium text-slate-700",
              )}
            >
              {row.title}
            </p>
            <StatusPill tone={SEVERITY_TONE[row.severity]} size="xs" uppercase>
              {row.severity}
            </StatusPill>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 font-mono">
            {row.templateKey}
            {row.lastDeliveryStatus && (
              <span className="text-slate-400">
                {" "}
                · last delivery: {row.lastDeliveryStatus}
              </span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
          {timeOnly(row.createdAt)}
        </span>
      </button>
    </li>
  );
}

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
    <div className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-0.5">
      {SEVERITY_OPTIONS.map((s) => {
        const active = value.includes(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            className={cn(
              "rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors",
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
            title={`Filter to ${s}`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DetailDrawer({
  notification,
  loading,
  onClose,
  onToggleRead,
}: {
  notification: NotificationDetailRow | null;
  loading: boolean;
  onClose: () => void;
  onToggleRead: () => void;
}) {
  React.useEffect(() => {
    if (!notification) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notification, onClose]);

  if (!notification && !loading) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          {loading || !notification ? (
            <PanelLoadingState size="compact" />
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <StatusPill
                  tone={SEVERITY_TONE[notification.severity]}
                  size="xs"
                  uppercase
                >
                  {notification.severity}
                </StatusPill>
                <p className="text-[10px] font-mono text-slate-400">
                  {notification.templateKey}
                </p>
              </div>
              <h2 className="mt-1.5 text-base font-semibold text-slate-900">
                {notification.title}
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
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
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {notification && !loading && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            <Section label="Deliveries">
              {notification.deliveries.length === 0 ? (
                <p className="text-xs text-slate-500 italic">
                  No deliveries on file.
                </p>
              ) : (
                <ul className="space-y-2">
                  {notification.deliveries.map((d) => (
                    <li
                      key={d.id}
                      className="rounded-md border border-slate-200 bg-slate-50/30 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs">
                          <Mail className="h-3 w-3 text-slate-400" />
                          <span className="font-mono text-[11px] text-slate-500">
                            {d.channel}
                          </span>
                          <span className="text-slate-700">{d.recipient}</span>
                        </div>
                        <DeliveryStatusPill status={d.status} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                        <span>Attempts: {d.attempts}</span>
                        {d.sentAt && <span>Sent: {timeOnly(d.sentAt)}</span>}
                        {d.providerMessageId && (
                          <span className="font-mono truncate">
                            {d.providerMessageId}
                          </span>
                        )}
                      </div>
                      {d.errorMessage && (
                        <p className="mt-1 rounded bg-red-50 px-2 py-1 text-[10px] text-red-700 font-mono whitespace-pre-wrap break-words">
                          {d.errorMessage}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section label="Payload">
              <pre className="max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-700">
                {JSON.stringify(notification.payload, null, 2)}
              </pre>
            </Section>

            {notification.dedupeKey && (
              <Section label="Dedupe key">
                <code className="block rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700">
                  {notification.dedupeKey}
                </code>
              </Section>
            )}

            {notification.schoolId && (
              <Section label="Linked school">
                <a
                  href={`/platform/schools/${encodeURIComponent(notification.schoolId)}`}
                  className="text-xs text-slate-700 hover:text-slate-900 hover:underline"
                >
                  Open school detail →
                </a>
              </Section>
            )}
          </div>
        )}

        {notification && (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              onClick={onToggleRead}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {notification.readAt ? (
                <>
                  <Undo2 className="h-3 w-3" />
                  Mark unread
                </>
              ) : (
                <>
                  <CheckCheck className="h-3 w-3" />
                  Mark read
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Done
            </button>
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
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      {children}
    </div>
  );
}

function DeliveryStatusPill({ status }: { status: string }) {
  const tone: PillTone =
    status === "SENT"
      ? "success"
      : status === "FAILED"
        ? "danger"
        : status === "SENDING"
          ? "info"
          : status === "SKIPPED"
            ? "muted"
            : "default";
  return (
    <StatusPill tone={tone} size="xs" uppercase>
      {status}
    </StatusPill>
  );
}

// ---------------------------------------------------------------------------

function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (next: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
      <span className="text-slate-500">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40 hover:bg-slate-50"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="rounded border border-slate-200 px-2 py-0.5 disabled:opacity-40 hover:bg-slate-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DayGroup {
  label: string;
  rows: NotificationListRow[];
}

function groupByDay(rows: NotificationListRow[]): DayGroup[] {
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
  // Already ordered newest-first because the source rows are.
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

// Unused imports kept until DetailDrawer copies/icons are finalised.
void Check;

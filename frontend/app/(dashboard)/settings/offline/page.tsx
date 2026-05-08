"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CloudOff,
  Database,
  Loader2,
  RefreshCcw,
  RotateCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getStoredUser, type Role, type SafeUser } from "@/lib/auth";
import {
  deleteById,
  listAll,
  retryItem,
  type QueueItem,
  type QueueStatus,
} from "@/lib/offline-queue";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useCalendarMode } from "@/components/calendar/CalendarProvider";
import { formatByMode } from "@/lib/date";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

const ALLOWED_ROLES: Role[] = ["ADMIN"];

/**
 * Settings → Offline Queue Inspector.
 *
 * Admin-only diagnostic surface for the IndexedDB attendance queue.
 * Lists every item across PENDING / SYNCED / FAILED states with the
 * server-side error messages that escalated FAILED items, plus
 * per-row Retry and Delete plus a top-level Retry-All / Sync-Now.
 *
 * The inspector subscribes to the sync engine's state so the table
 * refreshes automatically when items transition (e.g., a background
 * sync completes while the admin is reading the list).
 */
export default function OfflineInspectorPage() {
  const [user, setUser] = React.useState<SafeUser | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setUser(getStoredUser());
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return <PageSkeleton />;
  }
  if (!user) {
    // Layout's auth gate redirects in this case — defensive.
    return <PageSkeleton />;
  }
  if (!ALLOWED_ROLES.includes(user.role)) {
    return <RestrictedPanel role={user.role} />;
  }

  return <Inspector />;
}

function Inspector() {
  const online = useOnlineStatus();
  const { state: syncState, runManualSync, retryFailed: retryAllFailed } =
    useSyncEngine();
  const calendarMode = useCalendarMode();

  const [items, setItems] = React.useState<QueueItem[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  // Per-row spinner — Set so multiple actions can run concurrently.
  const [actioningIds, setActioningIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  /** Pull the full queue from IndexedDB. Cheap — bounded set size. */
  const reload = React.useCallback(async () => {
    try {
      const all = await listAll();
      setItems(all);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to read offline queue.",
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load.
  React.useEffect(() => {
    void reload();
  }, [reload]);

  // Re-load whenever the sync engine reports state changes — covers
  // the case where a background sync finishes while the inspector is
  // open (we want PENDING rows to immediately move to SYNCED visually).
  // We key off `pendingCount` + `lastResult` rather than the whole
  // state object so a fresh `running: true → false` transition with no
  // count change still triggers a refresh.
  const pendingSnapshot = syncState.pendingCount;
  const lastResultStamp = syncState.lastResult
    ? `${syncState.lastResult.attempted}-${syncState.lastResult.synced}-${syncState.lastResult.failed}`
    : null;
  React.useEffect(() => {
    void reload();
  }, [pendingSnapshot, lastResultStamp, reload]);

  // ----- Per-row actions -----
  const beginAction = (id: string) =>
    setActioningIds((prev) => new Set(prev).add(id));
  const endAction = (id: string) =>
    setActioningIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const handleRetryRow = async (item: QueueItem) => {
    beginAction(item.id);
    try {
      await retryItem(item.id);
      // Optimistic local update: flip the row to PENDING immediately
      // so the table doesn't appear frozen while the sync runs.
      setItems((prev) =>
        prev?.map((r) =>
          r.id === item.id
            ? { ...r, status: "PENDING", retryCount: 0, lastError: undefined }
            : r,
        ) ?? prev,
      );
      // Trigger a full sync — engine processes the now-PENDING row.
      void runManualSync();
      toast.success("Queued for retry.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't retry that item.",
      );
    } finally {
      endAction(item.id);
    }
  };

  const handleDeleteRow = async (item: QueueItem) => {
    if (
      !window.confirm(
        item.status === "PENDING"
          ? "Delete this PENDING item? It will NOT be sent to the server."
          : "Delete this item from the local queue?",
      )
    ) {
      return;
    }
    beginAction(item.id);
    try {
      await deleteById(item.id);
      setItems((prev) => prev?.filter((r) => r.id !== item.id) ?? prev);
      toast.success("Item removed from queue.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't delete that item.",
      );
    } finally {
      endAction(item.id);
    }
  };

  // ----- Top-level actions -----
  const [topActionInFlight, setTopActionInFlight] = React.useState<
    "sync" | "retry-all" | null
  >(null);

  const handleSyncNow = async () => {
    setTopActionInFlight("sync");
    try {
      const result = await runManualSync();
      if (result.skipped && result.reason === "offline") {
        toast.error("Offline. Will sync when you're back online.");
      } else if (result.skipped && result.reason === "no-pending") {
        toast.success("Nothing to sync — you're up to date.");
      } else if (result.failed > 0) {
        toast.error(
          `Synced ${result.synced}/${result.attempted} — ${result.failed} failed.`,
        );
      } else if (result.synced > 0) {
        toast.success(
          `Synced ${result.synced} item${result.synced === 1 ? "" : "s"}.`,
        );
      }
    } finally {
      setTopActionInFlight(null);
    }
  };

  const handleRetryAll = async () => {
    setTopActionInFlight("retry-all");
    try {
      // `retryAllFailed` (from useSyncEngine) handles the full
      // sequence: move every FAILED → PENDING (clears retryCount /
      // lastError), refresh the count, then drain the queue. The
      // returned `SyncResult` is what we narrate via toast below.
      const result = await retryAllFailed();
      if (result.synced > 0) {
        toast.success(
          `Retried — ${result.synced} item${result.synced === 1 ? "" : "s"} synced.`,
        );
      } else if (result.failed > 0) {
        toast.error(
          `Retry attempted but ${result.failed} item${result.failed === 1 ? "" : "s"} still failing.`,
        );
      } else {
        toast.message("Nothing to retry.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Retry-all failed.",
      );
    } finally {
      setTopActionInFlight(null);
    }
  };

  // ----- Counts for the summary strip -----
  const counts = React.useMemo(() => {
    const c = { total: 0, pending: 0, synced: 0, failed: 0 };
    if (!items) return c;
    for (const i of items) {
      c.total += 1;
      if (i.status === "PENDING") c.pending += 1;
      else if (i.status === "SYNCED") c.synced += 1;
      else if (i.status === "FAILED") c.failed += 1;
    }
    return c;
  }, [items]);

  return (
    <div className="space-y-6 animate-fade-in">
      <Header />

      {/* ---------- Counts + top actions ---------- */}
      <section className="rounded-xl border border-border bg-surface p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Stat label="Total" value={counts.total} tone="neutral" />
          <Stat label="Pending" value={counts.pending} tone="emerald" />
          <Stat label="Failed" value={counts.failed} tone="destructive" />
          <Stat label="Synced" value={counts.synced} tone="muted" />
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {online ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Online
              </>
            ) : (
              <>
                <CloudOff className="h-3.5 w-3.5 text-destructive" />
                Offline
              </>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={handleSyncNow}
            disabled={!online || topActionInFlight !== null || syncState.running}
            loading={topActionInFlight === "sync" || syncState.running}
            leftIcon={
              topActionInFlight === "sync" || syncState.running ? undefined : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )
            }
            size="sm"
          >
            Sync now
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRetryAll}
            disabled={
              !online ||
              topActionInFlight !== null ||
              syncState.running ||
              counts.failed === 0
            }
            loading={topActionInFlight === "retry-all"}
            leftIcon={
              topActionInFlight === "retry-all" ? undefined : (
                <RotateCw className="h-3.5 w-3.5" />
              )
            }
            size="sm"
            title={
              counts.failed === 0
                ? "Nothing to retry"
                : `Move ${counts.failed} FAILED item${counts.failed === 1 ? "" : "s"} back to PENDING and try again`
            }
          >
            Retry all failed
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setLoading(true);
              void reload();
            }}
            leftIcon={<RefreshCcw className="h-3.5 w-3.5" />}
            size="sm"
          >
            Refresh
          </Button>
        </div>
      </section>

      {/* ---------- Table ---------- */}
      {loading ? (
        <TableSkeleton />
      ) : items && items.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="bg-muted/30">
                  <Th>Type</Th>
                  <Th>Description</Th>
                  <Th className="w-[160px]">Queued at</Th>
                  <Th className="w-[110px]">Status</Th>
                  <Th className="w-[80px] text-center">Retries</Th>
                  <Th>Error</Th>
                  <Th className="w-[160px] text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {items?.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <Td>
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        <Database className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatFeature(item.feature)}
                      </span>
                      <span className="block font-mono text-[10px] text-muted-foreground/70 mt-0.5">
                        {item.method} {item.endpoint}
                      </span>
                    </Td>
                    <Td className="text-xs text-muted-foreground max-w-[220px]">
                      {item.label ? (
                        <span className="truncate block" title={item.label}>
                          {item.label}
                        </span>
                      ) : (
                        // Fall back to a truncated payload preview so
                        // generic items without an explicit label
                        // still render something searchable.
                        <span
                          className="font-mono truncate block"
                          title={JSON.stringify(item.payload)}
                        >
                          {previewPayload(item.payload)}
                        </span>
                      )}
                      {item.dedupKey && (
                        // Surface the dedup key so admins can see what
                        // would coalesce on a re-enqueue. Hidden in
                        // the row's tooltip too for copy-paste.
                        <span
                          className="block font-mono text-[10px] text-muted-foreground/60 truncate"
                          title={`Dedup key: ${item.dedupKey}`}
                        >
                          dedup: {item.dedupKey}
                        </span>
                      )}
                      {item.deviceId && (
                        // Source-device fingerprint. Same eight-char
                        // prefix the backend uses in its audit logs
                        // so admins can correlate "who pressed what."
                        <span
                          className="block font-mono text-[10px] text-muted-foreground/60 truncate"
                          title={`Device id: ${item.deviceId}`}
                        >
                          src: Device-{item.deviceId.replace(/-/g, "").slice(0, 8)}
                        </span>
                      )}
                    </Td>
                    <Td className="tabular-nums">
                      {/* Queue items don't carry a domain "date" field
                          (that lives in the payload, feature-specific).
                          Show the queued-at timestamp in the user's
                          calendar — diagnostics-friendly without
                          cracking open the payload. */}
                      {formatByMode(
                        new Date(item.createdAt).toISOString(),
                        calendarMode,
                      )}
                    </Td>
                    <Td>
                      <StatusPill status={item.status} />
                    </Td>
                    <Td className="text-center tabular-nums">
                      {item.retryCount}
                    </Td>
                    <Td>
                      {item.lastError ? (
                        <span
                          className="text-xs text-destructive line-clamp-2"
                          title={item.lastError}
                        >
                          {item.lastError}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRetryRow(item)}
                          disabled={
                            actioningIds.has(item.id) ||
                            item.status === "SYNCED"
                          }
                          className={cn(
                            "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-medium text-foreground",
                            "transition-all hover:border-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400",
                            "disabled:opacity-40 disabled:cursor-not-allowed focus-ring",
                          )}
                          title={
                            item.status === "SYNCED"
                              ? "Already synced"
                              : "Reset to PENDING and try again"
                          }
                        >
                          {actioningIds.has(item.id) ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCw className="h-3 w-3" />
                          )}
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(item)}
                          disabled={actioningIds.has(item.id)}
                          aria-label="Delete item from queue"
                          className={cn(
                            "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground",
                            "transition-all hover:bg-destructive/10 hover:text-destructive",
                            "disabled:opacity-40 disabled:cursor-not-allowed focus-ring",
                          )}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-[11px] text-muted-foreground">
        Items are stored in your browser&apos;s IndexedDB
        (<code className="rounded bg-muted/50 px-1 py-0.5 font-mono">
          scholaris-offline / attendance_queue
        </code>
        ). Clearing browser data will drop unsynced items — finish syncing
        before resetting site storage.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header + sub-pieces
// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-ring rounded-sm w-fit"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Settings
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Offline queue
      </h1>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Inspect every attendance write that&apos;s waiting for the server,
        retry the ones that failed, and remove items that should never go
        through. The queue lives in this browser&apos;s IndexedDB and is
        drained automatically when you&apos;re online.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: QueueStatus }) {
  if (status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Pending
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <CheckCircle2 className="h-3 w-3" />
      Synced
    </span>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "emerald" | "destructive" | "muted";
}) {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "destructive"
        ? "bg-destructive/10 text-destructive"
        : tone === "muted"
          ? "bg-muted/40 text-muted-foreground"
          : "bg-muted/40 text-foreground";
  return (
    <div
      className={cn(
        "inline-flex items-baseline gap-2 rounded-md px-3 py-1.5",
        toneClass,
      )}
    >
      <span className="text-xs uppercase tracking-wider font-semibold">
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Map a feature tag ("attendance", "marks", …) to the user-facing
 * label shown in the Type column. Unknown features fall back to a
 * title-cased version so a future feature works out of the box even
 * before the registry is updated.
 */
function formatFeature(feature: string): string {
  const known: Record<string, string> = {
    attendance: "Attendance",
    marks: "Marks",
    exam: "Exam",
    fees: "Fees",
  };
  if (feature in known) return known[feature];
  if (!feature) return "Other";
  return feature.charAt(0).toUpperCase() + feature.slice(1).toLowerCase();
}

/**
 * Tiny JSON preview for the Description column when an item has no
 * explicit `label`. Truncates aggressively because the column is
 * narrow and the full payload is in the row's `title` tooltip.
 */
function previewPayload(payload: unknown): string {
  if (payload == null) return "—";
  try {
    const json = JSON.stringify(payload);
    if (!json) return "—";
    return json.length > 60 ? `${json.slice(0, 57)}…` : json;
  } catch {
    return "[unserializable]";
  }
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle border-b border-border/60",
        className,
      )}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading / restricted
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/10 px-8 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20">
        <CheckCircle2 className="h-5 w-5" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-foreground">
        Queue is empty
      </h2>
      <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
        Every attendance write has been confirmed by the server. Items appear
        here only when offline, when retries are still pending, or when a
        write failed permanently.
      </p>
    </div>
  );
}

function RestrictedPanel({ role }: { role: Role }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <Header />
      <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 p-6 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Restricted to admins
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            The offline-queue inspector is an admin-only diagnostic surface.
            Your account is signed in as{" "}
            <span className="font-medium">{role}</span>.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-all hover:border-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-700 focus-ring"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-3 w-96" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="bg-muted/30 px-4 py-2">
        <Skeleton className="h-4 w-48" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 border-t border-border/40"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="ml-auto h-7 w-32 rounded-md" />
        </div>
      ))}
    </div>
  );
}


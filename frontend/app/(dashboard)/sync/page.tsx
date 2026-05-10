"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudOff,
  Layers,
  Loader2,
  RotateCw,
  Trash2,
} from "lucide-react";
import {
  deleteById,
  listAll,
  pruneSynced,
  retryFailed,
  retryItem,
  type QueueItem,
  type QueueStatus,
} from "@/lib/offline-queue";
import { subscribe, syncNow, type SyncState } from "@/lib/sync-engine";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { TouchButton } from "@/components/mobile/primitives";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /sync — Phase 26 Section 3 rewrite.
//
// Production-grade offline queue inspector. Improvements over Phase 25:
//
//   • Grouped by feature (attendance, fees, marks, …) inside each
//     status section — operators see "9 attendance writes waiting,
//     1 fees write failed" at a glance.
//   • Expandable diagnostics per failed row — click to see the full
//     error, payload preview, retry count, endpoint.
//   • "Clear completed" retires SYNCED rows in bulk so the local
//     history doesn't bloat over months of use.
//   • Status filter (All / Pending / Failed / Synced) for big queues.
//
// Polls listAll() every 3s. Cheap — IndexedDB reads are sub-ms at
// any realistic queue size.
// ---------------------------------------------------------------------------

const POLL_MS = 3_000;

type StatusFilter = "all" | "pending" | "failed" | "synced";

export default function SyncInspectorPage() {
  const online = useOnlineStatus();
  const [items, setItems] = React.useState<QueueItem[]>([]);
  const [syncState, setSyncState] = React.useState<SyncState>({
    running: false,
    pendingCount: null,
    lastResult: null,
  });
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const all = await listAll();
    setItems(all);
  }, []);

  React.useEffect(() => subscribe(setSyncState), []);
  React.useEffect(() => {
    void refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const pending = items.filter((i) => i.status === "PENDING");
  const failed = items.filter((i) => i.status === "FAILED");
  const synced = items
    .filter((i) => i.status === "SYNCED")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);

  const handleSyncNow = withBusy(setBusy, async () => {
    await syncNow();
    await refresh();
  });
  const handleRetryAll = withBusy(setBusy, async () => {
    await retryFailed();
    await syncNow();
    await refresh();
  });
  const handleClearCompleted = withBusy(setBusy, async () => {
    if (
      !window.confirm(
        "Clear synced history? This removes the local record of completed writes — does NOT undo any of them on the server.",
      )
    ) {
      return;
    }
    await pruneSynced(0);
    await refresh();
  });
  const handleRetry = async (id: string) => {
    await retryItem(id);
    await syncNow();
    await refresh();
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm("Discard this pending write? It won't be sent."))
      return;
    await deleteById(id);
    await refresh();
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Sync
        </p>
        <h1 className="text-2xl font-semibold mt-1">Sync queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What this device is sending to the server, and what's stuck.
        </p>
      </div>

      <ConnectivityCard
        online={online}
        running={syncState.running}
        pendingCount={pending.length}
        failedCount={failed.length}
        onSyncNow={handleSyncNow}
        busy={busy}
      />

      <FilterBar
        filter={filter}
        onChange={setFilter}
        counts={{
          all: items.length,
          pending: pending.length,
          failed: failed.length,
          synced: synced.length,
        }}
      />

      {(filter === "all" || filter === "failed") && failed.length > 0 && (
        <Section
          title={`Failed · ${failed.length}`}
          icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          tone="danger"
          headerAction={
            <TouchButton
              variant="neutral"
              size="md"
              onClick={handleRetryAll}
              disabled={busy}
              className="!min-h-[36px] text-xs"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Retry all
            </TouchButton>
          }
        >
          <p className="px-4 pt-2 text-xs text-muted-foreground">
            These writes hit a problem after retries. Tap a row to see why
            it failed; tap retry to send it again.
          </p>
          <GroupedItems
            items={failed}
            expandedId={expandedId}
            onExpand={setExpandedId}
            onRetry={handleRetry}
            onDelete={handleDelete}
          />
        </Section>
      )}

      {(filter === "all" || filter === "pending") && (
        <Section
          title={`Pending · ${pending.length}`}
          icon={
            <Loader2
              className={cn(
                "h-4 w-4 text-amber-600",
                syncState.running && "animate-spin",
              )}
            />
          }
          tone={pending.length > 0 ? "warning" : "default"}
        >
          {pending.length === 0 ? (
            <EmptyRow message="Nothing waiting to send." />
          ) : (
            <GroupedItems
              items={pending}
              expandedId={expandedId}
              onExpand={setExpandedId}
              onDelete={handleDelete}
            />
          )}
        </Section>
      )}

      {(filter === "all" || filter === "synced") && (
        <Section
          title={`Recently synced · ${synced.length}`}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          tone="success"
          headerAction={
            synced.length > 0 ? (
              <TouchButton
                variant="ghost"
                size="md"
                onClick={handleClearCompleted}
                disabled={busy}
                className="!min-h-[36px] text-xs text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </TouchButton>
            ) : undefined
          }
        >
          {synced.length === 0 ? (
            <EmptyRow message="No recent successful writes." />
          ) : (
            <GroupedItems
              items={synced}
              expandedId={expandedId}
              onExpand={setExpandedId}
              compact
            />
          )}
        </Section>
      )}
    </div>
  );
}

// ===========================================================================
// Connectivity card
// ===========================================================================

function ConnectivityCard({
  online,
  running,
  pendingCount,
  failedCount,
  onSyncNow,
  busy,
}: {
  online: boolean;
  running: boolean;
  pendingCount: number;
  failedCount: number;
  onSyncNow: () => void;
  busy: boolean;
}) {
  const tone = !online
    ? "border-amber-300 bg-amber-50/40"
    : failedCount > 0
      ? "border-red-300 bg-red-50/40"
      : pendingCount > 0
        ? "border-sky-300 bg-sky-50/40"
        : "border-emerald-300 bg-emerald-50/40";

  const headline = !online
    ? "You're offline"
    : failedCount > 0
      ? "Some writes failed"
      : pendingCount > 0
        ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} waiting to send`
        : "All synced";
  const detail = !online
    ? "Writes are queued on this device. They'll send automatically when you're back online."
    : failedCount > 0
      ? "Tap Retry on a failed row, or Retry all to retry every failure."
      : pendingCount > 0
        ? "Sync runs automatically every 30 seconds. You can force it now."
        : "This device is up to date with the server.";

  return (
    <div className={cn("rounded-xl border p-4", tone)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">
          {!online ? (
            <CloudOff className="h-5 w-5 text-amber-700" />
          ) : running ? (
            <Loader2 className="h-5 w-5 text-sky-700 animate-spin" />
          ) : failedCount > 0 ? (
            <AlertTriangle className="h-5 w-5 text-red-700" />
          ) : pendingCount > 0 ? (
            <Loader2 className="h-5 w-5 text-sky-700" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-700" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{headline}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {detail}
          </p>
        </div>
        {online && (pendingCount > 0 || failedCount > 0) && (
          <TouchButton
            variant="primary"
            size="md"
            onClick={onSyncNow}
            disabled={busy || running}
            className="shrink-0 !min-h-[36px] text-xs"
          >
            <RotateCw
              className={cn(
                "h-3.5 w-3.5",
                (busy || running) && "animate-spin",
              )}
            />
            Sync now
          </TouchButton>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Filter bar
// ===========================================================================

function FilterBar({
  filter,
  onChange,
  counts,
}: {
  filter: StatusFilter;
  onChange: (f: StatusFilter) => void;
  counts: { all: number; pending: number; failed: number; synced: number };
}) {
  const opts: Array<{ value: StatusFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: counts.all },
    { value: "pending", label: "Pending", count: counts.pending },
    { value: "failed", label: "Failed", count: counts.failed },
    { value: "synced", label: "Synced", count: counts.synced },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card p-0.5">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 px-2.5 rounded text-[11px] font-medium inline-flex items-center gap-1",
            filter === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/40",
          )}
        >
          {o.label}
          <span
            className={cn(
              "tabular-nums",
              filter === o.value ? "opacity-90" : "text-muted-foreground/70",
            )}
          >
            {o.count}
          </span>
        </button>
      ))}
    </div>
  );
}

// ===========================================================================
// Section + items
// ===========================================================================

function Section({
  title,
  icon,
  tone,
  headerAction,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  tone: "default" | "warning" | "danger" | "success";
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const headerCls =
    tone === "danger"
      ? "bg-red-50/40 border-b border-red-100"
      : tone === "warning"
        ? "bg-amber-50/40 border-b border-amber-100"
        : tone === "success"
          ? "bg-emerald-50/40 border-b border-emerald-100"
          : "bg-muted/30 border-b";
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div
        className={cn(
          "px-4 py-2.5 flex items-center justify-between",
          headerCls,
        )}
      >
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-semibold">{title}</p>
        </div>
        {headerAction}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <p className="px-4 py-6 text-center text-xs text-muted-foreground">
      {message}
    </p>
  );
}

/**
 * Groups items by `feature` (attendance / fees / marks / …) before
 * rendering, so a 200-item queue with three feature buckets renders
 * as three labelled blocks instead of a flat scroll.
 */
function GroupedItems({
  items,
  expandedId,
  onExpand,
  onRetry,
  onDelete,
  compact,
}: {
  items: QueueItem[];
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  onRetry?: (id: string) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}) {
  const grouped = React.useMemo(() => {
    const map = new Map<string, QueueItem[]>();
    for (const it of items) {
      const key = it.feature || "other";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  if (grouped.length === 0) return null;

  return (
    <div className="divide-y">
      {grouped.map(([feature, rows]) => (
        <div key={feature}>
          <div className="px-4 py-1.5 bg-muted/20 flex items-center gap-2">
            <Layers className="h-3 w-3 text-muted-foreground" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {feature} · {rows.length}
            </p>
          </div>
          <ul className="divide-y">
            {rows.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                expanded={expandedId === it.id}
                onExpand={() => onExpand(expandedId === it.id ? null : it.id)}
                onRetry={onRetry}
                onDelete={onDelete}
                compact={compact}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  expanded,
  onExpand,
  onRetry,
  onDelete,
  compact,
}: {
  item: QueueItem;
  expanded: boolean;
  onExpand: () => void;
  onRetry?: (id: string) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}) {
  const canExpand = !compact && (item.status === "FAILED" || !!item.lastError);
  return (
    <li>
      <div
        className={cn(
          "px-4 flex items-start gap-2",
          compact ? "py-1.5" : "py-2.5",
          canExpand && "cursor-pointer hover:bg-muted/20",
        )}
        onClick={canExpand ? onExpand : undefined}
        role={canExpand ? "button" : undefined}
      >
        {canExpand && (
          <span className="mt-1 shrink-0 text-muted-foreground">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground truncate">
            {item.label ?? item.endpoint}
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {tagFor(item.status)} · {timeAgo(item.createdAt)}
            {item.retryCount > 0 && ` · ${item.retryCount} retries`}
          </p>
        </div>
        {!compact && (
          <div className="shrink-0 flex items-center gap-1.5">
            {onRetry && item.status === "FAILED" && (
              <TouchButton
                variant="neutral"
                size="md"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry(item.id);
                }}
                className="!min-h-[36px] !min-w-[36px] !px-2 text-[10px]"
                aria-label="Retry"
              >
                <RotateCw className="h-3 w-3" />
              </TouchButton>
            )}
            {onDelete && item.status !== "SYNCED" && (
              <TouchButton
                variant="ghost"
                size="md"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
                className="!min-h-[36px] !min-w-[36px] !px-2 text-[10px] text-red-700"
                aria-label="Discard"
              >
                <Trash2 className="h-3 w-3" />
              </TouchButton>
            )}
          </div>
        )}
      </div>

      {expanded && canExpand && (
        <div className="px-4 pb-3 pt-1 bg-muted/20">
          <ItemDiagnostics item={item} />
        </div>
      )}
    </li>
  );
}

function ItemDiagnostics({ item }: { item: QueueItem }) {
  let payloadSummary = "";
  try {
    const full = JSON.stringify(item.payload);
    payloadSummary = full.slice(0, 240) + (full.length > 240 ? "…" : "");
  } catch {
    payloadSummary = "<unserialisable>";
  }
  return (
    <div className="space-y-2">
      {item.lastError && (
        <div className="rounded border border-red-200 bg-red-50/40 p-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-700">
            Why this failed
          </p>
          <p className="mt-0.5 text-xs text-red-900 font-mono whitespace-pre-wrap">
            {item.lastError}
          </p>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <Diag label="Endpoint">
          <code className="font-mono text-foreground/80">
            {item.method} {item.endpoint}
          </code>
        </Diag>
        <Diag label="Created">
          {new Date(item.createdAt).toLocaleString()}
        </Diag>
        <Diag label="Retries">{item.retryCount}</Diag>
        <Diag label="ID">
          <code className="font-mono">{item.id.slice(0, 12)}</code>
        </Diag>
      </dl>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Payload
        </p>
        <p className="mt-0.5 text-[11px] font-mono text-muted-foreground/90 break-all">
          {payloadSummary}
        </p>
      </div>
    </div>
  );
}

function Diag({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-muted-foreground/70">{label}</dt>
      <dd className="text-foreground/90">{children}</dd>
    </div>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function tagFor(status: QueueStatus): string {
  switch (status) {
    case "PENDING":
      return "waiting";
    case "FAILED":
      return "failed";
    case "SYNCED":
      return "sent";
  }
}

function timeAgo(ms: number): string {
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function withBusy(
  setBusy: (b: boolean) => void,
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
}

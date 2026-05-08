"use client";

import * as React from "react";
import {
  Cloud,
  CloudOff,
  Loader2,
  RefreshCcw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSyncEngine } from "@/hooks/useSyncEngine";

/**
 * Topbar pill that surfaces offline state + pending-sync queue.
 *
 *   • Online + 0 pending  → quietly hidden (the steady-state happy
 *     path doesn't need chrome).
 *   • Online + N pending  → emerald pill "N pending" with a manual-
 *     sync button.
 *   • Online, sync running → spinner + "Syncing…"
 *   • Offline             → red pill "Offline · N pending" (no sync
 *     button — nothing to do until the network comes back).
 *
 * Dropdown surface (click anywhere on the pill, except the manual
 * sync icon) opens a small panel with the last sync result and a
 * second "Retry failed" action for items that hit the failure
 * threshold.
 */
export function SyncStatusBadge() {
  const online = useOnlineStatus();
  const { state, runManualSync, retryFailed } = useSyncEngine();
  const [open, setOpen] = React.useState(false);
  const [actioning, setActioning] = React.useState<
    "sync" | "retry" | null
  >(null);
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape.
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

  const pending = state.pendingCount ?? 0;
  const running = state.running;

  // Visibility rules:
  //   • Always show when offline (so the user knows the app is in
  //     offline-mode and that pending items exist).
  //   • Show when there's at least one pending item.
  //   • Show while a sync is in flight (so the spinner is visible).
  // Otherwise hide entirely — a clean topbar in the steady state is
  // worth the conditional render.
  if (online && pending === 0 && !running) return null;

  const handleManualSync = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActioning("sync");
    try {
      const result = await runManualSync();
      // Translate the engine result into one user-visible toast.
      // The badge re-renders independently via the subscribe() hook
      // — this toast is purely "I heard you" feedback.
      if (result.skipped) {
        if (result.reason === "offline") {
          toast.error("Offline. Will sync when you're back online.");
        } else if (result.reason === "no-pending") {
          toast.success("Nothing to sync — you're up to date.");
        } else {
          toast.message("Sync already in progress…");
        }
      } else if (result.failed > 0) {
        toast.error(
          `Synced ${result.synced}/${result.attempted} — ${result.failed} failed${result.firstError ? ` (${result.firstError})` : ""}.`,
        );
      } else if (result.synced > 0) {
        toast.success(`Synced ${result.synced} item${result.synced === 1 ? "" : "s"}.`);
      }
    } catch {
      toast.error("Sync failed. Will retry automatically.");
    } finally {
      setActioning(null);
    }
  };

  const handleRetryFailed = async () => {
    setActioning("retry");
    try {
      await retryFailed();
      toast.success("Retrying failed items…");
    } catch {
      toast.error("Could not move failed items back to the queue.");
    } finally {
      setActioning(null);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Sync status"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-ring",
          // Color tracks the priority signal: red when offline,
          // emerald when online with pending work, neutral otherwise.
          !online
            ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
            : pending > 0 || running
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {!online ? (
          <WifiOff className="h-[14px] w-[14px]" />
        ) : running ? (
          <Loader2 className="h-[14px] w-[14px] animate-spin" />
        ) : (
          <Cloud className="h-[14px] w-[14px]" />
        )}
        <span className="tabular-nums">
          {!online && pending > 0
            ? `Offline · ${pending} pending`
            : !online
              ? "Offline"
              : running
                ? "Syncing…"
                : `${pending} pending`}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 origin-top-right rounded-lg border border-border bg-surface p-1.5 shadow-lg animate-scale-in"
        >
          <div className="px-2.5 py-1.5 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sync status
            </p>
            <div className="flex items-center gap-2 text-sm">
              {online ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-foreground">Online</span>
                </>
              ) : (
                <>
                  <CloudOff className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-foreground">Offline</span>
                </>
              )}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {pending} pending
              </span>
            </div>
            {state.lastResult && (
              <p className="text-[11px] text-muted-foreground/80">
                Last attempt:{" "}
                {state.lastResult.skipped
                  ? state.lastResult.reason === "offline"
                    ? "Skipped (offline)"
                    : state.lastResult.reason === "no-pending"
                      ? "Nothing to sync"
                      : "Already running"
                  : `${state.lastResult.synced}/${state.lastResult.attempted} synced` +
                    (state.lastResult.failed > 0
                      ? `, ${state.lastResult.failed} failed`
                      : "")}
                {state.lastResult.firstError && (
                  <>
                    {" — "}
                    <span className="text-destructive">
                      {state.lastResult.firstError}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="mt-1 flex flex-col gap-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={handleManualSync}
              disabled={!online || running || actioning === "sync"}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
                "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                "text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {actioning === "sync" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              Sync pending data
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleRetryFailed}
              disabled={!online || actioning === "retry"}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm",
                "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                "text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
              )}
              title="Move FAILED items back to PENDING and try again"
            >
              {actioning === "retry" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              Retry failed items
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

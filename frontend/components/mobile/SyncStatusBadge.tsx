"use client";

import * as React from "react";
import { Check, CloudOff, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SyncStatusBadge — Phase 25 Section 3.
//
// Per-row sync indicator. Tells a teacher mid-attendance whether
// the toggle they just made has reached the server, is still in
// the offline queue, or failed.
//
// Four visual states (icon + tone):
//
//   "synced"   — green check. Default after any successful write.
//   "pending"  — amber dot pulsing. Item is in the offline queue
//                waiting for the next drain.
//   "syncing"  — blue spinner. Sync engine is actively flushing.
//   "failed"   — red retry icon (clickable). One-tap retry.
//
// Sizes:
//   "xs" — for inline use inside a row (12px)
//   "sm" — for stand-alone badges (16px)
//
// The badge does NOT poll — it's a pure render of the status the
// caller passes in. Wire it up by reading from the offline-queue
// helpers (countPending, etc) at the workflow level and propagating
// the per-item state down. Keeping it dumb means we can drop it
// into any row without hooking into the sync engine subscription
// from inside a list of N rows.
// ---------------------------------------------------------------------------

export type RowSyncState = "synced" | "pending" | "syncing" | "failed";

export interface SyncStatusBadgeProps {
  state: RowSyncState;
  size?: "xs" | "sm";
  /** Click handler for the failed-state retry. Ignored for other states. */
  onRetry?: () => void;
  className?: string;
}

export function SyncStatusBadge({
  state,
  size = "xs",
  onRetry,
  className,
}: SyncStatusBadgeProps) {
  const iconSize = size === "xs" ? "h-3 w-3" : "h-4 w-4";
  const cell = size === "xs" ? "h-5 w-5" : "h-6 w-6";

  if (state === "synced") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "bg-emerald-100 text-emerald-700",
          cell,
          className,
        )}
        title="Saved to server"
        aria-label="Saved"
      >
        <Check className={iconSize} />
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "bg-amber-100 text-amber-700",
          cell,
          className,
        )}
        title="Waiting to sync"
        aria-label="Pending sync"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-600 animate-pulse" />
      </span>
    );
  }
  if (state === "syncing") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full",
          "bg-sky-100 text-sky-700",
          cell,
          className,
        )}
        title="Syncing now"
        aria-label="Syncing"
      >
        <Loader2 className={cn(iconSize, "animate-spin")} />
      </span>
    );
  }
  // failed
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={!onRetry}
      className={cn(
        "inline-flex items-center justify-center rounded-full",
        "bg-red-100 text-red-700 hover:bg-red-200 transition-colors",
        cell,
        className,
      )}
      title="Sync failed — tap to retry"
      aria-label="Retry sync"
    >
      <RotateCw className={iconSize} />
    </button>
  );
}

/**
 * Floating "you're offline" / "N pending" pill for the page header.
 * Compact, never intrusive. Appears only when there's something the
 * user should know about.
 */
export function SyncStatusPill({
  online,
  pendingCount,
  syncing,
  onTap,
}: {
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  onTap?: () => void;
}) {
  if (online && pendingCount === 0 && !syncing) return null;
  const tone = !online
    ? "bg-amber-50 border-amber-300 text-amber-900"
    : syncing
      ? "bg-sky-50 border-sky-300 text-sky-900"
      : pendingCount > 0
        ? "bg-amber-50 border-amber-300 text-amber-900"
        : "bg-emerald-50 border-emerald-300 text-emerald-900";
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 h-7 text-[11px] font-medium",
        tone,
      )}
    >
      {!online ? (
        <>
          <CloudOff className="h-3 w-3" />
          Offline · {pendingCount} pending
        </>
      ) : syncing ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Syncing…
        </>
      ) : (
        <>
          <RotateCw className="h-3 w-3" />
          {pendingCount} pending
        </>
      )}
    </button>
  );
}

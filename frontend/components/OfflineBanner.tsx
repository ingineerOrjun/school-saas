"use client";

import * as React from "react";
import Link from "next/link";
import { CloudOff, Loader2, RotateCw } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { subscribe, syncNow, type SyncState } from "@/lib/sync-engine";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// OfflineBanner — Phase 26 Section 3.
//
// Sticky top warning that appears when the device is offline OR the
// queue has pending writes. Self-hides when everything is green.
//
// Three states:
//
//   1. Offline + nothing pending    → amber pill: "Offline. Changes
//                                                   will sync automatically."
//   2. Offline + pending writes     → amber + count: "Offline. N writes
//                                                   queued. They'll sync
//                                                   when you're back online."
//   3. Online + pending writes      → blue + Sync now button: "N writes
//                                                   waiting to sync."
//
// Renders nothing in the all-green case to keep the layout calm. Uses
// the existing sync-engine subscription + useOnlineStatus — no new
// state machine.
//
// Mounted inside the dashboard layout above the page content (below
// the impersonation + maintenance banners). Stacks naturally with
// them.
// ---------------------------------------------------------------------------

export function OfflineBanner() {
  const online = useOnlineStatus();
  const [sync, setSync] = React.useState<SyncState>({
    running: false,
    pendingCount: null,
    lastResult: null,
  });

  React.useEffect(() => subscribe(setSync), []);

  const pending = sync.pendingCount ?? 0;
  const showBanner = !online || pending > 0;
  if (!showBanner) return null;

  const tone = !online
    ? "border-amber-300 bg-amber-50 text-amber-900"
    : "border-sky-300 bg-sky-50 text-sky-900";

  const icon = !online ? (
    <CloudOff className="h-4 w-4" />
  ) : sync.running ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : (
    <RotateCw className="h-4 w-4" />
  );

  const message = !online
    ? pending > 0
      ? `Offline. ${pending} write${pending === 1 ? "" : "s"} queued — will sync automatically when you're back online.`
      : "Offline. Changes will sync automatically when you reconnect."
    : sync.running
      ? "Syncing your changes…"
      : `${pending} write${pending === 1 ? "" : "s"} waiting to sync.`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 border-b text-xs",
        tone,
      )}
    >
      <div className="flex items-center gap-2 max-w-[1400px] mx-auto">
        <span className="shrink-0">{icon}</span>
        <p className="min-w-0 flex-1">{message}</p>
        <Link
          href="/sync"
          className="shrink-0 underline underline-offset-2 hover:no-underline font-medium"
        >
          View queue
        </Link>
        {online && pending > 0 && !sync.running && (
          <button
            type="button"
            onClick={() => void syncNow()}
            className="shrink-0 rounded-md border border-current/40 bg-white/40 px-2 h-6 text-[11px] font-medium hover:bg-white/60"
          >
            Sync now
          </button>
        )}
      </div>
    </div>
  );
}

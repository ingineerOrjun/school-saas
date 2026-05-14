"use client";

import * as React from "react";
import { CheckCircle2, CloudOff } from "lucide-react";

// ============================================================================
// SyncStatusBar — header-line indicator for CDC evaluation screens.
//
// Session 5 wireframe: HARDCODED to "online" so the bar is invisible
// in the default state, matching the "Sync confidence (WhatsApp
// delivery semantics)" principle — the absence of a banner IS the
// confidence signal. Showing a green "all synced!" sash for an
// always-online state would be visual noise.
//
// A dev-only toggle (bottom-right floating button) lets you flip to
// the "offline — N pending" state to validate the placeholder render
// without standing up a real network condition. The toggle is
// gated on `process.env.NODE_ENV !== "production"` so prod builds
// never see the FAB.
//
// Session 6 will replace the hardcoded boolean with a real read
// from the offline-queue store (the same one OfflineBanner in
// app/(dashboard)/layout.tsx subscribes to). The component shape is
// designed to be a drop-in; only the `online`/`pendingCount` source
// changes.
// ============================================================================

export function SyncStatusBar() {
  const [fakeOffline, setFakeOffline] = React.useState(false);

  // Hardcoded mock pending count. Session 6 reads this from the
  // offline-queue store. Typed `number` (not the literal `0`) so the
  // pluralization branch below stays meaningful when the real source
  // lands.
  const pendingCount: number = fakeOffline ? 3 : 0;
  const online = !fakeOffline;

  return (
    <>
      {/* The bar itself. Invisible when online + 0 pending — the
          dominant state. Pulls the rest of the screen down only when
          something needs to be communicated. */}
      {!online && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Offline — {pendingCount}{" "}
            {pendingCount === 1 ? "change" : "changes"} pending. Your work is
            saved on this device.
          </span>
        </div>
      )}

      {/* Dev-only sync-state simulator. Tiny corner pill so the
          wireframes can demo the offline path without breaking the
          phone's actual connectivity. */}
      {process.env.NODE_ENV !== "production" && (
        <button
          type="button"
          onClick={() => setFakeOffline((v) => !v)}
          className="fixed bottom-3 right-3 z-40 flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs text-muted-foreground shadow-md hover:bg-muted"
          aria-label="Toggle fake offline state (dev only)"
        >
          {online ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              online
            </>
          ) : (
            <>
              <CloudOff className="h-3.5 w-3.5 text-amber-600" />
              offline (mock)
            </>
          )}
        </button>
      )}
    </>
  );
}

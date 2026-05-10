"use client";

import * as React from "react";
import { subscribe, type SyncState } from "@/lib/sync-engine";

// ---------------------------------------------------------------------------
// useQueueAwareGuards — Phase 26 Section 5.
//
// Browser-level safety nets that hook into the existing sync engine.
//
// Exports:
//
//   useQueuePendingCount() — live count of PENDING items via the
//                             sync engine subscription. Cheap; backs
//                             the offline banner + the beforeunload
//                             guard below.
//
//   useQueueAwareBeforeUnload() — installs a `beforeunload` listener
//                                  that ONLY fires the browser's
//                                  "leave site?" prompt when there
//                                  are unsynced writes. No more
//                                  spurious prompts on a clean page
//                                  refresh.
// ---------------------------------------------------------------------------

export function useQueuePendingCount(): number {
  const [count, setCount] = React.useState(0);
  React.useEffect(
    () =>
      subscribe((s: SyncState) => {
        setCount(s.pendingCount ?? 0);
      }),
    [],
  );
  return count;
}

/**
 * Block accidental tab close / refresh when the offline queue has
 * pending writes. The browser shows its standard "Leave site?
 * Changes you made may not be saved" dialog. A clean queue means
 * no prompt — refreshing during normal browsing stays silent.
 */
export function useQueueAwareBeforeUnload(): void {
  const pendingCount = useQueuePendingCount();
  React.useEffect(() => {
    if (pendingCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message text; assigning a non-
      // empty `returnValue` is what triggers the dialog at all.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingCount]);
}

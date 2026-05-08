"use client";

import * as React from "react";
import {
  getSyncState,
  refreshPendingCount,
  subscribe,
  syncNow,
  type SyncResult,
  type SyncState,
} from "@/lib/sync-engine";
import { retryFailed as retryFailedQueueItems } from "@/lib/offline-queue";

const POLL_MS = 30_000;

export interface UseSyncEngineResult {
  /** Latest engine snapshot — running flag, pending count, last result. */
  state: SyncState;
  /** Manual trigger — fires syncNow and returns the result for toasts. */
  runManualSync: () => Promise<SyncResult>;
  /** Reset FAILED items back to PENDING and re-run sync. */
  retryFailed: () => Promise<SyncResult>;
}

/**
 * Mount once near the top of the auth-required tree (dashboard layout).
 * Drives the offline queue against the network on every relevant
 * trigger:
 *
 *   • component mount (handles the tab being reopened with pending data)
 *   • `online` event (handles re-connection mid-session)
 *   • 30s interval (handles the case where the user marks attendance
 *     offline, the connection silently comes back, but no `online`
 *     event fires — happens with Wi-Fi captive portals)
 *
 * Subscribers that just want to read state (e.g. the topbar badge)
 * can call this hook AND get the latest snapshot — the engine state
 * is module-level so multiple subscribers see the same numbers.
 */
export function useSyncEngine(): UseSyncEngineResult {
  const [state, setState] = React.useState<SyncState>(() => getSyncState());

  // Subscribe to engine state changes. The first listener call
  // delivers the current snapshot synchronously, so we don't need a
  // separate refresh on mount.
  React.useEffect(() => {
    return subscribe(setState);
  }, []);

  // Mount-time pass: refresh count first (so the badge doesn't sit at
  // null), then attempt a sync. `syncNow` self-skips when offline so
  // we don't have to gate it here.
  React.useEffect(() => {
    void refreshPendingCount();
    void syncNow();
  }, []);

  // Re-sync on `online`. Browsers fire this when the OS network
  // interface comes back up — most reliable signal for "try again now."
  React.useEffect(() => {
    const onOnline = () => {
      void syncNow();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // Belt-and-suspenders interval. Captures the captive-portal case
  // where `online` fires before the gateway lets actual HTTP through.
  // `syncNow` is a no-op when offline OR when no items are pending,
  // so this is cheap to leave running.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      void syncNow();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const runManualSync = React.useCallback(() => syncNow(), []);

  const retryFailed = React.useCallback(async () => {
    // Move FAILED → PENDING then drain. Two-step so the count badge
    // shows the items moving back into the queue before we retry.
    await retryFailedQueueItems();
    await refreshPendingCount();
    return syncNow();
  }, []);

  return { state, runManualSync, retryFailed };
}

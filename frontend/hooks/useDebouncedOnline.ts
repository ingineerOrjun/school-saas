"use client";

import * as React from "react";

// ---------------------------------------------------------------------------
// useDebouncedOnlineEvents — Phase 26 Section 5.
//
// Subscribes to the browser `online` / `offline` events with built-in
// reconnect-storm protection. On flaky connections (Android dropping
// in and out of cell tower handoffs, school WiFi cycling), the raw
// `online` event can fire 5-10 times in a few seconds. Each fire
// triggers a sync engine drain, a feature refetch, and notification
// queries — that's a stampede that hits the throttler immediately.
//
// This hook coalesces rapid events:
//   • Multiple `online` events within `cooldownMs` (default 1500ms)
//     surface as a single `onOnline` callback.
//   • Same coalescing applies to `offline`.
//
// Use it in place of the raw event listeners for any handler that
// triggers network work on reconnect.
// ---------------------------------------------------------------------------

export interface UseDebouncedOnlineOptions {
  cooldownMs?: number;
  onOnline?: () => void;
  onOffline?: () => void;
}

export function useDebouncedOnlineEvents({
  cooldownMs = 1_500,
  onOnline,
  onOffline,
}: UseDebouncedOnlineOptions): void {
  const lastOnlineFireRef = React.useRef(0);
  const lastOfflineFireRef = React.useRef(0);
  const onOnlineRef = React.useRef(onOnline);
  const onOfflineRef = React.useRef(onOffline);

  // Keep latest callbacks without re-subscribing on every render.
  React.useEffect(() => {
    onOnlineRef.current = onOnline;
    onOfflineRef.current = onOffline;
  }, [onOnline, onOffline]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const onlineHandler = () => {
      const now = Date.now();
      if (now - lastOnlineFireRef.current < cooldownMs) return;
      lastOnlineFireRef.current = now;
      onOnlineRef.current?.();
    };
    const offlineHandler = () => {
      const now = Date.now();
      if (now - lastOfflineFireRef.current < cooldownMs) return;
      lastOfflineFireRef.current = now;
      onOfflineRef.current?.();
    };
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, [cooldownMs]);
}

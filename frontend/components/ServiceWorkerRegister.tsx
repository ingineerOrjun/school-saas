"use client";

import * as React from "react";

// ---------------------------------------------------------------------------
// ServiceWorkerRegister — Phase 26 Section 6.
//
// Registers /sw.js once per session. Mounted in the dashboard layout
// so it only fires for authenticated users (anonymous pages don't
// need the offline fallback yet).
//
// Production-only by default. In dev, hot-reload + service workers
// fight; opt in via NEXT_PUBLIC_SW_DEV=true if you specifically want
// to test the worker locally.
//
// Renders nothing.
// ---------------------------------------------------------------------------

export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const allowed =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_SW_DEV === "true";
    if (!allowed) return;

    // Register on idle so we don't compete with first paint.
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // Failed to register — log but don't surface; the app
          // works fine without the worker.
          // eslint-disable-next-line no-console
          console.warn("[sw] registration failed");
        });
    };

    if ("requestIdleCallback" in window) {
      (window as Window & {
        requestIdleCallback: (cb: () => void) => void;
      }).requestIdleCallback(register);
    } else {
      setTimeout(register, 1_500);
    }
  }, []);

  return null;
}

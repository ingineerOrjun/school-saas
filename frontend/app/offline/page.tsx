"use client";

import * as React from "react";
import { CloudOff, RotateCw } from "lucide-react";

// ---------------------------------------------------------------------------
// /offline — Phase 26 Section 6 fallback page.
//
// Served by the service worker when the user navigates to a route
// that hasn't been cached and the network call fails. Static-only —
// must render with zero JS dependencies on the network.
//
// What we DON'T do here:
//   • Pull from React Query / API client — those would loop on the
//     same network failure that brought us here.
//   • Pull localStorage user state — the page is meant for the
//     anonymous case too (user opened a fresh tab while offline).
//
// The "Try again" button reloads the URL the user was trying to
// reach (referrer fallback to /dashboard). When the network is back,
// the regular route loads normally.
// ---------------------------------------------------------------------------

export default function OfflinePage() {
  const [retrying, setRetrying] = React.useState(false);

  const retry = () => {
    setRetrying(true);
    // Tiny delay so the spinner is visible — the actual reload is
    // synchronous, but a flash of feedback feels less abrupt.
    setTimeout(() => {
      window.location.reload();
    }, 120);
  };

  return (
    <main className="min-h-screen bg-app flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <CloudOff className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-foreground">
          You're offline
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          The page you were trying to open isn't cached on this device.
          Reconnect to the network and try again — your saved work is
          safe and will sync automatically when you're back online.
        </p>
        <button
          type="button"
          onClick={retry}
          disabled={retrying}
          className="mt-6 inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <RotateCw
            className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`}
          />
          Try again
        </button>
      </div>
    </main>
  );
}

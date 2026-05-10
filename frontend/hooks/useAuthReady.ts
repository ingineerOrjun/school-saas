"use client";

import * as React from "react";
import {
  ensureHydrated,
  snapshot,
  subscribe,
  type AuthSnapshot,
} from "@/lib/auth-store";

// ---------------------------------------------------------------------------
// useAuthReady — Phase α follow-up.
//
// The single source of truth React Query consumers gate on. Returns:
//
//   { authReady, isAuthenticated, token, user, role }
//
// Use it like:
//
//   const { authReady, isAuthenticated } = useAuthReady();
//   const query = useQuery({
//     queryKey: qk.classes(),
//     queryFn: () => classesApi.list(),
//     enabled: authReady && isAuthenticated,
//     staleTime: STALE.REFERENCE_DATA,
//   });
//
// Why this is the fix for the bootstrap throttle storm:
//
//   Before: every protected hook checked `enabled: !!getToken()`.
//           getToken() reads localStorage synchronously, so on the
//           very first render (before useEffect runs), if the token
//           IS present it fired immediately. But the api() client
//           itself reads the token lazily — and during dev hot-
//           reload + React.StrictMode double-mount, queries could
//           start firing in a brief window where getToken returned
//           null. Those requests went out without the Authorization
//           header → backend saw user=<anon> → throttled by IP.
//
//   After:  authReady gates EVERY protected query at a single point.
//           The store hydrates synchronously on first subscriber
//           mount; queries don't fire until the snapshot is
//           published. No more "anonymous" requests on bootstrap.
//
// useSyncExternalStore:
//   We use React's useSyncExternalStore so the snapshot is correctly
//   tearing-resistant under concurrent rendering. It also handles
//   the SSR case (we pass a server snapshot that says "hydrating").
// ---------------------------------------------------------------------------

const SERVER_SNAPSHOT: AuthSnapshot = {
  authReady: false,
  isAuthenticated: false,
  token: null,
  user: null,
  role: null,
};

export function useAuthReady(): AuthSnapshot {
  // Trigger hydration on first mount. Idempotent — safe to call
  // from every component that uses the hook.
  React.useEffect(() => {
    ensureHydrated();
  }, []);

  // Subscribe to changes. The third arg is the SSR snapshot —
  // returning a stable "hydrating" state means SSR markup matches
  // the very first client render.
  return React.useSyncExternalStore(
    subscribe,
    snapshot,
    () => SERVER_SNAPSHOT,
  );
}

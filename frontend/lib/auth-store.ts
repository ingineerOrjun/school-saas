"use client";

/**
 * Auth-store — Phase α follow-up.
 *
 * Subscribable mirror of the localStorage auth state. Solves the
 * bootstrap throttle storm: protected React Query hooks no longer
 * fire BEFORE the token is restored from storage. Each hook reads
 * `useAuthReady()` and gates its `enabled:` flag on it; the store
 * publishes `authReady=true` once the synchronous restore is done,
 * regardless of whether a token was found.
 *
 * Why a separate store + hook instead of just reading localStorage:
 *   • localStorage reads happen during render, but the values can
 *     change at runtime (login, logout, cross-tab events) without
 *     React knowing. A subscribable store gives React a real
 *     dependency to re-render against.
 *   • `authReady` distinguishes "not yet hydrated" from "hydrated +
 *     not authenticated" — the former should DEFER queries; the
 *     latter should LET THEM ABORT (the `enabled: false` path stops
 *     the query from firing at all and React Query parks gracefully).
 *
 * Lifecycle:
 *   • Module load → authReady=false
 *   • First subscriber mounts → reads localStorage synchronously,
 *     publishes the initial snapshot, sets authReady=true
 *   • setAuth(...) on login / logout writes localStorage + publishes
 *   • Cross-tab `storage` event triggers a re-read + publish
 *
 * SSR-safe: the store treats `typeof window === 'undefined'` as
 * "still hydrating" so server-rendered output doesn't disagree with
 * the post-hydration client. The first effect-tick on the client
 * reads localStorage and unblocks.
 */

import * as React from "react";
import type { Role, SafeUser } from "./auth";

const TOKEN_KEY = "scholaris:token";
const USER_KEY = "scholaris:user";

export interface AuthSnapshot {
  /** True once the store has at least attempted localStorage restore. */
  authReady: boolean;
  /** True iff a non-empty token AND a parsed user are present. */
  isAuthenticated: boolean;
  token: string | null;
  user: SafeUser | null;
  role: Role | null;
}

const INITIAL: AuthSnapshot = {
  authReady: false,
  isAuthenticated: false,
  token: null,
  user: null,
  role: null,
};

let current: AuthSnapshot = INITIAL;
const listeners = new Set<() => void>();

// ---------------------------------------------------------------------------
// Storage I/O
// ---------------------------------------------------------------------------

function readFromStorage(): AuthSnapshot {
  if (typeof window === "undefined") {
    return { ...INITIAL };
  }
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    const userRaw = window.localStorage.getItem(USER_KEY);
    if (!token || !userRaw) {
      return {
        authReady: true,
        isAuthenticated: false,
        token: null,
        user: null,
        role: null,
      };
    }
    const user = JSON.parse(userRaw) as SafeUser;
    return {
      authReady: true,
      isAuthenticated: true,
      token,
      user,
      role: user.role,
    };
  } catch {
    // Corrupt storage → treat as unauthenticated, ready.
    return {
      authReady: true,
      isAuthenticated: false,
      token: null,
      user: null,
      role: null,
    };
  }
}

function emit(next: AuthSnapshot): void {
  current = next;
  for (const l of listeners) l();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synchronously read the current snapshot. Used by non-React code
 * (the api() function checks `authStore.snapshot().token`).
 */
export function snapshot(): AuthSnapshot {
  return current;
}

/**
 * Force-publish the current localStorage state. Called once on
 * first mount + after login / logout writes from auth.ts.
 */
export function refresh(): void {
  emit(readFromStorage());
}

/**
 * Idempotent hydration trigger. The first call reads localStorage
 * + flips authReady=true; subsequent calls are no-ops.
 *
 * useAuthReady() invokes this on first mount so the app doesn't
 * need a separate "init" call.
 */
let hydrated = false;
export function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  refresh();
}

/**
 * Subscribe to changes. Returns the unsubscriber. Used by
 * useAuthReady() and any other component that wants to re-render
 * on auth changes.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Cross-tab sync
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // Re-read when localStorage changes from another tab. The
  // dashboard layout already has a hard-redirect-on-storage-change
  // for security; this is the softer per-tab refresh that keeps the
  // current snapshot honest until that redirect lands.
  window.addEventListener("storage", (e) => {
    if (e.key !== TOKEN_KEY && e.key !== USER_KEY) return;
    refresh();
  });
}

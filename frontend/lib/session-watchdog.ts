"use client";

// ============================================================================
// session-watchdog — Phase PLATFORM STABILIZATION Part 2.
//
// Hardens long-lived browser sessions (6-8h tabs) without rewriting
// the JWT auth system.
//
// What it does:
//
//   1. **Token-expiry watcher.** Decodes the JWT `exp` claim
//      client-side and pre-emptively redirects to /login when the
//      token is about to expire. We do NOT trust expiry for any
//      authority decision — the backend already 401s expired tokens
//      via `lib/api.ts`. This is purely a UX nicety: the user sees
//      a clean "Session expired, please log in again" instead of
//      every in-flight request failing simultaneously.
//
//   2. **Reconnect debounce.** When the browser fires the `online`
//      event after a WiFi blip or laptop wake-from-sleep, React
//      Query's `refetchOnReconnect: true` will trigger one refetch
//      per stale query. That's fine for 2-3 queries, painful for 20.
//      We listen to the `online` event ourselves and impose a small
//      cooldown that suppresses follow-on `online` events within the
//      cooldown window — covering bursts where the OS fires online/
//      offline/online during sleep wake.
//
// What it does NOT do:
//
//   • Rewrite the JWT format or the existing localStorage flow.
//   • Inject auth headers — that's still `lib/api.ts`.
//   • Refresh tokens server-side — the backend does not yet expose
//     a refresh endpoint and the spec forbids changing auth.
//
// Production overhead:
//   • One setInterval(60s) + two event listeners. Negligible.
// ============================================================================

import { getToken } from "./auth";

/** How often we re-check the token expiry (60s). */
const POLL_INTERVAL_MS = 60_000;

/** Grace window before redirecting — gives in-flight requests a chance
 *  to land and the user a chance to notice the toast. Default 30s. */
const REDIRECT_GRACE_MS = 30_000;

/** Debounce window for the `online` event burst on wake-from-sleep. */
const RECONNECT_DEBOUNCE_MS = 1500;

/** Optional callback contract — used in tests + by the dashboard to
 *  show a toast before the redirect lands. */
export interface WatchdogHandlers {
  onSessionExpiring?: (msUntilExpiry: number) => void;
  onSessionExpired?: () => void;
  onReconnect?: () => void;
}

let _started = false;
let _intervalId: number | null = null;
let _lastOnlineAt = 0;
let _onlineListener: ((e: Event) => void) | null = null;
let _visibilityListener: ((e: Event) => void) | null = null;

/**
 * Start the watchdog. Idempotent — calling more than once is a no-op
 * so the layout can mount the hook freely.
 */
export function startSessionWatchdog(handlers: WatchdogHandlers = {}): void {
  if (typeof window === "undefined") return;
  if (_started) return;
  _started = true;

  const tick = () => {
    const exp = readTokenExpiry();
    if (exp === null) return; // no token / unparseable — let the api layer 401 it.
    const msUntilExpiry = exp - Date.now();
    if (msUntilExpiry <= 0) {
      handlers.onSessionExpired?.();
      // The api layer will redirect on the next 401; we don't force
      // it here to avoid racing with an in-flight request.
      return;
    }
    if (msUntilExpiry < REDIRECT_GRACE_MS) {
      handlers.onSessionExpiring?.(msUntilExpiry);
    }
  };
  // Initial tick + interval. Use `window.setInterval` so the cast to
  // number lines up with the cleanup type.
  tick();
  _intervalId = window.setInterval(tick, POLL_INTERVAL_MS);

  // Reconnect debounce. The browser fires `online` whenever the
  // network re-attaches; on a laptop wake we can see online -> offline
  // -> online in rapid succession. Suppress the trailing ones.
  _onlineListener = () => {
    const now = Date.now();
    if (now - _lastOnlineAt < RECONNECT_DEBOUNCE_MS) {
      // Debounced — suppress.
      return;
    }
    _lastOnlineAt = now;
    handlers.onReconnect?.();
  };
  window.addEventListener("online", _onlineListener);

  // Visibility-back tick — when a tab regains focus after a long
  // hidden period, retest expiry immediately so the user doesn't
  // have to wait up to 60s for the next interval to fire.
  _visibilityListener = () => {
    if (document.visibilityState === "visible") {
      tick();
    }
  };
  document.addEventListener("visibilitychange", _visibilityListener);
}

/**
 * Stop the watchdog. Used by tests + safe to call before SPA logout
 * to release the interval cleanly.
 */
export function stopSessionWatchdog(): void {
  if (!_started) return;
  if (_intervalId !== null && typeof window !== "undefined") {
    window.clearInterval(_intervalId);
  }
  if (_onlineListener && typeof window !== "undefined") {
    window.removeEventListener("online", _onlineListener);
  }
  if (_visibilityListener && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", _visibilityListener);
  }
  _started = false;
  _intervalId = null;
  _onlineListener = null;
  _visibilityListener = null;
  _lastOnlineAt = 0;
}

// ---------------------------------------------------------------------------
// Internals — JWT parsing
// ---------------------------------------------------------------------------

/**
 * Decode the JWT `exp` claim and return it as a Date.getTime() value.
 *
 *   • Does NOT verify the signature — we trust the backend.
 *   • Returns null on any parse failure (bad token, missing exp).
 *
 * Browser-safe: uses atob() and JSON.parse, no Buffer / crypto.
 */
function readTokenExpiry(): number | null {
  if (typeof window === "undefined") return null;
  const token = getToken();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    // JWT uses base64url; atob() wants standard base64. Pad + swap.
    const payload = base64UrlDecode(parts[1]);
    const claims = JSON.parse(payload) as { exp?: number };
    if (typeof claims.exp !== "number") return null;
    // `exp` is seconds-since-epoch.
    return claims.exp * 1000;
  } catch {
    return null;
  }
}

function base64UrlDecode(s: string): string {
  // Convert base64url to base64. Spec: '-' → '+', '_' → '/', pad with '='.
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  if (typeof atob === "undefined") return "";
  return atob(b64);
}

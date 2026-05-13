/**
 * Tiny typed HTTP client. Attaches the JWT from localStorage automatically
 * and normalizes NestJS error responses into `ApiError`.
 *
 * Auth-failure policy:
 *
 *   • 401 Unauthorized → token / session problem (missing, expired,
 *     invalid signature, user deleted). Clears local auth state, shows
 *     a toast, and hard-navigates to /login. The session is genuinely
 *     gone, so logging out is the only safe response.
 *
 *   • 403 Forbidden → "you're authenticated, just not allowed to do
 *     THIS thing." Could be a role mismatch (admin hitting a teacher
 *     endpoint), a resource-level guard (teacher trying to grade a
 *     class they're not assigned to), or a missing profile. The
 *     session is still valid — DOES NOT log out. Callers handle 403
 *     inline (e.g., the teacher dashboard turns it into "no classes
 *     assigned yet").
 *
 * The 403-logs-out behavior used to live here briefly. It caused
 * teacher login to bounce straight back to /login when any
 * resource-level 403 fired, so we reverted to "401 only."
 *
 * Server-side renders skip the side effects (no `window`).
 */

import { toast } from "sonner";
import { getDeviceId } from "./device-id";
import { track as trackRequestPressure } from "./request-pressure";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const TOKEN_KEY = "scholaris:token";
const USER_KEY = "scholaris:user";
const SCHOOL_KEY = "scholaris:school";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
    /**
     * `Retry-After` header value (seconds) when the server provided
     * one. Populated on 429 responses so callers can render a
     * useful "try again in N seconds" message. Null when the server
     * sent no header or the value was unparseable. Optional + last
     * so existing 3-arg `new ApiError(...)` call sites stay
     * source-compatible.
     */
    public readonly retryAfter?: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Sentinel status used when `fetch()` itself rejects (no HTTP
 * response was ever produced). Real HTTP responses never return
 * status 0 — using it as a "this was a network failure" marker
 * keeps the existing `error.status` pattern intact across the app.
 */
export const NETWORK_ERROR_STATUS = 0;

/**
 * True when `error` came from a `fetch()` rejection (no HTTP
 * response landed) — i.e. backend is unreachable. Covers:
 *
 *   • `ERR_CONNECTION_REFUSED` (backend port not listening)
 *   • DNS failures / `ERR_NAME_NOT_RESOLVED`
 *   • Network unreachable / offline
 *   • CORS preflight failures (these surface as TypeError too)
 *
 * The helper is the single source of truth — every retry policy
 * across the app composes through it so all queries treat
 * server-unavailable consistently. Used by:
 *
 *   • Default retry guard in `query-client.ts`
 *   • Per-hook retry overrides in `lib/*.ts` and providers
 *
 * Returns true ONLY when the error originated below the HTTP layer.
 * 4xx/5xx responses still throw `ApiError` with their real status
 * (>= 100) and are handled by existing per-status branches.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === NETWORK_ERROR_STATUS;
  // Native fetch network failures surface as TypeError in every
  // major browser. Match by class + message to avoid false positives
  // on TypeErrors thrown elsewhere in app code.
  if (error instanceof TypeError) {
    const msg = (error.message ?? "").toLowerCase();
    return (
      msg.includes("failed to fetch") || // Chrome / Edge
      msg.includes("networkerror") || // Firefox
      msg.includes("load failed") || // Safari
      msg.includes("network request failed") // older WebKit / RN
    );
  }
  return false;
}

/**
 * Convenience alias: true when the backend appears unreachable.
 * Identical to `isNetworkError` today; kept as a separate export so
 * call sites that want to communicate intent ("show offline banner
 * because the server is unavailable") read naturally.
 */
export function isServerUnavailable(error: unknown): boolean {
  return isNetworkError(error);
}

export interface ApiOptions extends RequestInit {
  /** When false, no JWT is attached — used by the auth endpoints. */
  auth?: boolean;
  /**
   * Opt-out for the global 401 redirect. Set to false when a 401 is
   * a legitimate inline error the caller wants to handle itself
   * (e.g., the auth/login endpoint returning 401 for "Invalid email
   * or password" — we want that in the form, not a redirect loop).
   * `auth: false` already covers most of those cases, but this gives
   * authenticated callers an opt-out too.
   */
  redirectOn401?: boolean;
  /**
   * Vestigial — 403 responses no longer redirect by default, so this
   * is effectively a no-op. Kept on the type so existing callers
   * (e.g., `teachingAssignmentsApi.listMine`) that pass `redirectOn403:
   * false` continue to compile and document intent. Will be removed
   * once those usages are cleaned up.
   */
  redirectOn403?: boolean;
}

export async function api<T = unknown>(
  path: string,
  init: ApiOptions = {},
): Promise<T> {
  const {
    auth = true,
    redirectOn401 = true,
    // redirectOn403 is consumed but ignored — see ApiOptions doc above.
    redirectOn403: _redirectOn403,
    ...rest
  } = init;
  const headers = new Headers(rest.headers);
  if (!headers.has("Content-Type") && rest.body) {
    headers.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    // Per-device identifier — server logs use this to attribute
    // writes when two devices touch the same row. Only attached on
    // authenticated calls so anonymous visitors (the login page
    // itself) don't get tagged. Callers can override by setting
    // X-Device-Id in `headers` before reaching here — the offline
    // sync engine does this to forward the device that originally
    // queued the write rather than whichever one is draining now.
    if (!headers.has("X-Device-Id")) {
      const deviceId = getDeviceId();
      if (deviceId) headers.set("X-Device-Id", deviceId);
    }
  }

  // Phase performance governance — track request volume in dev so
  // the RequestPressurePanel can spot duplicate-within-5s patterns.
  // No-op in production.
  trackRequestPressure(path);
  // Phase Ω observability — measure round-trip time so we can warn
  // on slow queries in dev (>1s = something to investigate).
  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;

  // fetch() rejects with TypeError when the connection itself
  // fails (ERR_CONNECTION_REFUSED, DNS, offline). Convert to a
  // structured ApiError so:
  //   • The caller sees a typed error with status=0 instead of a
  //     raw TypeError it has to string-match against.
  //   • React Query's retry guards in `query-client.ts` and per-hook
  //     overrides can short-circuit via `isNetworkError()` rather
  //     than retrying into a dead backend.
  //   • No console-spam: a single readable warning per dead-backend
  //     call, gated on dev. The previous behavior produced a raw
  //     "Failed to load resource" entry for every retry + every
  //     polled endpoint.
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...rest, headers });
  } catch (err) {
    if (isNetworkError(err)) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          `[api] network error reaching ${path} — backend unreachable. ` +
            "React Query retries are short-circuited; the next user " +
            "action or reconnect will retry once.",
        );
      }
      throw new ApiError(
        NETWORK_ERROR_STATUS,
        "Server unavailable. Please check your connection and try again.",
        null,
      );
    }
    throw err;
  }

  // 429 → throw immediately. NEVER retry.
  //
  // Why no retry: a 429 is the server telling the client to stop.
  // Each automatic retry consumes another bucket slot, preventing
  // the throttler window from draining. Combined with React Query
  // refetch-on-mount/focus, the previous exponential-backoff retry
  // created a self-sustaining loop that only resolved with a
  // backend restart. The correct behaviour is: surface the 429
  // once, let the caller decide (typically: show a toast, give the
  // user a chance to manually retry after the cooldown).
  //
  // The Retry-After header (if present) is preserved on the
  // ApiError so the UI can render "try again in N seconds" copy.
  // `notifyThrottledOnce` still fires for the visible toast — it
  // has its own per-endpoint 60s + global 30s dedupe baked in, so
  // a burst of 429s surfaces at most one toast.
  if (res.status === 429) {
    const headerValue = res.headers.get("Retry-After");
    const retryAfterSec = parseRetryAfterHeader(headerValue);
    notifyThrottledOnce(path);
    throw new ApiError(
      429,
      "Too many requests. Please slow down and try again in a moment.",
      null,
      retryAfterSec,
    );
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body */
    }
    const message = extractMessage(body) ?? res.statusText;

    // 401 only — token / session genuinely gone. Clears local state
    // and hard-navigates to /login. Gated on `auth` so a 401 from an
    // unauthenticated endpoint (login form rejecting bad creds)
    // surfaces inline instead of looping.
    if (res.status === 401 && auth && redirectOn401) {
      handleSessionExpired(path, message);
    }

    // 403 — log it for diagnostics but do NOT log the user out. They
    // are still authenticated; they just hit a permission they don't
    // have. The caller is responsible for showing an inline empty
    // state or error message.
    if (res.status === 403) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(
          `[api] 403 forbidden: ${path}. Server said: "${message}". (No logout — caller handles inline.)`,
        );
      }
    }

    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();

  // Phase Ω dev observability — warn on slow queries + oversized
  // payloads. Both are no-ops in production. The thresholds are
  // intentionally generous (1s, 500KB); anything past them deserves
  // a look at the network tab regardless of UX impact.
  if (process.env.NODE_ENV !== "production" && startedAt > 0) {
    const durationMs = performance.now() - startedAt;
    if (durationMs > 1_000) {
      // eslint-disable-next-line no-console
      console.warn(
        `[api] slow query: ${rest.method ?? "GET"} ${path} took ${Math.round(durationMs)}ms`,
      );
    }
    const sizeBytes = text.length;
    if (sizeBytes > 500_000) {
      // eslint-disable-next-line no-console
      console.warn(
        `[api] oversized payload: ${rest.method ?? "GET"} ${path} returned ${(sizeBytes / 1024).toFixed(0)}KB. ` +
          "Consider pagination, server-side filtering, or a slimmer projection.",
      );
    }
  }

  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------------------------------------------------------------------------
// 429 header helper.
// ---------------------------------------------------------------------------

/**
 * Parse a `Retry-After` header value into seconds, or null when the
 * header is missing / unparseable. Accepts both forms RFC 9110
 * §10.2.3 lists:
 *
 *   • delta-seconds: `Retry-After: 30`
 *   • HTTP-date:     `Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`
 *
 * Returns null on any failure to parse — the caller renders a
 * generic message when null. We never auto-retry the request itself
 * (see the 429-handling block in `api`).
 */
function parseRetryAfterHeader(header: string | null): number | null {
  if (!header) return null;
  const sec = Number.parseInt(header, 10);
  if (!Number.isNaN(sec) && sec >= 0) return sec;
  const t = Date.parse(header);
  if (!Number.isNaN(t)) {
    const diffSec = Math.max(0, Math.round((t - Date.now()) / 1000));
    return diffSec;
  }
  return null;
}

/**
 * Show a single throttle toast no matter how many requests landed
 * in 429 territory. Without dedupe, a page-load fanout of 10 stuck
 * requests would surface 10 identical toasts.
 *
 * Phase performance governance — toast governance is now:
 *
 *   • Per-endpoint cooldown (60s), keyed by the endpoint family
 *     (path with the query string + ids stripped — so /students/abc
 *     and /students/def share the same bucket).
 *   • Global cap: at most ONE toast per 30s regardless of which
 *     endpoint triggered it. A storm hitting 5 endpoints at once
 *     surfaces ONE toast, not five.
 *
 * 429 retry policy: NEVER retry. Every 429 throws an ApiError
 * immediately (see the 429 block in `api`). This toast is the
 * one user-visible signal — beyond it, the caller decides what
 * to do (typically: leave the failure visible until the user
 * manually retries).
 *
 * Result: the user sees "slowing down" once per minute at most,
 * even under sustained throttle pressure.
 */
const ENDPOINT_TOAST_WINDOW_MS = 60_000;
const GLOBAL_TOAST_WINDOW_MS = 30_000;
const lastEndpointToastAt = new Map<string, number>();
let lastGlobalToastAt = 0;

function notifyThrottledOnce(path: string): void {
  if (typeof window === "undefined") return;
  const now = Date.now();

  // Strip query string + uuid-ish path segments so we group by
  // endpoint family ("/students/:id" not "/students/<uuid>?…").
  const family = endpointFamily(path);

  // Per-endpoint cooldown.
  const lastForEndpoint = lastEndpointToastAt.get(family) ?? 0;
  if (now - lastForEndpoint < ENDPOINT_TOAST_WINDOW_MS) return;

  // Global cap — even brand-new endpoints stay quiet if anyone
  // toasted recently.
  if (now - lastGlobalToastAt < GLOBAL_TOAST_WINDOW_MS) {
    // Still mark this endpoint as recently-toasted so it doesn't
    // immediately fire when the global cap clears.
    lastEndpointToastAt.set(family, now);
    return;
  }

  lastEndpointToastAt.set(family, now);
  lastGlobalToastAt = now;

  try {
    toast.error(
      "You're clicking faster than the system can process. Please wait a moment.",
      { duration: 4000 },
    );
  } catch {
    /* toaster not mounted (e.g. /login pre-mount) — swallow */
  }
}

/**
 * Reduce a request path to its endpoint family for dedupe keying.
 * Drops the query string + replaces UUIDs / numeric ids with
 * placeholders so /students/abc and /students/def collapse.
 */
function endpointFamily(path: string): string {
  // Drop query string.
  const withoutQuery = path.split("?")[0];
  // Replace UUIDs and numeric segments.
  return withoutQuery
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

/**
 * Genuine session-failure cleanup. Called only on 401s from
 * authenticated requests. Wipes auth state, toasts, hard-navigates
 * to /login. Idempotent: once the navigation is in flight, subsequent
 * calls early-out via the pathname check.
 */
function handleSessionExpired(path: string, serverMessage: string): void {
  if (typeof window === "undefined") return;
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      `[api] Session expired (401 from ${path}). Server said: "${serverMessage}". Clearing local auth state and redirecting to /login.`,
    );
  }
  if (window.location.pathname.startsWith("/login")) return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(SCHOOL_KEY);
  } catch {
    /* storage unavailable — proceed with redirect anyway */
  }
  try {
    toast.error("Session expired. Please log in again.");
  } catch {
    /* toast not mounted yet */
  }
  window.location.assign("/login");
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return;
  const obj = body as Record<string, unknown>;
  // Our Nest filter wraps: { statusCode, message: { message, error, statusCode } }
  // Simpler shapes: { message: "..." } or { message: ["..."] }
  if (typeof obj.message === "string") return obj.message;
  if (obj.message && typeof obj.message === "object") {
    const inner = obj.message as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
    if (Array.isArray(inner.message))
      return (inner.message as string[]).join(", ");
  }
  return undefined;
}

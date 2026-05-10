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
  ) {
    super(message);
    this.name = "ApiError";
  }
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

  // 429 backoff loop. We retry up to MAX_429_RETRIES with
  // exponential backoff seeded from `Retry-After` (or a sane
  // default). React Query's own retry layer is configured to
  // not double-retry on 429 — this in-line handler owns that
  // class of response.
  let attempt = 0;
  // Re-declare so the loop body can reassign on retry.
  let res: Response;
  // Phase performance governance — track request volume in dev so
  // the RequestPressurePanel can spot duplicate-within-5s patterns.
  // No-op in production.
  trackRequestPressure(path);
  // Phase Ω observability — measure round-trip time so we can warn
  // on slow queries in dev (>1s = something to investigate).
  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    res = await fetch(`${API_BASE}${path}`, { ...rest, headers });
    if (res.status !== 429) break;
    attempt += 1;
    // Long-cooldown short-circuit: if the server's Retry-After is
    // longer than 5s, the bucket isn't going to refill within a
    // reasonable retry window — sitting on it would just freeze the
    // UI for 6+ seconds before surfacing the same error. Bail out
    // immediately so the caller can render its error state. The
    // header check skips when no header is present or when the
    // value is <= 5s (existing exponential backoff still applies).
    if (retryAfterExceedsSeconds(res, 5)) {
      notifyThrottledOnce(path);
      break;
    }
    if (attempt > MAX_429_RETRIES) {
      // Phase governance — pass the path so the toast layer can
      // dedupe per-endpoint with a 60s cooldown instead of one
      // global 5s window. Background retries that recover within
      // MAX_429_RETRIES never surface a toast.
      notifyThrottledOnce(path);
      break;
    }
    const waitMs = parseRetryAfter(res, attempt);
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        `[api] 429 from ${path} — retry ${attempt}/${MAX_429_RETRIES} in ${waitMs}ms`,
      );
    }
    await sleep(waitMs);
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
// 429 backoff helpers.
// ---------------------------------------------------------------------------

const MAX_429_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 500;

/**
 * Parse `Retry-After` if present (seconds OR HTTP-date), otherwise
 * use exponential backoff with jitter: 500ms, 1s, 2s, 4s.
 */
function parseRetryAfter(res: Response, attempt: number): number {
  const header = res.headers.get("Retry-After");
  if (header) {
    const sec = Number.parseInt(header, 10);
    if (!Number.isNaN(sec) && sec >= 0) return Math.min(sec * 1000, 30_000);
    // HTTP-date form
    const t = Date.parse(header);
    if (!Number.isNaN(t)) return Math.max(0, Math.min(t - Date.now(), 30_000));
  }
  const base = DEFAULT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
  // ±25% jitter so a wave of 429s doesn't re-fire in lockstep.
  const jittered = base * (0.75 + Math.random() * 0.5);
  return Math.min(jittered, 30_000);
}

/**
 * True when the response carries a `Retry-After` header asking for
 * MORE than `thresholdSec` seconds of cooldown. Used by the 429
 * retry loop to short-circuit on long-cooldown responses — sitting
 * on a multi-second wait freezes the UI without buying anything,
 * since the bucket won't refill in time anyway.
 *
 * Returns false when:
 *   • the header is absent (no server hint → stay with backoff),
 *   • the value parses to <= thresholdSec (existing behavior),
 *   • the value can't be parsed at all (defensive fallback to retry).
 *
 * Accepts both header forms RFC 9110 §10.2.3 lists: a delta-seconds
 * integer ("Retry-After: 30") and an HTTP-date.
 */
function retryAfterExceedsSeconds(
  res: Response,
  thresholdSec: number,
): boolean {
  const header = res.headers.get("Retry-After");
  if (!header) return false;
  const sec = Number.parseInt(header, 10);
  if (!Number.isNaN(sec) && sec >= 0) return sec > thresholdSec;
  const t = Date.parse(header);
  if (!Number.isNaN(t)) return (t - Date.now()) / 1000 > thresholdSec;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 *   • Background retries that recover within MAX_429_RETRIES never
 *     fire a toast — only exhausted retries do.
 *
 * Result: the user sees "slowing down" once per minute at most,
 * even under sustained throttle pressure. Transient retries are
 * silent.
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

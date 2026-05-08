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

  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers });

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
  return (text ? JSON.parse(text) : undefined) as T;
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

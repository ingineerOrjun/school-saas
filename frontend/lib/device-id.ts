/**
 * Per-device identifier persisted in localStorage.
 *
 * Generated once on first read and stamped onto every authenticated
 * API request via the `X-Device-Id` header (see `api.ts`) plus every
 * offline-queue item (see `offline-queue.ts`). Lets server logs and
 * the offline-queue inspector identify which physical device a write
 * originated from — useful for triaging "two teachers edited the
 * same row" cases and for the multi-device-safety story.
 *
 * Key intentionally separate from the auth tokens (`scholaris:user`,
 * `scholaris:token`) so it survives logout/login and is genuinely a
 * device fingerprint, not a session marker. Clearing browser storage
 * generates a new id on next visit — that's expected and acceptable
 * (the device looks "new" from the server's perspective, which is
 * what the user effectively did).
 */

const STORAGE_KEY = "scholaris:device-id";
/** SSR sentinel — used during server-render where `window` is absent. */
const SSR_SENTINEL = "ssr";

/**
 * Read the cached id, generating a fresh one on first visit.
 * Idempotent and safe to call from any render path.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return SSR_SENTINEL;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = generateUuid();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Storage disabled (private mode quirk, third-party blocked,
    // etc.) — fall back to a per-tab in-memory id. Better than
    // breaking every API call.
    return inMemoryFallback;
  }
}

/**
 * Short, log-friendly label for the inspector and toasts.
 * "Device-abc12345" — first eight chars of the UUID. Drops the
 * dashes so it grep's cleanly in server logs.
 */
export function getDeviceLabel(): string {
  const id = getDeviceId();
  if (id === SSR_SENTINEL) return "Device-server";
  const flat = id.replace(/-/g, "");
  return `Device-${flat.slice(0, 8)}`;
}

function generateUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback for older browser targets — not RFC 4122 compliant but
  // good enough for a unique-per-device tag.
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

// Lazy-initialized in-memory fallback for the storage-unavailable
// case. Persists for the lifetime of the tab; new tabs get a new id.
const inMemoryFallback = generateUuid();

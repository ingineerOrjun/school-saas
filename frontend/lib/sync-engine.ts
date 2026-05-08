/**
 * Sync engine — drains the offline attendance queue.
 *
 * Triggered from three places (see `useSyncEngine`):
 *   • app load (mount)
 *   • `online` event (browser regained connectivity)
 *   • 30s interval while online
 *
 * Plus the manual "Sync Pending Data" button in the topbar badge.
 *
 * The engine is intentionally serial — it processes one PENDING item
 * at a time. Reasons:
 *   1. Order-preservation: if a teacher rapid-toggled (PRESENT →
 *      ABSENT → PRESENT), we MUST POST in that order so the upsert
 *      converges to the right final state.
 *   2. Backpressure: parallel posts during a flaky connection would
 *      pile up retries and amplify rate-limit pressure.
 *   3. Simpler error handling: one in-flight failure doesn't have to
 *      racetrack with siblings.
 *
 * A tiny in-memory lock prevents two triggers (e.g. interval + online
 * event firing at the same time) from running concurrently.
 */

import { toast } from "sonner";
import { api, ApiError } from "./api";
import {
  listPending,
  markFailed,
  markRetryOrFailed,
  markSynced,
  pruneSynced,
  type QueueItem,
} from "./offline-queue";

export interface SyncResult {
  attempted: number;
  synced: number;
  failed: number;
  /** First error encountered, if any — surfaced to UI for diagnostics. */
  firstError?: string;
  /** True when the engine bailed out without trying (offline / locked). */
  skipped?: boolean;
  reason?: "offline" | "locked" | "no-pending";
}

let isRunning = false;

/** Subscribers (badge UI etc.) that want to react to sync state changes. */
type Listener = (state: SyncState) => void;
export interface SyncState {
  running: boolean;
  /** Count of PENDING items at the last query — null until first run. */
  pendingCount: number | null;
  /** Last sync attempt's result — null on first mount. */
  lastResult: SyncResult | null;
}

const listeners = new Set<Listener>();
let currentState: SyncState = {
  running: false,
  pendingCount: null,
  lastResult: null,
};

function emit(next: Partial<SyncState>) {
  currentState = { ...currentState, ...next };
  for (const l of listeners) l(currentState);
}

export function getSyncState(): SyncState {
  return currentState;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  // Send the current snapshot immediately so subscribers don't sit
  // with placeholder state until the next sync runs.
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read the queue and broadcast the count. Called by the badge on
 * mount and after each enqueue so the UI updates without a full sync.
 */
export async function refreshPendingCount(): Promise<number> {
  const pending = await listPending();
  emit({ pendingCount: pending.length });
  return pending.length;
}

/**
 * Drain the queue once. Skips when offline or when a sync is already
 * in flight. Returns a summary the badge surfaces as a toast on
 * manual triggers.
 */
export async function syncNow(): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { attempted: 0, synced: 0, failed: 0, skipped: true, reason: "offline" };
  }
  if (isRunning) {
    return { attempted: 0, synced: 0, failed: 0, skipped: true, reason: "locked" };
  }
  isRunning = true;
  emit({ running: true });

  let attempted = 0;
  let synced = 0;
  let failed = 0;
  let firstError: string | undefined;

  try {
    const pending = await listPending();
    if (pending.length === 0) {
      emit({ pendingCount: 0, running: false });
      const result = { attempted: 0, synced: 0, failed: 0, skipped: true, reason: "no-pending" as const };
      emit({ lastResult: result });
      return result;
    }
    emit({ pendingCount: pending.length });

    // Process serially. `for...of` is intentional vs Promise.all.
    for (const item of pending) {
      attempted += 1;
      try {
        await postOne(item);
        await markSynced(item.id);
        synced += 1;
      } catch (err) {
        const msg = errorMessage(err);
        if (!firstError) firstError = msg;
        // 409 Conflict = optimistic-concurrency mismatch. Retrying
        // with the same payload won't help (the version is part of
        // the request signature) — escalate immediately to FAILED
        // and surface a one-time toast so the user knows to review.
        // The inspector keeps the row visible with the conflict
        // message for follow-up.
        if (err instanceof ApiError && err.status === 409) {
          await markFailed(item.id, msg);
          failed += 1;
          notifyConflict();
          continue;
        }
        // Network failure → retry later (don't escalate to FAILED yet).
        // Server-side 4xx that isn't going to magically fix itself →
        // bump retry count; markRetryOrFailed escalates to FAILED at
        // threshold so it stops re-blocking the queue forever.
        await markRetryOrFailed(item.id, msg);
        failed += 1;
        // If the error looks like a network outage, abort the pass —
        // no point hammering on the next item with the same outage.
        if (isNetworkError(err)) {
          break;
        }
      }
    }

    // House-keeping — runs at most once per sync.
    void pruneSynced().catch(() => {
      /* not critical */
    });

    // Refresh count from disk (some items moved to SYNCED / FAILED).
    const remaining = (await listPending()).length;
    const result: SyncResult = {
      attempted,
      synced,
      failed,
      firstError,
    };
    emit({ pendingCount: remaining, running: false, lastResult: result });
    return result;
  } catch (err) {
    const msg = errorMessage(err);
    const result: SyncResult = {
      attempted,
      synced,
      failed,
      firstError: firstError ?? msg,
    };
    emit({ running: false, lastResult: result });
    return result;
  } finally {
    isRunning = false;
  }
}

/**
 * Replay a queue item against the API. Generic over endpoint /
 * method / payload — every feature (attendance, marks, exams, fees)
 * uses the same call site here. The `api()` wrapper handles auth
 * headers + error normalization automatically.
 *
 * `redirectOn401: false` so a queue retry that hits an expired
 * session doesn't yank the admin out of whatever they were
 * doing — `markRetryOrFailed` will escalate the row to FAILED and
 * the inspector / topbar surfaces it for explicit retry after
 * re-auth. `redirectOn403: false` likewise — a permission change
 * mid-session shouldn't take the whole UI down.
 *
 * Backend-level idempotency is the caller's responsibility: re-posts
 * after a flaky ACK should leave the same state. The attendance
 * endpoint is `upsert + unique(studentId, date)`; the marks-grid
 * endpoint is `upsert` keyed by (studentId, subjectId); both safe.
 */
async function postOne(item: QueueItem): Promise<void> {
  // Bodies are only meaningful for mutating verbs that carry one.
  // DELETE typically has no body even though we permit one in the
  // type — we leave it on the caller to set payload to null when
  // there's nothing to send.
  const body =
    item.payload === null || item.payload === undefined
      ? undefined
      : JSON.stringify(item.payload);
  // Optimistic-concurrency token. Forwarded as a custom header so
  // it stays out of every feature's body schema. Backend feature
  // endpoints decide whether to read it; absence is harmless.
  const headers: Record<string, string> = {};
  if (item.lastKnownVersion) {
    headers["X-Last-Known-Version"] = item.lastKnownVersion;
  }
  // Source-device identifier. Forwarded from the queue item (NOT the
  // current device's id) so a write that drained on a different
  // device than where it was originally typed is still attributed to
  // the source. `api.ts` only auto-stamps when no header is set, so
  // we always win when item.deviceId is present.
  if (item.deviceId) {
    headers["X-Device-Id"] = item.deviceId;
  }
  await api(item.endpoint, {
    method: item.method,
    body,
    headers,
    redirectOn401: false,
    redirectOn403: false,
  });
}

// Debounce conflict toasts — a single sync pass might surface
// multiple 409s, but the user only needs one "go review" prompt per
// pass. Reset on the next sync.
let conflictToastFired = false;
function notifyConflict(): void {
  if (conflictToastFired) return;
  conflictToastFired = true;
  try {
    toast.error("Data changed. Please review.", {
      description:
        "One or more queued items conflict with newer server data. Open Settings → Offline queue to inspect.",
      duration: 8000,
    });
  } catch {
    /* toast not mounted — fall through silently */
  }
  // Reset after a brief debounce window so the next sync pass can
  // re-toast if NEW conflicts appear.
  setTimeout(() => {
    conflictToastFired = false;
  }, 5_000);
}

function isNetworkError(err: unknown): boolean {
  // Browser fetch rejects with TypeError("Failed to fetch") when the
  // device is offline mid-request. ApiError means we GOT a response,
  // so it's NOT a network error per se — it's a server / role / data
  // problem we should escalate normally.
  return err instanceof TypeError;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

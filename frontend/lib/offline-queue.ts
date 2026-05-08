/**
 * Generic offline write queue (IndexedDB).
 *
 * One queue serves every feature that mutates server state — the
 * stored shape is endpoint/method/payload, not domain-specific. Each
 * caller (attendance, marks, exams, fees, …) drops items via
 * `enqueue` and the sync engine fires them through `api(...)` later.
 *
 * Why a single store instead of per-feature stores:
 *   • One sync engine, one drain order, one "Sync now" button.
 *   • Inspector lists every pending action in one place.
 *   • Adding a new feature is "call enqueue with these arguments,"
 *     no schema changes.
 *
 * Keyed by uuid; `status` index lets the engine pull pending items
 * without scanning the whole store.
 */

import { getDeviceId } from "./device-id";

const DB_NAME = "scholaris-offline";
// v1 → attendance_queue
// v2 → roster_cache
// v3 → generalize attendance_queue rows to the {endpoint, method,
//      payload, feature, label} shape (existing items are migrated
//      in-place so no data is lost on upgrade)
const DB_VERSION = 3;
/** Generic write queue. Renamed conceptually but kept the same store
 * name so existing data migrates in place rather than starting fresh. */
const STORE = "attendance_queue";
/** Re-exported so `roster-cache.ts` doesn't have to redeclare the literal. */
export const ROSTER_STORE = "roster_cache";

export type QueueStatus = "PENDING" | "SYNCED" | "FAILED";

/** HTTP verbs that make sense to queue (mutating ops only). */
export type QueueMethod = "POST" | "PATCH" | "PUT" | "DELETE";

export interface QueueItem {
  id: string;
  /**
   * Path passed to `api(...)` when the engine drains this item.
   * Should be relative to the API base, e.g. `/attendance/mark`.
   */
  endpoint: string;
  method: QueueMethod;
  /**
   * JSON-serializable body. Sent verbatim. `unknown` here so each
   * feature owns its own request shape — the queue doesn't care.
   */
  payload: unknown;
  /**
   * Free-form feature tag. Used by the inspector's "Type" column and
   * future feature-specific filters. Suggested values: "attendance",
   * "marks", "exam", "fees".
   */
  feature: string;
  /**
   * Optional human label for the inspector — one-line description
   * the admin can scan to identify the row (e.g., "Class 5-A ·
   * 2026-08-30"). Falls back to the endpoint when absent.
   */
  label?: string;
  /**
   * Caller-supplied "same logical operation" identifier. When a new
   * `enqueue` call carries the same dedupKey as an existing PENDING
   * or FAILED row, the existing row is REPLACED (payload swapped,
   * retries reset) instead of accumulating duplicates. SYNCED rows
   * with the same key are left alone as history — a re-do AFTER a
   * successful sync is a real new operation, not a duplicate.
   *
   * Examples:
   *   • Per-student attendance toggle:
   *     `${scopeId}|${date}|${studentId}`
   *   • Bulk "mark all" for a class:
   *     `${scopeId}|${date}|markAll`
   *   • Marks-grid save for an (exam, subject):
   *     `${examId}|${subjectId}|gridSave`
   */
  dedupKey?: string;
  /**
   * Optimistic-concurrency token. Captured at enqueue time from the
   * data the user was looking at (e.g., the `version` returned by
   * the roster endpoint). The sync engine forwards this as the
   * `X-Last-Known-Version` header — backend feature endpoints
   * compare against the live value and 409 if drift is detected.
   *
   * Optional. Online callers that read AND write in one round trip
   * don't need it; offline-queued writes do.
   */
  lastKnownVersion?: string;
  /**
   * Identifier for the device that originally queued this write.
   * Captured at enqueue time so a write that drained later from a
   * different device (rare — a teacher signed in on two devices)
   * is still attributed to the source. Sync engine forwards as
   * `X-Device-Id` — server logs and the inspector use it to
   * triage multi-device timelines.
   */
  deviceId?: string;
  status: QueueStatus;
  retryCount: number;
  /** Epoch ms — sort by this so older items sync first. */
  createdAt: number;
  lastError?: string;
}

export interface EnqueueInput {
  endpoint: string;
  method: QueueMethod;
  payload: unknown;
  feature: string;
  label?: string;
  /** See `QueueItem.dedupKey`. Omit to disable dedup for this row. */
  dedupKey?: string;
  /** See `QueueItem.lastKnownVersion`. */
  lastKnownVersion?: string;
}

/* -------------------------------------------------------------------------- */
/* DB connection                                                              */
/* -------------------------------------------------------------------------- */

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable on server"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const tx = (e.target as IDBOpenDBRequest).transaction!;
      const oldVersion = e.oldVersion;

      // ---- v1 floor: attendance_queue ----
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("status_createdAt", ["status", "createdAt"], {
          unique: false,
        });
      }

      // ---- v2: roster_cache ----
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(ROSTER_STORE)) {
          db.createObjectStore(ROSTER_STORE, { keyPath: "scopeKey" });
        }
      }

      // ---- v3: migrate attendance-shaped rows to the generic shape ----
      // Pre-v3 rows looked like:
      //   { id, classId, date, payload: MarkAttendanceInput, status,
      //     retryCount, createdAt, lastError }
      // The generic shape replaces classId/date with endpoint/method/
      // feature/label. We rewrite each existing row in place so no
      // PENDING items are lost on upgrade.
      if (oldVersion < 3) {
        const store = tx.objectStore(STORE);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          const old = c.value as Record<string, unknown>;
          // Only migrate rows that don't already have `endpoint` —
          // makes this idempotent on partially-migrated DBs.
          if (typeof old.endpoint !== "string") {
            const oldClassId = typeof old.classId === "string" ? old.classId : "";
            const oldDate = typeof old.date === "string" ? old.date : "";
            const migrated: QueueItem = {
              id: String(old.id),
              endpoint: "/attendance/mark",
              method: "POST",
              payload: old.payload ?? null,
              feature: "attendance",
              label:
                oldClassId || oldDate
                  ? `${oldClassId}${oldClassId && oldDate ? " · " : ""}${oldDate}`
                  : undefined,
              status: (old.status as QueueStatus) ?? "PENDING",
              retryCount:
                typeof old.retryCount === "number" ? old.retryCount : 0,
              createdAt:
                typeof old.createdAt === "number" ? old.createdAt : Date.now(),
              lastError:
                typeof old.lastError === "string" ? old.lastError : undefined,
            };
            c.update(migrated);
          }
          c.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("IndexedDB open blocked by another tab"));
  });
  return dbPromise;
}

/** Generate a uuid. Falls back to Math.random for older targets. */
function uuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Run an op inside a transaction on the queue store. */
function run<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const result = op(store);
        if (result instanceof IDBRequest) {
          result.onsuccess = () => resolve(result.result);
          result.onerror = () => reject(result.error);
        } else {
          result.then(resolve, reject);
        }
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/**
 * Open a transaction on a custom store (used by `roster-cache.ts` so
 * it can share the same DB connection without duplicating the open
 * dance). Generic over the store name + result type.
 */
export function runOn<T>(
  storeName: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = op(store);
        if (result instanceof IDBRequest) {
          result.onsuccess = () => resolve(result.result);
          result.onerror = () => reject(result.error);
        } else {
          result.then(resolve, reject);
        }
        tx.onerror = () => reject(tx.error);
      }),
  );
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Drop a write into the queue. Returns the persisted item — useful
 * when the caller wants the assigned id (e.g., for an optimistic-UI
 * correlation).
 *
 * Dedup behavior: when `dedupKey` is supplied AND a PENDING or FAILED
 * row with the same key already exists, that row is REPLACED in place
 * (payload swapped, retryCount reset, status returned to PENDING,
 * lastError cleared). The original `id` and `createdAt` are preserved
 * so the item's drain order stays the same and any UI keyed on `id`
 * keeps working. SYNCED rows with the same key are left alone — a
 * fresh operation AFTER a successful sync is a real new write, not a
 * duplicate.
 *
 * Example:
 *   await enqueue({
 *     endpoint: "/attendance/mark",
 *     method: "POST",
 *     payload: { date, entries: [{ studentId, status }] },
 *     feature: "attendance",
 *     label: `${sectionId} · ${date}`,
 *     dedupKey: `${sectionId}|${date}|${studentId}`,
 *   });
 */
export async function enqueue(input: EnqueueInput): Promise<QueueItem> {
  return run("readwrite", (store) => {
    return new Promise<QueueItem>((resolve, reject) => {
      const finalize = (item: QueueItem) => {
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(put.error);
      };

      // Snapshot the device id once per enqueue. Same value goes on
      // both the new-row and dedup-replace paths.
      const deviceId = getDeviceId();

      // Path A: no dedup requested → straight insert.
      if (!input.dedupKey) {
        const item: QueueItem = {
          id: uuid(),
          endpoint: input.endpoint,
          method: input.method,
          payload: input.payload,
          feature: input.feature,
          label: input.label,
          lastKnownVersion: input.lastKnownVersion,
          deviceId,
          status: "PENDING",
          retryCount: 0,
          createdAt: Date.now(),
        };
        const add = store.add(item);
        add.onsuccess = () => resolve(item);
        add.onerror = () => reject(add.error);
        return;
      }

      // Path B: scan for a replaceable row (PENDING or FAILED) with
      // the same dedupKey. We don't index dedupKey — the queue is
      // small enough that a cursor walk is cheap, and adding an
      // index would force a DB version bump on every user.
      const cursor = store.openCursor();
      let replaced = false;
      cursor.onsuccess = () => {
        if (replaced) return;
        const c = cursor.result;
        if (!c) {
          // Walked the whole store without finding a match — insert.
          const item: QueueItem = {
            id: uuid(),
            endpoint: input.endpoint,
            method: input.method,
            payload: input.payload,
            feature: input.feature,
            label: input.label,
            dedupKey: input.dedupKey,
            lastKnownVersion: input.lastKnownVersion,
            deviceId,
            status: "PENDING",
            retryCount: 0,
            createdAt: Date.now(),
          };
          const add = store.add(item);
          add.onsuccess = () => resolve(item);
          add.onerror = () => reject(add.error);
          return;
        }
        const existing = c.value as QueueItem;
        if (
          existing.dedupKey === input.dedupKey &&
          existing.status !== "SYNCED"
        ) {
          // Found a replaceable row — swap its mutable fields. Keep
          // id + createdAt so drain order is preserved and any
          // open UI bound to the id stays correct.
          //
          // `lastKnownVersion` is also overwritten: a newer enqueue
          // means the user just saw fresher data, so the version
          // they're staking their write against is the new one.
          //
          // `deviceId` is updated to the latest writer too — the
          // newest device is the canonical source of the row's
          // current intent. The original device's contribution can
          // still be audited via server-side logs (every prior
          // attempt would have been logged before being replaced).
          replaced = true;
          const merged: QueueItem = {
            ...existing,
            endpoint: input.endpoint,
            method: input.method,
            payload: input.payload,
            label: input.label ?? existing.label,
            feature: input.feature,
            lastKnownVersion:
              input.lastKnownVersion ?? existing.lastKnownVersion,
            deviceId,
            status: "PENDING",
            retryCount: 0,
            lastError: undefined,
          };
          finalize(merged);
          return;
        }
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  });
}

/** PENDING items, oldest-first (drained in submission order). */
export async function listPending(): Promise<QueueItem[]> {
  return run("readonly", (store) => {
    return new Promise<QueueItem[]>((resolve, reject) => {
      const results: QueueItem[] = [];
      const range = IDBKeyRange.bound(
        ["PENDING", -Infinity],
        ["PENDING", Infinity],
      );
      const cursor = store.index("status_createdAt").openCursor(range);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          results.push(c.value as QueueItem);
          c.continue();
        } else {
          resolve(results);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });
  });
}

/** Count of items currently PENDING. Drives the topbar pill. */
export async function countPending(): Promise<number> {
  return run("readonly", (store) =>
    store.index("status").count(IDBKeyRange.only("PENDING")),
  );
}

/** Mark an item as SYNCED. Kept in the store as history, not deleted. */
export async function markSynced(id: string): Promise<void> {
  await run("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const get = store.get(id);
      get.onsuccess = () => {
        const item = get.result as QueueItem | undefined;
        if (!item) return resolve();
        item.status = "SYNCED";
        item.lastError = undefined;
        const put = store.put(item);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
  });
}

/**
 * Immediately move an item to FAILED without bumping retryCount —
 * used for non-retryable errors (e.g., a 409 conflict where the
 * payload would just be rejected again on retry). The error message
 * is preserved for the inspector. Caller-driven retry (via the
 * inspector's per-row Retry button) still works — that path resets
 * retryCount and moves the item back to PENDING.
 */
export async function markFailed(
  id: string,
  errorMessage: string,
): Promise<void> {
  await run("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const get = store.get(id);
      get.onsuccess = () => {
        const item = get.result as QueueItem | undefined;
        if (!item) return resolve();
        item.status = "FAILED";
        item.lastError = errorMessage;
        const put = store.put(item);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
  });
}

/**
 * Increment retryCount and (past `failureThreshold`) move the item
 * to FAILED. Stores `lastError` for diagnostics.
 */
export async function markRetryOrFailed(
  id: string,
  errorMessage: string,
  failureThreshold = 5,
): Promise<QueueItem | null> {
  return run("readwrite", (store) => {
    return new Promise<QueueItem | null>((resolve, reject) => {
      const get = store.get(id);
      get.onsuccess = () => {
        const item = get.result as QueueItem | undefined;
        if (!item) return resolve(null);
        item.retryCount += 1;
        item.lastError = errorMessage;
        if (item.retryCount >= failureThreshold) {
          item.status = "FAILED";
        }
        const put = store.put(item);
        put.onsuccess = () => resolve(item);
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
  });
}

/** Return EVERY item — used by the inspector. Newest-first. */
export async function listAll(): Promise<QueueItem[]> {
  return run("readonly", (store) => {
    return new Promise<QueueItem[]>((resolve, reject) => {
      const results: QueueItem[] = [];
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          results.push(c.value as QueueItem);
          c.continue();
        } else {
          results.sort((a, b) => b.createdAt - a.createdAt);
          resolve(results);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });
  });
}

/** Permanent, destructive removal — paired with a UI-level confirm. */
export async function deleteById(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

/** Reset one item to PENDING (clears retryCount + lastError). */
export async function retryItem(id: string): Promise<void> {
  await run("readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const get = store.get(id);
      get.onsuccess = () => {
        const item = get.result as QueueItem | undefined;
        if (!item) return resolve();
        item.status = "PENDING";
        item.retryCount = 0;
        item.lastError = undefined;
        const put = store.put(item);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
  });
}

/** Move every FAILED row back to PENDING. Returns the count moved. */
export async function retryFailed(): Promise<number> {
  return run("readwrite", (store) => {
    return new Promise<number>((resolve, reject) => {
      let count = 0;
      const range = IDBKeyRange.only("FAILED");
      const cursor = store.index("status").openCursor(range);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          const item = c.value as QueueItem;
          item.status = "PENDING";
          item.retryCount = 0;
          item.lastError = undefined;
          c.update(item);
          count += 1;
          c.continue();
        } else {
          resolve(count);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });
  });
}

/** Housekeeping — drop SYNCED items older than `olderThanMs`. */
export async function pruneSynced(
  olderThanMs = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  return run("readwrite", (store) => {
    return new Promise<number>((resolve, reject) => {
      let count = 0;
      const range = IDBKeyRange.only("SYNCED");
      const cursor = store.index("status").openCursor(range);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          const item = c.value as QueueItem;
          if (item.createdAt < cutoff) {
            c.delete();
            count += 1;
          }
          c.continue();
        } else {
          resolve(count);
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });
  });
}

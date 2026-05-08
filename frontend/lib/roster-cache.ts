/**
 * Offline cache for the attendance roster.
 *
 * Every successful `attendanceApi.getRoster(...)` call snapshots the
 * student list into IndexedDB so the next time the teacher opens the
 * same class the page can render even with no network. When the
 * network later returns, the page silently re-pulls and freshens the
 * cache.
 *
 * Keyed by the SCOPE not the date — students don't change daily, so
 * "the latest student list we saw for Class 5-A" is a sensible
 * fallback regardless of which day the teacher is now marking. The
 * cached `status` per student is from whatever date the snapshot was
 * taken on; the UI surfaces a "last synced" indicator so teachers
 * understand they're looking at stale read-state. The mark path is
 * unaffected — toggles still go into the offline queue and post the
 * teacher's intended `(date, status)` pair.
 *
 * Shares the same IndexedDB connection / version as `offline-queue.ts`
 * via the `runOn` helper. The `roster_cache` store was added in
 * DB v2 — see the onupgradeneeded block over there.
 */

import type { AttendanceRoster, RosterScope } from "./attendance";
import { ROSTER_STORE, runOn } from "./offline-queue";

export interface CachedRoster {
  /** "section:<uuid>" or "class:<uuid>" — the IndexedDB key. */
  scopeKey: string;
  /** Original sectionId or classId for diagnostic display. */
  scopeId: string;
  scopeKind: "section" | "class";
  students: AttendanceRoster[];
  /**
   * Server-reported version (ISO timestamp = max(student.updatedAt)).
   * Lets the page detect drift between a cached snapshot and a fresh
   * server response. Optional because pre-versioning caches don't
   * have it — readers should treat `undefined` as "unknown" and
   * always replace on fresh fetch.
   */
  version?: string;
  /** Epoch ms when the roster was last fetched fresh from the network. */
  updatedAt: number;
}

/**
 * Compose the IndexedDB key for a (sectionId | classId) scope. Throws
 * when neither is set so a misuse never silently caches under "" and
 * collides across scopes.
 */
function scopeKey(scope: RosterScope): {
  key: string;
  id: string;
  kind: "section" | "class";
} {
  if (scope.sectionId) {
    return { key: `section:${scope.sectionId}`, id: scope.sectionId, kind: "section" };
  }
  if (scope.classId) {
    return { key: `class:${scope.classId}`, id: scope.classId, kind: "class" };
  }
  throw new Error("roster-cache: scope must include sectionId or classId");
}

/**
 * Snapshot a fresh roster into the cache. Called after every successful
 * network fetch. The `version` argument is the server-reported
 * `RosterResponse.version` — stored alongside the students so a future
 * compare can detect drift without a content diff.
 */
export async function cacheRoster(
  scope: RosterScope,
  students: AttendanceRoster[],
  version: string,
): Promise<void> {
  const { key, id, kind } = scopeKey(scope);
  const row: CachedRoster = {
    scopeKey: key,
    scopeId: id,
    scopeKind: kind,
    students,
    version,
    updatedAt: Date.now(),
  };
  await runOn<IDBValidKey>(ROSTER_STORE, "readwrite", (store) =>
    store.put(row),
  );
}

/**
 * Look up the cached roster for a scope. Returns null when nothing
 * has been cached for it yet (first-time visit while offline).
 */
export async function getCachedRoster(
  scope: RosterScope,
): Promise<CachedRoster | null> {
  let key: string;
  try {
    key = scopeKey(scope).key;
  } catch {
    return null;
  }
  const row = await runOn<CachedRoster | undefined>(
    ROSTER_STORE,
    "readonly",
    (store) => store.get(key),
  );
  return row ?? null;
}

/** Manually drop a single scope's cache (admin-tools / debugging). */
export async function clearCachedRoster(scope: RosterScope): Promise<void> {
  let key: string;
  try {
    key = scopeKey(scope).key;
  } catch {
    return;
  }
  await runOn<undefined>(ROSTER_STORE, "readwrite", (store) =>
    store.delete(key),
  );
}

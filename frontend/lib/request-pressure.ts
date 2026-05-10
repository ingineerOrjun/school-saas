"use client";

/**
 * Request Pressure Tracker — Phase performance governance.
 *
 * Dev-only instrumentation. Hooks into the api() client to count
 * every outbound request, group by endpoint family, and surface
 * pathological patterns (rapid duplicates, high-frequency polling)
 * to the RequestPressurePanel.
 *
 * Production: completely disabled. The track() function early-exits
 * when NODE_ENV !== 'development' so there's zero overhead in
 * production builds.
 *
 * Why a separate module:
 *   • Keeps api.ts focused on the request lifecycle.
 *   • Lets the panel subscribe without coupling to the api client's
 *     internals.
 *   • Makes it trivial to remove all instrumentation in a single
 *     import-deletion if it ever becomes a problem.
 */

import * as React from "react";

interface EndpointStats {
  family: string;
  count: number;
  lastAt: number;
  /** Times this endpoint fired within 5s of a previous call. */
  duplicatesIn5s: number;
  /** Average gap between calls in ms. */
  avgGapMs: number;
  /** Last 20 timestamps (sliding window). */
  recentTimestamps: number[];
  /**
   * Phase γ — best-effort capture of the page route at the moment
   * of the last duplicate. Lets the panel show "this lookup
   * duplicated 4× — last from /attendance" so devs can find the
   * offending page without grepping.
   */
  lastDuplicateSource: string | null;
  /**
   * Phase γ — true iff this is one of the canonical reference
   * endpoints. Surfaced in the panel as a "reference data
   * duplicates" callout — those should NEVER duplicate after the
   * cache warms.
   */
  isReferenceData: boolean;
}

/**
 * Phase γ — endpoint families that are reference data. Any
 * duplicate-within-5s on these is a cache miss bug.
 */
const REFERENCE_DATA_FAMILIES = new Set([
  "/classes",
  "/subjects",
  "/teachers",
  "/academic-sessions",
  "/me/features",
  "/dashboard/summary",
  "/students",
]);

const stats = new Map<string, EndpointStats>();
const listeners = new Set<() => void>();
const RECENT_WINDOW = 20;
const DUPLICATE_WINDOW_MS = 5_000;

export function isEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Called by api() on every outbound request. No-op in production.
 */
export function track(path: string): void {
  if (!isEnabled()) return;
  const family = endpointFamily(path);
  const now = Date.now();
  const isReferenceData = REFERENCE_DATA_FAMILIES.has(family);
  const currentRoute =
    typeof window !== "undefined" ? window.location.pathname : null;
  const existing = stats.get(family);
  if (!existing) {
    stats.set(family, {
      family,
      count: 1,
      lastAt: now,
      duplicatesIn5s: 0,
      avgGapMs: 0,
      recentTimestamps: [now],
      lastDuplicateSource: null,
      isReferenceData,
    });
  } else {
    const isDuplicate = now - existing.lastAt < DUPLICATE_WINDOW_MS;
    existing.count += 1;
    if (isDuplicate) {
      existing.duplicatesIn5s += 1;
      // Phase γ — capture the originating page on every duplicate so
      // the panel can point developers at the offending consumer.
      existing.lastDuplicateSource = currentRoute;
    }
    existing.lastAt = now;
    existing.recentTimestamps.push(now);
    if (existing.recentTimestamps.length > RECENT_WINDOW) {
      existing.recentTimestamps.shift();
    }
    // Compute average gap from the sliding window.
    if (existing.recentTimestamps.length >= 2) {
      const gaps: number[] = [];
      for (let i = 1; i < existing.recentTimestamps.length; i++) {
        gaps.push(
          existing.recentTimestamps[i] - existing.recentTimestamps[i - 1],
        );
      }
      existing.avgGapMs = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    }
  }
  notify();
}

export function snapshot(): EndpointStats[] {
  return [...stats.values()].sort((a, b) => b.count - a.count);
}

export function reset(): void {
  stats.clear();
  notify();
}

function notify(): void {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Hook for the panel. Re-renders on every tracked request — that's
 * intentional in dev (the panel itself is the consumer). Production
 * returns a stable empty array.
 */
export function useRequestPressure(): EndpointStats[] {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (!isEnabled()) return;
    return subscribe(() => force());
  }, []);
  return isEnabled() ? snapshot() : [];
}

/**
 * Endpoint-family normalization — same logic as the toast dedupe.
 * Drops query string + UUID segments + numeric ids so the tracker
 * groups /students/abc and /students/def under "/students/:id".
 */
function endpointFamily(path: string): string {
  const withoutQuery = path.split("?")[0];
  return withoutQuery
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "/:id",
    )
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

"use client";

// ---------------------------------------------------------------------------
// Request cooldown — UX-level suppression of repeated identical actions
// (refresh-button spam, retry-button double taps, etc.).
//
// Distinct from:
//   • React Query staleTime — that decides whether the cache is fresh
//     enough; cooldown decides whether to even ATTEMPT the request.
//   • UserAwareThrottlerGuard (backend) — that's the last-line defense;
//     this lives one layer up so it never has to fire for routine
//     human-pace clicking.
//
// Pattern:
//
//   if (query.isFetching) return;                          // already in-flight
//   if (!shouldAllowRequest('dashboard-refresh', 2000))    // cooldown not elapsed
//     return;
//   await query.refetch();
//
// `shouldAllowRequest` atomically checks the cooldown AND marks the
// key as just-fired when it returns true. `markRequest` is exposed
// for callers that need to record a fire that bypassed the gate
// (e.g., after a manual refresh that should reset the window).
//
// Production vs dev:
//   • Cooldown ITSELF runs in production — the whole point is to
//     reduce real-world request pressure.
//   • The block-counter / subscribe surface is consumed only by the
//     dev RequestPressurePanel; production callers never touch them.
// ---------------------------------------------------------------------------

const lastFireAt = new Map<string, number>();
const blockCount = new Map<string, number>();
const listeners = new Set<() => void>();

/**
 * Returns true when the cooldown window for `key` has elapsed, and
 * side-effect-marks the key as just-fired. Returns false (and bumps
 * the block counter) otherwise.
 *
 * Atomicity: the "check, mark" pair happens synchronously against
 * the shared module map. Two simultaneous calls from two click
 * handlers cannot both return true within the cooldown window —
 * JavaScript's single-threaded event loop guarantees the second
 * call observes the first's mark.
 */
export function shouldAllowRequest(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const last = lastFireAt.get(key) ?? 0;
  if (now - last < cooldownMs) {
    blockCount.set(key, (blockCount.get(key) ?? 0) + 1);
    notify();
    return false;
  }
  lastFireAt.set(key, now);
  notify();
  return true;
}

/**
 * Mark a key as just-fired without consulting the cooldown. Used
 * when an external action (e.g., a mutation that always triggers a
 * refetch on success) should reset the window so the user's next
 * manual refresh button click waits the full cooldown.
 */
export function markRequest(key: string): void {
  lastFireAt.set(key, Date.now());
  notify();
}

/**
 * Snapshot of blocked-request counts since process start (or since
 * the last reset()). Dev panel consumer; production has no need to
 * read this.
 */
export interface CooldownBlockStat {
  key: string;
  blocks: number;
}

export function getCooldownStats(): CooldownBlockStat[] {
  return [...blockCount.entries()]
    .map(([key, blocks]) => ({ key, blocks }))
    .sort((a, b) => b.blocks - a.blocks);
}

/** Total number of suppressed requests across all keys. */
export function getTotalBlocks(): number {
  let n = 0;
  for (const v of blockCount.values()) n += v;
  return n;
}

/**
 * Clears the cooldown windows AND the block-counter. Used by the
 * dev panel's reset button and (potentially) by integration tests.
 */
export function reset(): void {
  lastFireAt.clear();
  blockCount.clear();
  notify();
}

/**
 * Subscribe to cooldown-state changes. The dev panel uses this to
 * re-render its blocks-suppressed counter live. Returns the
 * unsubscribe function.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

/**
 * Convenience hook for components that want to re-render whenever
 * the cooldown counters change. Pair with `getCooldownStats()` or
 * `getTotalBlocks()` to read the current snapshot.
 */
import * as React from "react";

export function useCooldownStats(): CooldownBlockStat[] {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => subscribe(() => force()), []);
  return getCooldownStats();
}

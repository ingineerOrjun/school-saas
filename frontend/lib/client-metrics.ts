/**
 * Client-side mobile metrics collector — Phase 26 Section 7.
 *
 * Tiny in-memory counter store. Hooks call `inc()` / `record()` to
 * track interesting client events; a future telemetry beacon can
 * read `snapshot()` and POST it. Today, the snapshot is exposed via
 * a hook (`useClientMetricsSnapshot`) so the in-app "Sync queue"
 * page can show local stats without round-tripping the server.
 *
 * Counters tracked:
 *   • sync.success / sync.fail            — per-attempt outcome
 *   • sync.latency                        — moving average (last 50)
 *   • offline.duration                    — total ms spent offline
 *                                            in this session
 *   • lowData.activations                 — times the mode flipped on
 *
 * Why not just stick this in localStorage:
 *   • These are session counters — the value is "since this tab
 *     opened," not "lifetime." A reset on reload is correct.
 *   • Telemetry beacons would copy current snapshot before page
 *     unload via `sendBeacon`; persistence is the receiver's job.
 *
 * The store is intentionally tiny + side-effect free — importable
 * anywhere, no provider needed.
 */

import * as React from "react";

interface Counter {
  count: number;
  /** Last time it was bumped (epoch ms) — useful for staleness checks. */
  lastAt: number;
}

interface MovingAverage {
  samples: number[];
  capacity: number;
}

const counters = new Map<string, Counter>();
const movingAverages = new Map<string, MovingAverage>();

export function inc(key: string, delta = 1): void {
  const c = counters.get(key) ?? { count: 0, lastAt: 0 };
  c.count += delta;
  c.lastAt = Date.now();
  counters.set(key, c);
  notify();
}

export function record(key: string, value: number, capacity = 50): void {
  const ma = movingAverages.get(key) ?? { samples: [], capacity };
  ma.samples.push(value);
  if (ma.samples.length > capacity) {
    ma.samples.shift();
  }
  movingAverages.set(key, ma);
  notify();
}

export interface MetricsSnapshot {
  /** Counter values keyed by name. */
  counters: Record<string, number>;
  /** Average + sample count per moving-average key. */
  averages: Record<string, { avg: number; samples: number }>;
  /** Capture timestamp. */
  at: string;
}

export function snapshot(): MetricsSnapshot {
  const c: Record<string, number> = {};
  for (const [k, v] of counters) c[k] = v.count;
  const a: Record<string, { avg: number; samples: number }> = {};
  for (const [k, v] of movingAverages) {
    if (v.samples.length === 0) {
      a[k] = { avg: 0, samples: 0 };
    } else {
      const sum = v.samples.reduce((s, x) => s + x, 0);
      a[k] = { avg: sum / v.samples.length, samples: v.samples.length };
    }
  }
  return { counters: c, averages: a, at: new Date().toISOString() };
}

/** Reset everything — used by tests and the in-app "Reset stats" button. */
export function reset(): void {
  counters.clear();
  movingAverages.clear();
  notify();
}

// ---------------------------------------------------------------------------
// React subscription
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

/**
 * Live snapshot for components. Re-renders on every counter update.
 * Use sparingly (the snapshot diagnostics page is the primary
 * consumer); anything in a hot path should call snapshot() once
 * inside an effect instead of subscribing.
 */
export function useClientMetricsSnapshot(): MetricsSnapshot {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const onUpdate = () => force();
    listeners.add(onUpdate);
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);
  return snapshot();
}

// ---------------------------------------------------------------------------
// Convenience helpers — pre-named keys so call sites don't drift
// ---------------------------------------------------------------------------

export const Metrics = {
  syncSuccess: () => inc("sync.success"),
  syncFail: () => inc("sync.fail"),
  syncLatencyMs: (ms: number) => record("sync.latency", ms),
  offlineDurationMs: (ms: number) => inc("offline.duration", ms),
  lowDataActivation: () => inc("lowData.activations"),
};

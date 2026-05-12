// ============================================================================
// txRollingWindow — Phase RELIABILITY-III Part 7.
//
// Lightweight sliding-window counter for transaction events. Pairs
// with `tx-telemetry.ts` (which holds lifetime counters) — this file
// owns "the last N minutes" view that the operations cockpit + dev
// panel can render.
//
// Why a separate file:
//   • The lifetime counters in `tx-telemetry.ts` answer "how many
//     times has this label ever exhausted retries on this process?"
//   • This file answers "how many times in the last 5 minutes?"
//   • The two have different cost profiles + data structures. The
//     lifetime counter is a single int per (label, reason). The
//     rolling window is a small ring buffer per label.
//
// What we count over the rolling window:
//   • Retries (P2034 retries that fired)
//   • Exhaustions (retry-budget run out)
//   • Validation failures (a 4xx aborted the transaction)
//   • Conflict failures (P2002 collisions)
//
// Why 5 minutes:
//   • Long enough to spot a real spike (10+ events in 5min)
//   • Short enough that the buffer is small (60 buckets at 5s each)
//   • Reset-free: old buckets evict naturally on every snapshot
//
// Production overhead:
//   • One push to an array + one mod operation per event. Total
//     memory: 60 small numeric buckets × N distinct labels. Bounded
//     well under 1 KB even at 50 labels.
//
// Privacy:
//   • Only labels + counts. No row ids, actor ids, schoolIds, payloads.
// ============================================================================

const WINDOW_MS = 5 * 60_000;
const BUCKET_MS = 5_000;
const BUCKET_COUNT = Math.ceil(WINDOW_MS / BUCKET_MS); // 60

export type RollingEventKind =
  | 'retry'
  | 'exhausted'
  | 'validation_fail'
  | 'conflict_fail';

/**
 * A single label's rolling window. Holds one ring per event kind so
 * a snapshot can report per-kind rates per label cheaply.
 */
interface LabelWindow {
  // bucketIndex → count
  rings: Record<RollingEventKind, Uint16Array>;
  // wall-clock time when each bucket index was last written. Used to
  // detect stale buckets that should be treated as zero.
  bucketStamps: Float64Array;
}

const windowsByLabel = new Map<string, LabelWindow>();

function bucketIndex(now: number): number {
  return Math.floor(now / BUCKET_MS) % BUCKET_COUNT;
}

function ensureWindow(label: string): LabelWindow {
  let w = windowsByLabel.get(label);
  if (!w) {
    w = {
      rings: {
        retry: new Uint16Array(BUCKET_COUNT),
        exhausted: new Uint16Array(BUCKET_COUNT),
        validation_fail: new Uint16Array(BUCKET_COUNT),
        conflict_fail: new Uint16Array(BUCKET_COUNT),
      },
      bucketStamps: new Float64Array(BUCKET_COUNT),
    };
    windowsByLabel.set(label, w);
  }
  return w;
}

/**
 * Record one event for a label in the current bucket. If the bucket
 * was last touched more than WINDOW_MS ago, its previous count is
 * discarded (effectively zeroed) before adding the new event.
 */
export function recordRollingEvent(
  label: string,
  kind: RollingEventKind,
): void {
  const now = Date.now();
  const idx = bucketIndex(now);
  const w = ensureWindow(label);
  if (now - w.bucketStamps[idx] > WINDOW_MS) {
    // Stale bucket — wrapped around to overwrite an entry older than
    // the window. Zero every kind for this bucket so we never bleed
    // a count older than 5 minutes into the rolling sum.
    for (const k of Object.keys(w.rings) as RollingEventKind[]) {
      w.rings[k][idx] = 0;
    }
  }
  w.bucketStamps[idx] = now;
  // Saturating-increment with Uint16Array's 65535 cap — counts beyond
  // that are extraordinarily rare and we'd rather not overflow.
  if (w.rings[kind][idx] < 65535) {
    w.rings[kind][idx] += 1;
  }
}

/**
 * Snapshot of every label's rolling counts. Each entry sums only the
 * buckets that fall within the last WINDOW_MS — older buckets are
 * skipped, so a long-idle label reports zero instead of stale data.
 */
export function snapshotRollingWindow(): Array<{
  label: string;
  windowMs: number;
  retry: number;
  exhausted: number;
  validationFail: number;
  conflictFail: number;
}> {
  const now = Date.now();
  const result: Array<{
    label: string;
    windowMs: number;
    retry: number;
    exhausted: number;
    validationFail: number;
    conflictFail: number;
  }> = [];
  for (const [label, w] of windowsByLabel.entries()) {
    let retry = 0;
    let exhausted = 0;
    let validationFail = 0;
    let conflictFail = 0;
    for (let i = 0; i < BUCKET_COUNT; i++) {
      const stamp = w.bucketStamps[i];
      if (stamp === 0 || now - stamp > WINDOW_MS) continue;
      retry += w.rings.retry[i];
      exhausted += w.rings.exhausted[i];
      validationFail += w.rings.validation_fail[i];
      conflictFail += w.rings.conflict_fail[i];
    }
    result.push({
      label,
      windowMs: WINDOW_MS,
      retry,
      exhausted,
      validationFail,
      conflictFail,
    });
  }
  return result;
}

/** Test-only reset. */
export function _resetRollingWindow(): void {
  windowsByLabel.clear();
}

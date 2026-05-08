// ---------------------------------------------------------------------------
// Compare-mode helpers — compute previous-period values from existing
// data shapes without backend round-trips.
//
// The Fees + Overview tabs already receive a 12-month trend series
// (`monthlyTrend`) from `/fees/summary`. That single payload covers
// both compare modes we ship today:
//
//   • prev_month → trend[trend.length - 2] (the one before the most
//                   recent entry, which is the current month)
//   • prev_year  → trend[trend.length - 13] — but we only have 12
//                   buckets so this is unavailable. We fall back to
//                   the oldest bucket (12 months ago); same calendar
//                   month from last year would require expanding the
//                   trend window — Phase 2.2.
//
// Returning `null` for "no comparison available" keeps the consumer
// path uniform — `<DeltaBadge>` renders an "n/a" pill in that case.
// ---------------------------------------------------------------------------

import type { CompareMode } from "./_filters";

export interface MonthBucket {
  month: string;
  collected?: number;
  count?: number;
}

/**
 * Given a 12-month trend array (oldest-first) and a compare mode,
 * return the previous-period value to compare the most recent bucket
 * against.
 *
 *   trend = [Jan…Dec], compare = "prev_month" → Nov's value
 *   trend = [Jan…Dec], compare = "prev_year"  → Jan's value (the
 *                                                oldest bucket; "true"
 *                                                year-over-year would
 *                                                need a 13-month
 *                                                series)
 *   compare = "none" → null (caller renders plain card)
 *
 * `field` selects which numeric on the bucket to read — `collected`
 * for fees, `count` for admissions, etc.
 */
export function previousFromTrend(
  trend: MonthBucket[],
  compare: CompareMode,
  field: "collected" | "count" = "collected",
): number | null {
  if (compare === "none") return null;
  if (trend.length < 2) return null;
  if (compare === "prev_month") {
    const bucket = trend[trend.length - 2];
    return readField(bucket, field);
  }
  if (compare === "prev_year") {
    // 13-month series would let us pick exactly 12 months back; with
    // a 12-month series the oldest bucket is the closest we can get,
    // and it's still a useful "rough year-ago" comparison for principals.
    const bucket = trend[0];
    return readField(bucket, field);
  }
  // prev_quarter / prev_session aren't supported by the trend shape;
  // those need their own backend-side baseline (Phase 2.2).
  return null;
}

/**
 * Last bucket in the trend → "current month" value. Returned
 * separately so callers can pair it with `previousFromTrend` to feed
 * `<DeltaBadge>`'s `current` and `previous` props.
 */
export function currentFromTrend(
  trend: MonthBucket[],
  field: "collected" | "count" = "collected",
): number {
  if (trend.length === 0) return 0;
  return readField(trend[trend.length - 1], field) ?? 0;
}

function readField(
  bucket: MonthBucket | undefined,
  field: "collected" | "count",
): number | null {
  if (!bucket) return null;
  const v = bucket[field];
  return typeof v === "number" ? v : null;
}

/**
 * Human-readable label for the active compare mode. Used by tabs that
 * want to render "vs. previous month" beneath a chart. Returns null
 * when compare is off so consumers can suppress the label entirely.
 */
export function compareLabel(compare: CompareMode): string | null {
  switch (compare) {
    case "prev_month":
      return "vs. previous month";
    case "prev_year":
      return "vs. ~12 months ago";
    case "prev_session":
      return "vs. previous session";
    case "none":
    default:
      return null;
  }
}

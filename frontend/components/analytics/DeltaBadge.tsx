"use client";

import * as React from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// DeltaBadge — small "↑ 12%" / "↓ 3%" pill that sits under a KPI value
// to show change vs. a previous period.
//
// Why a dedicated primitive (vs. inlining the math at every call site):
//   • Semantic coloring is non-obvious. A 12% rise in fee collection
//     reads as good (emerald); a 12% rise in absent days reads as bad
//     (destructive). That distinction lives in `goodWhen` on each
//     consumer; this component just translates it to the right tone.
//   • Edge cases: division by zero (previous = 0), both zero (no
//     change), and "n/a" (previous unknown) all need consistent
//     rendering. Encoding them once here means the Fees tab can't
//     render "↑ Infinity%" because it forgot to handle prev=0.
//   • Keyboard / a11y: a colorblind reader still sees ↑/↓/→ glyph
//     plus the formatted delta — meaning isn't carried by color alone.
//
// Inputs:
//   • current — the value the user sees on the KPI tile (typically a
//     number, but only used for sign — we pass the precomputed delta
//     in `change`).
//   • previous — the comparison value. Null/undefined → render an
//     "n/a" pill so the user knows compare-mode is on but this card
//     has no baseline.
//   • format — "percent" (default) renders a relative change with
//     sign + % suffix; "absolute" renders a signed integer without
//     a unit (used for counts like "↑ 18 students").
//   • goodWhen — does the consumer interpret an INCREASE as good or
//     bad? Drives the tone:
//       up        → ↑ green, ↓ red   (collections, attendance, admissions)
//       down      → ↑ red,   ↓ green (overdue, absences, refunds)
//       neutral   → grey both ways   (counts that aren't goal-directed)
// ---------------------------------------------------------------------------

export type DeltaSentiment = "up" | "down" | "neutral";

export interface DeltaBadgeProps {
  current: number;
  previous: number | null | undefined;
  /** "percent" → "+12%", "absolute" → "+18". Default "percent". */
  format?: "percent" | "absolute";
  /** Which direction is "good"? Drives semantic coloring. Default `up`. */
  goodWhen?: DeltaSentiment;
  /** Optional unit suffix when format === "absolute" (e.g. "students"). */
  unit?: string;
  className?: string;
}

export function DeltaBadge({
  current,
  previous,
  format = "percent",
  goodWhen = "up",
  unit,
  className,
}: DeltaBadgeProps) {
  // No baseline → "n/a" pill. Renders so the user can see compare-mode
  // is active even when a particular tile can't compute a delta. We
  // could hide entirely, but a visible "n/a" is more honest — the
  // tile genuinely doesn't have a prior value to show.
  if (previous === null || previous === undefined) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
          className,
        )}
        title="No previous-period value to compare against"
      >
        n/a
      </span>
    );
  }

  const change = current - previous;
  const direction: "up" | "down" | "flat" =
    Math.abs(change) < 1e-9 ? "flat" : change > 0 ? "up" : "down";
  const Arrow =
    direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : ArrowRight;

  // Tone derivation. `goodWhen` says which direction is positive; the
  // tone is "success" when actual direction matches that, "destructive"
  // when it goes against, "muted" when flat or when the consumer
  // declared the metric goal-neutral.
  const tone =
    direction === "flat" || goodWhen === "neutral"
      ? "muted"
      : (direction === "up" && goodWhen === "up") ||
          (direction === "down" && goodWhen === "down")
        ? "success"
        : "destructive";

  const display = formatDelta({ change, previous, current, format, unit });

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
        tone === "success" &&
          "bg-emerald-500/10 text-emerald-700",
        tone === "destructive" &&
          "bg-destructive/10 text-destructive",
        tone === "muted" && "bg-muted text-muted-foreground",
        className,
      )}
      title={
        direction === "flat"
          ? "Unchanged from previous period"
          : `Previous period: ${formatPrevious({ previous, format, unit })}`
      }
    >
      <Arrow className="h-3 w-3" aria-hidden />
      {display}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format the visible delta string. Percent format guards against
 * divide-by-zero by falling back to the absolute change with a "+"
 * marker; that reads as "value appeared (was 0)" without confusing
 * Infinity rendering.
 */
function formatDelta(input: {
  change: number;
  previous: number;
  current: number;
  format: "percent" | "absolute";
  unit?: string;
}): string {
  const { change, previous, format, unit } = input;
  const sign = change > 0 ? "+" : change < 0 ? "" : "±"; // Math handles minus
  if (format === "absolute") {
    const body = `${sign}${roundForDisplay(change)}`;
    return unit ? `${body} ${unit}` : body;
  }
  // Percent path. Previous = 0 → can't divide; show absolute change
  // prefixed with "+"/"−" instead. Reads as "appeared from nothing"
  // which is the truest interpretation.
  if (previous === 0) {
    if (change === 0) return "0%";
    return `${sign}${roundForDisplay(change)}`;
  }
  const pct = (change / Math.abs(previous)) * 100;
  return `${sign}${roundForDisplay(pct)}%`;
}

function formatPrevious(input: {
  previous: number;
  format: "percent" | "absolute";
  unit?: string;
}): string {
  const v = roundForDisplay(input.previous);
  if (input.format === "absolute") {
    return input.unit ? `${v} ${input.unit}` : String(v);
  }
  return String(v);
}

/**
 * Rounding for display only — never for math. We collapse to 1dp
 * for percentages (`+12.3%`) and to whole numbers for absolutes
 * (`+18 students`). The "1dp for non-integers" heuristic keeps
 * "+12%" tight when the change is exact while still surfacing a
 * `.3` when present.
 */
function roundForDisplay(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 100 || Number.isInteger(n)) return String(Math.round(n));
  return n.toFixed(1);
}

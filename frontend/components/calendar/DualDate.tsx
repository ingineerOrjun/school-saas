"use client";

import * as React from "react";
import { useCalendarMode } from "./CalendarProvider";
import { formatAD, toBSString } from "@/lib/date";
import { cn } from "@/lib/utils";

export interface DualDateProps {
  /**
   * Source date — accepts everything `new Date()` accepts plus
   * null/undefined. Stored A.D. is the only convention; we never
   * receive B.S. through this prop.
   */
  date: Date | string | number | null | undefined;
  /**
   * When true, renders inline (`<span>`); otherwise a block-level
   * span. Defaults to inline so it slots into existing text-y rows
   * without disrupting flex layouts.
   */
  inline?: boolean;
  /**
   * Override the calendar mode for this single instance — useful in
   * places where one column should always show A.D. regardless of the
   * user's preference (e.g. system audit logs). Falls through to the
   * provider value otherwise.
   */
  modeOverride?: "bs" | "ad" | "dual";
  /** Renders when the date is null/undefined/invalid. Defaults to em-dash. */
  fallback?: string;
  className?: string;
}

/**
 * Render a stored A.D. date in the user's preferred calendar.
 *
 *   • mode === 'bs'   → "2082-01-15"
 *   • mode === 'ad'   → "2025-04-28"
 *   • mode === 'dual' → "2082-01-15 (2025-04-28)"  with the AD half
 *                       in muted-foreground at text-xs
 *
 * If BS conversion fails (out-of-range date), the component silently
 * falls back to A.D. only — never throws, never renders garbage.
 */
export function DualDate({
  date,
  inline = true,
  modeOverride,
  fallback = "—",
  className,
}: DualDateProps) {
  const mode = useCalendarMode();
  const effective = modeOverride ?? mode;

  const ad = formatAD(date);
  if (ad === "—") {
    return (
      <span className={className} aria-label="No date">
        {fallback}
      </span>
    );
  }
  const bs = toBSString(date);
  // No BS available (out of conversion range) → fall back to AD only,
  // regardless of the chosen mode. Better than rendering "—" or the
  // ISO string with weird zeros.
  if (!bs) {
    return <span className={cn("tabular-nums", className)}>{ad}</span>;
  }

  const Wrapper: React.ElementType = inline ? "span" : "div";

  if (effective === "bs") {
    return (
      <Wrapper className={cn("tabular-nums", className)} title={`A.D. ${ad}`}>
        {bs}
      </Wrapper>
    );
  }
  if (effective === "ad") {
    return (
      <Wrapper className={cn("tabular-nums", className)} title={`B.S. ${bs}`}>
        {ad}
      </Wrapper>
    );
  }
  // Dual — BS primary, AD muted parenthetical. The whole element gets
  // a hover title with both calendars spelled out for clarity.
  return (
    <Wrapper
      className={cn("tabular-nums", className)}
      title={`B.S. ${bs} · A.D. ${ad}`}
    >
      {bs}{" "}
      <span className="text-xs text-muted-foreground">({ad})</span>
    </Wrapper>
  );
}

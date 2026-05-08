"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// KpiCard — the single primitive every analytics tab uses for headline
// numbers. Designed for principals scanning a control center; calm,
// dense, no decoration that doesn't carry information.
//
// Layout invariants:
//   • Label sits above the value, never below — eye scans top-to-bottom.
//   • Value uses tabular-nums so a row of cards lines up across columns.
//   • Hint sits below the value at half-size, wrapping if needed.
//   • Optional `tone` paints the icon background; the value itself stays
//     foreground-toned EXCEPT for `destructive`, which the eye should
//     catch first.
//   • Optional `href` makes the whole card a link — clicking drills
//     down to the relevant filtered list (e.g. "12 overdue students" →
//     /fees filtered to overdue). Without a link, hover + cursor stay
//     neutral so the cashier doesn't think it's interactive.
//
// What's deliberately NOT here:
//   • Animated number counters — we want calm under pressure, not pizzazz.
//   • Sparklines inline — those go in dedicated Trend cards below the KPI row.
//
// What IS here as of Phase 2:
//   • Optional `delta` slot — passes a `<DeltaBadge>` (or any node) that
//     sits between the value and the hint. Pre-built so every consumer
//     gets the same visual treatment without re-implementing.
// ---------------------------------------------------------------------------

export interface KpiCardProps {
  label: string;
  value: string;
  /** Optional hint line under the value (e.g. "of Rs 1,20,000 assigned"). */
  hint?: string;
  /** Lucide-style icon node, rendered in the upper-right corner. */
  icon?: React.ReactNode;
  /**
   * Visual tone of the icon chip (and the value itself for destructive).
   * Default `muted` — neutral grey background. Use `primary` for the
   * one or two cards that should catch the eye first; `destructive`
   * for "you have a problem" numbers (overdue, refunds, etc.).
   */
  tone?: "primary" | "muted" | "destructive" | "success";
  /** Click target — turns the whole card into a drilldown link. */
  href?: string;
  /**
   * Optional delta indicator (typically a `<DeltaBadge>`) shown
   * between the value and the hint. Renders only when compare mode
   * is active on the consumer; pass `null`/`undefined` to skip.
   */
  delta?: React.ReactNode;
  /** Optional className passthrough for layout overrides. */
  className?: string;
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "muted",
  href,
  delta,
  className,
}: KpiCardProps) {
  const body = (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface p-4 sm:p-5",
        // Premium-feel motion: subtle lift on hover for clickable
        // cards, plus a press-down on active so the card feels
        // tactile. Non-clickable cards stay still — animating them
        // would suggest interactivity that isn't there. `transition-all`
        // is broad on purpose: shadow, border-color, and transform
        // all move together for a unified glide.
        "transition-all duration-200",
        href &&
          "hover:shadow-md hover:border-primary/40 hover:-translate-y-px cursor-pointer active:translate-y-0 active:shadow-sm active:scale-[0.995]",
        tone === "destructive" && "border-destructive/30 bg-destructive/[0.04]",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md shrink-0",
              tone === "primary" && "bg-primary/10 text-primary",
              tone === "muted" && "bg-muted text-muted-foreground",
              tone === "destructive" && "bg-destructive/10 text-destructive",
              tone === "success" && "bg-emerald-500/10 text-emerald-700",
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums tracking-tight",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      {/* Delta sits BETWEEN value and hint so the eye reads:
          big number → change-vs-previous → context. Hidden entirely
          when consumer doesn't pass one. */}
      {delta && <div className="mt-1.5">{delta}</div>}
      {hint && (
        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums leading-snug">
          {hint}
        </p>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }
  return body;
}

/**
 * Skeleton variant — matches `<KpiCard>` height so a loading row doesn't
 * shift layout when the data arrives.
 */
export function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-7 w-7 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="mt-2 h-7 w-32 animate-pulse rounded bg-muted" />
      <div className="mt-2 h-3 w-20 animate-pulse rounded bg-muted" />
    </div>
  );
}

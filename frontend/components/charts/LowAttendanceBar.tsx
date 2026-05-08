"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface LowAttendanceBarItem {
  studentId: string;
  name: string;
  /** 0..100. Null rows (no attendance recorded) are filtered out by the parent. */
  percentage: number;
  /** Optional symbol number for display next to the name. */
  symbolNumber?: string | null;
}

export interface LowAttendanceBarProps {
  items: LowAttendanceBarItem[];
  /**
   * Threshold below which a row is highlighted as "low attendance."
   * Default 75 — matches the rest of the app's flagging.
   */
  threshold?: number;
  /**
   * Limit the rendered list. Useful for the dashboard "top 5" view.
   * Pass `0` (or omit) to render every item.
   */
  limit?: number;
  /** Optional title rendered above the bars. */
  title?: string;
  className?: string;
}

/**
 * Horizontal bar chart for low-attendance students. Sorted ascending
 * by percentage so the most concerning rows lead the list.
 *
 *   • Below threshold: red bar with destructive text — "needs follow-up."
 *   • Above threshold: emerald bar — included for context when
 *     `limit` is small (so admins see the whole picture, not just
 *     the alarms).
 *
 * Renders nothing when there's no data — the parent should already
 * suppress the section in that case.
 */
export function LowAttendanceBar({
  items,
  threshold = 75,
  limit,
  title,
  className,
}: LowAttendanceBarProps) {
  const sorted = React.useMemo(
    () => [...items].sort((a, b) => a.percentage - b.percentage),
    [items],
  );
  const visible = limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  const hiddenCount = sorted.length - visible.length;

  if (visible.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border bg-muted/10 px-4 py-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        Nothing to flag — every student is above {threshold}%.
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      {title && (
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      )}
      <ul className="space-y-2">
        {visible.map((item) => {
          const below = item.percentage < threshold;
          // Bar fill is the percentage itself — short bars read as
          // "low," long bars as "high." The threshold line is
          // overlaid on the rail to make the cutoff visually clear.
          return (
            <li
              key={item.studentId}
              className="grid grid-cols-[minmax(120px,1fr)_minmax(200px,2fr)_56px] items-center gap-3"
            >
              <div className="min-w-0">
                <div
                  className={cn(
                    "truncate text-sm font-medium",
                    below ? "text-destructive" : "text-foreground",
                  )}
                  title={item.name}
                >
                  {item.name}
                </div>
                {item.symbolNumber && (
                  <div className="truncate text-[11px] text-muted-foreground font-mono">
                    {item.symbolNumber}
                  </div>
                )}
              </div>
              <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-[width] duration-300",
                    below ? "bg-destructive" : "bg-emerald-500",
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, item.percentage))}%` }}
                />
                {/* Threshold marker — a thin vertical line at e.g. 75% */}
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40"
                  style={{ left: `${threshold}%` }}
                  aria-hidden
                />
              </div>
              <div
                className={cn(
                  "text-right text-sm font-medium tabular-nums",
                  below ? "text-destructive" : "text-foreground",
                )}
              >
                {item.percentage.toFixed(1)}%
              </div>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          + {hiddenCount} more — showing the {limit} lowest.
        </p>
      )}
    </div>
  );
}

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { TrendDayBucket } from "@/lib/attendance";
import { useCalendarMode } from "@/components/calendar/CalendarProvider";
import { formatByMode } from "@/lib/date";

export interface AttendanceTrendChartProps {
  /** Daily series oldest-first. Days with `percentage: null` are rendered as gaps. */
  data: TrendDayBucket[];
  /** Pixel height of the chart body (excluding the legend strip). */
  height?: number;
  /** Optional title rendered above the chart. */
  title?: string;
  className?: string;
}

/**
 * SVG line chart for attendance percentage over time — pairs with
 * `attendanceApi.getTrend`. Plain SVG so no chart library is needed
 * and the rendering matches the rest of the design system through
 * Tailwind classes.
 *
 * Features:
 *   • Auto y-axis from 0 to 100 with 25-unit gridlines (attendance %
 *     reads naturally on this scale; clamping to the data range
 *     would hide whether 80% is "great" or "alarming").
 *   • Gaps for null buckets (no data → segment break, not a 0% dive).
 *   • Hover dot reveals the exact percentage + date for that bucket.
 *   • Responsive width via SVG `viewBox` + `preserveAspectRatio="xMidYMid meet"`.
 *
 * Tradeoffs vs. Recharts: no animation polish, no built-in tooltips
 * (we render a small hover panel ourselves), no legend (single
 * series — none needed). ~150 lines of code, zero deps.
 */
export function AttendanceTrendChart({
  data,
  height = 220,
  title,
  className,
}: AttendanceTrendChartProps) {
  const calendarMode = useCalendarMode();
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  // Filter out the days where percentage is null for line-drawing,
  // but keep the original index for the x-axis position.
  const series = data.map((d, i) => ({ ...d, index: i }));

  if (series.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        No attendance data in this range yet.
      </div>
    );
  }

  // Layout constants. ViewBox-based so the chart scales to its
  // container without re-computing on resize.
  const VB_WIDTH = 800;
  const padLeft = 48; // y-axis labels
  const padRight = 16;
  const padTop = 12;
  const padBottom = 32; // x-axis labels
  const innerWidth = VB_WIDTH - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;

  const xFor = (i: number): number => {
    if (series.length === 1) return padLeft + innerWidth / 2;
    return padLeft + (i / (series.length - 1)) * innerWidth;
  };
  const yFor = (pct: number): number => {
    return padTop + innerHeight - (pct / 100) * innerHeight;
  };

  // Build segments — break across null buckets.
  const segments: Array<Array<{ x: number; y: number; idx: number }>> = [];
  let current: Array<{ x: number; y: number; idx: number }> = [];
  series.forEach((d, i) => {
    if (d.percentage === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: xFor(i), y: yFor(d.percentage), idx: i });
  });
  if (current.length > 0) segments.push(current);

  // Y-axis gridlines at 0 / 25 / 50 / 75 / 100.
  const gridlines = [0, 25, 50, 75, 100];

  // X-axis labels — show first, last, and ~5 evenly-spaced ticks
  // when the series is long. Avoid per-day labels for 30-day
  // series (would overlap).
  const labelStride = Math.max(1, Math.ceil(series.length / 6));
  const labelIndices = series
    .map((_, i) => i)
    .filter(
      (i) =>
        i === 0 ||
        i === series.length - 1 ||
        i % labelStride === 0,
    );

  const hovered = hoverIdx !== null ? series[hoverIdx] : null;

  // Pointer-driven hover: convert pointer x to nearest data index.
  const handleMove: React.MouseEventHandler<SVGSVGElement> = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    // Convert client x to viewBox x, then snap to the nearest index.
    const pt = ((e.clientX - rect.left) / rect.width) * VB_WIDTH;
    if (pt < padLeft || pt > padLeft + innerWidth) {
      setHoverIdx(null);
      return;
    }
    const fraction = (pt - padLeft) / innerWidth;
    const idx = Math.round(fraction * (series.length - 1));
    setHoverIdx(Math.max(0, Math.min(series.length - 1, idx)));
  };

  return (
    <div className={cn("w-full", className)}>
      {title && (
        <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      )}
      <div className="relative">
        <svg
          viewBox={`0 0 ${VB_WIDTH} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full text-emerald-500"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label="Attendance percentage over time"
        >
          {/* Gridlines */}
          {gridlines.map((g) => (
            <g key={g}>
              <line
                x1={padLeft}
                x2={VB_WIDTH - padRight}
                y1={yFor(g)}
                y2={yFor(g)}
                className="stroke-border"
                strokeWidth="1"
                strokeDasharray={g === 0 || g === 100 ? "0" : "3 3"}
              />
              <text
                x={padLeft - 6}
                y={yFor(g) + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {g}%
              </text>
            </g>
          ))}

          {/* X-axis date labels */}
          {labelIndices.map((i) => (
            <text
              key={i}
              x={xFor(i)}
              y={height - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px] tabular-nums"
            >
              {/* Calendar-aware short date — strip year to save space */}
              {shortDate(series[i].date, calendarMode)}
            </text>
          ))}

          {/* Area fill below the line — soft visual weight */}
          {segments.map((seg, segIdx) => {
            if (seg.length === 0) return null;
            const path = `M ${seg[0].x},${yFor(0)} L ${seg
              .map((p) => `${p.x},${p.y}`)
              .join(" L ")} L ${seg[seg.length - 1].x},${yFor(0)} Z`;
            return (
              <path
                key={`fill-${segIdx}`}
                d={path}
                className="fill-current opacity-10"
              />
            );
          })}

          {/* The line itself */}
          {segments.map((seg, segIdx) => (
            <polyline
              key={`line-${segIdx}`}
              points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="stroke-current"
            />
          ))}

          {/* Data dots — small so they don't crowd a 30-day series */}
          {segments.flatMap((seg) =>
            seg.map((p) => (
              <circle
                key={`dot-${p.idx}`}
                cx={p.x}
                cy={p.y}
                r="2"
                className="fill-current"
              />
            )),
          )}

          {/* Hover marker — only renders when a non-null bucket is hovered */}
          {hovered && hovered.percentage !== null && (
            <g>
              <line
                x1={xFor(hovered.index)}
                x2={xFor(hovered.index)}
                y1={padTop}
                y2={padTop + innerHeight}
                className="stroke-foreground/30"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <circle
                cx={xFor(hovered.index)}
                cy={yFor(hovered.percentage)}
                r="4"
                className="fill-current"
              />
            </g>
          )}
        </svg>

        {/* Hover panel — positioned absolutely above the SVG, fed by
            the same hoverIdx state. We use the chart container as the
            positioning context so the panel never leaves the bounds. */}
        {hovered && hovered.percentage !== null && (
          <div
            className="pointer-events-none absolute -top-2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
            style={{
              left: `calc(${(xFor(hovered.index) / VB_WIDTH) * 100}% - 60px)`,
              minWidth: "120px",
            }}
          >
            <div className="font-semibold text-foreground">
              {formatByMode(hovered.date, calendarMode)}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
              <span className="text-base font-semibold text-emerald-600">
                {hovered.percentage.toFixed(1)}%
              </span>
              <span className="text-[10px] text-muted-foreground">
                {hovered.presentCount}/{hovered.totalCount} present
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function shortDate(iso: string, mode: ReturnType<typeof useCalendarMode>): string {
  // For the x-axis we want a compact label — full ISO is too wide to
  // pack 6 of them. Strip the year and keep MM-DD; in BS the format
  // returned by formatByMode is already YYYY-MM-DD, so we slice the
  // same way. Year context is in the chart title.
  const formatted = formatByMode(iso, mode);
  // Dual mode = "BS-DATE (AD-DATE)" — too long for an axis tick.
  // Fall back to slicing the AD half off if dual.
  const trimmed = formatted.includes(" (") ? formatted.split(" (")[0] : formatted;
  // Drop the year prefix for compactness.
  return trimmed.length > 5 ? trimmed.slice(5) : trimmed;
}

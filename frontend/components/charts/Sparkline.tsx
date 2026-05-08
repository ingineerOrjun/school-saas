"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SparklineProps {
  /**
   * Series of numeric values, oldest-first. Null values are rendered
   * as gaps (the line skips through them) rather than being treated
   * as zero — keeps weekends / no-data days from collapsing the
   * baseline.
   */
  values: Array<number | null>;
  /** Pixel width of the rendered SVG. */
  width?: number;
  /** Pixel height of the rendered SVG. */
  height?: number;
  /** Stroke color. Defaults to the design-system primary. */
  strokeClassName?: string;
  /** Optional fill area below the line — softens the visual. */
  filled?: boolean;
  className?: string;
  /** Screen-reader label. Defaults to "Sparkline". */
  ariaLabel?: string;
}

/**
 * Minimal SVG sparkline — designed for inline placement next to a KPI
 * (e.g., "78% (▁▂▄▇▆▄▅) — last 7 days"). Auto-scales to its data and
 * keeps a 2px top/bottom inset so the line never touches the edges.
 *
 * Plain SVG by design: no chart library, ~80 lines, no tooltip /
 * legend overhead. For richer visuals (axes, hover, multiple series)
 * use `<AttendanceTrendChart />` instead.
 */
export function Sparkline({
  values,
  width = 100,
  height = 28,
  strokeClassName = "text-primary",
  filled = false,
  className,
  ariaLabel = "Sparkline",
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <span
        className={cn(
          "inline-block text-muted-foreground/60 text-[10px]",
          className,
        )}
      >
        no data
      </span>
    );
  }

  // Compute scale from the non-null values only — null is "no data,"
  // not zero. If everything is null, render the zero-line.
  const numericValues = values.filter((v): v is number => v !== null);
  const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const max = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  // Pad the range so a flat-line series doesn't divide by zero AND
  // doesn't draw on the very edge of the box.
  const range = max - min || 1;
  const inset = 2;
  const usableHeight = height - inset * 2;

  const project = (v: number, i: number): { x: number; y: number } => {
    const x =
      values.length === 1
        ? width / 2
        : (i / (values.length - 1)) * width;
    const y = inset + usableHeight - ((v - min) / range) * usableHeight;
    return { x, y };
  };

  // Build the polyline path. We split into segments at null gaps so
  // the SVG renders multiple disconnected polylines for "data, gap,
  // data" series — `<polyline>` doesn't support gaps natively.
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      continue;
    }
    current.push(project(v, i));
  }
  if (current.length > 0) segments.push(current);

  // Optional area fill — close each segment back to the baseline.
  const baseY = height - inset;
  const buildArea = (seg: Array<{ x: number; y: number }>) => {
    if (seg.length === 0) return "";
    const first = seg[0];
    const last = seg[seg.length - 1];
    const linePoints = seg.map((p) => `${p.x},${p.y}`).join(" L ");
    return `M ${first.x},${baseY} L ${linePoints} L ${last.x},${baseY} Z`;
  };

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      className={cn("inline-block align-middle", className)}
    >
      {filled &&
        segments.map((seg, i) => (
          <path
            key={`fill-${i}`}
            d={buildArea(seg)}
            className={cn("fill-current opacity-15", strokeClassName)}
          />
        ))}
      {segments.map((seg, i) => (
        <polyline
          key={`line-${i}`}
          points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("stroke-current", strokeClassName)}
        />
      ))}
      {/* End-of-line dot so single-day series + the latest value are
          still visible (sparklines without a dot read as flat smudges
          for very short series). */}
      {segments.length > 0 && segments[segments.length - 1].length > 0 && (
        <circle
          cx={
            segments[segments.length - 1][
              segments[segments.length - 1].length - 1
            ].x
          }
          cy={
            segments[segments.length - 1][
              segments[segments.length - 1].length - 1
            ].y
          }
          r="2"
          className={cn("fill-current", strokeClassName)}
        />
      )}
    </svg>
  );
}

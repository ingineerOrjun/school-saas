"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// StatsGrid + StatCard — KPI tile primitives.
//
// One tile shape, one grid wrapper. Pages compose KPIs by passing an
// array of `StatCardProps` to `<StatsGrid>` and let it handle column
// behaviour at every breakpoint.
//
// Variants:
//   • value          — primary number, large + tabular.
//   • valueSuffix    — small unit ("MB", "%", "ms") rendered after.
//   • delta          — optional secondary line ("+12 vs last week").
//                      Color-tinted by sign when `deltaTone` set.
//   • icon           — small slate-square glyph in the corner.
//   • tone           — outer tone (used sparingly: "danger" for
//                      warnings, default otherwise).
//   • loading        — skeleton state. Renders the shell without the value.
// ---------------------------------------------------------------------------

export interface StatCardProps {
  label: string;
  value: number | string | null;
  valueSuffix?: string;
  delta?: string;
  deltaTone?: "neutral" | "positive" | "negative";
  icon?: React.ReactNode;
  tone?: "default" | "warning" | "danger" | "success";
  loading?: boolean;
  /** Optional href turns the tile into a clickable link card. */
  href?: string;
}

const TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "border-slate-200 bg-white",
  warning: "border-amber-200 bg-amber-50/40",
  danger: "border-red-200 bg-red-50/40",
  success: "border-emerald-200 bg-emerald-50/40",
};

export function StatCard({
  label,
  value,
  valueSuffix,
  delta,
  deltaTone = "neutral",
  icon,
  tone = "default",
  loading,
  href,
}: StatCardProps) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {icon && (
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2">
        {loading ? (
          <div className="h-7 w-20 animate-pulse rounded-md bg-slate-100" />
        ) : (
          <p className="text-2xl font-semibold tabular-nums leading-none text-slate-900">
            {value === null || value === undefined ? "—" : value}
            {valueSuffix && (
              <span className="ml-1 text-sm font-normal text-slate-500">
                {valueSuffix}
              </span>
            )}
          </p>
        )}
      </div>
      {delta && !loading && (
        <p
          className={cn(
            "mt-1 text-[11px] tabular-nums",
            deltaTone === "positive" && "text-emerald-700",
            deltaTone === "negative" && "text-red-700",
            deltaTone === "neutral" && "text-slate-500",
          )}
        >
          {delta}
        </p>
      )}
    </>
  );

  const wrapperClass = cn(
    "rounded-xl border p-3.5 transition-colors",
    TONE[tone],
    href && "hover:border-slate-300 hover:bg-slate-50/60 cursor-pointer",
  );

  if (href) {
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    return (
      <a href={href} className={wrapperClass}>
        {inner}
      </a>
    );
  }
  return <div className={wrapperClass}>{inner}</div>;
}

export interface StatsGridProps {
  /** 2/3/4/5 — column count at the lg breakpoint. */
  cols?: 2 | 3 | 4 | 5;
  className?: string;
  children: React.ReactNode;
}

export function StatsGrid({ cols = 4, className, children }: StatsGridProps) {
  const gridCols: Record<2 | 3 | 4 | 5, string> = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  };
  return (
    <div className={cn("grid grid-cols-1 gap-3", gridCols[cols], className)}>
      {children}
    </div>
  );
}

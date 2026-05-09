"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SectionCard — bordered container with a title row + optional actions.
//
// The dominant content shape on every platform page. Always:
//   • white surface, slate-200 border, no shadow (operational, not flashy).
//   • title row in the slate-50 band with a small icon.
//   • optional `actions` slot on the right of the title row.
//   • optional `description` line below the title.
//   • content body sits in the white area below the band.
//
// Contrast with school-side <Card>:
//   • School cards are softer (rounded-lg, shadow-xs, hover affordances).
//   • Platform cards are squarer (rounded-xl on outer, sharp inner band)
//     and visually quieter — the operator is reading data, not browsing.
// ---------------------------------------------------------------------------

export interface SectionCardProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  /** Disable the title row when no title; renders a plain bordered box. */
  bare?: boolean;
  /** Pad the body. Default true. Set false for tables or tight layouts. */
  padded?: boolean;
  /** Severity tinting for the title band (used by health / warning panels). */
  tone?: "default" | "warning" | "danger" | "success";
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}

const TONE_BAND: Record<NonNullable<SectionCardProps["tone"]>, string> = {
  default: "bg-slate-50 border-slate-200",
  warning: "bg-amber-50/60 border-amber-200",
  danger: "bg-red-50/60 border-red-200",
  success: "bg-emerald-50/60 border-emerald-200",
};

const TONE_TEXT: Record<NonNullable<SectionCardProps["tone"]>, string> = {
  default: "text-slate-900",
  warning: "text-amber-900",
  danger: "text-red-900",
  success: "text-emerald-900",
};

export function SectionCard({
  title,
  description,
  icon,
  actions,
  bare = false,
  padded = true,
  tone = "default",
  className,
  bodyClassName,
  children,
}: SectionCardProps) {
  const showHeader = !bare && (title || actions);
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white",
        className,
      )}
    >
      {showHeader && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 border-b px-4 py-2.5",
            TONE_BAND[tone],
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            {icon && (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className={cn("text-sm font-semibold leading-tight", TONE_TEXT[tone])}>
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
          )}
        </div>
      )}
      <div className={cn(padded && "p-4", bodyClassName)}>{children}</div>
    </div>
  );
}

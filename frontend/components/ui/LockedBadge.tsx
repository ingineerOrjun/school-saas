"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// LockedBadge — small visual indicator that a record is locked /
// published / immutable. Used on:
//
//   • marksheet header (when Exam.locked = true)
//   • marks-entry table header (disables inputs alongside this badge)
//   • published academic records
//   • payment receipt header (always — receipts are immutable by
//     contract, so a permanent badge is fine)
//
// Phase data-integrity Rule 6 — the badge is informational; the
// authoritative guard is server-side. So we render visual state
// AND disable inputs where practical, but rely on the backend to
// reject any write that slips through.
// ============================================================================

export interface LockedBadgeProps {
  /** Short copy. Defaults to "Locked". */
  label?: string;
  /** Hover tooltip with extra context ("Unlock from Settings"). */
  tooltip?: string;
  /** Tone — amber for "locked, edit gated" vs slate for "permanent". */
  tone?: "amber" | "slate";
  /** Compact 11px variant for table/inline contexts. */
  size?: "sm" | "md";
  className?: string;
}

const toneClasses = {
  amber:
    "bg-amber-100 text-amber-800 ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  slate:
    "bg-slate-100 text-slate-700 ring-slate-300/60 dark:bg-slate-700/40 dark:text-slate-200 dark:ring-slate-600/40",
} as const;

const sizeClasses = {
  sm: "text-[10px] px-1.5 py-0.5 gap-1 [&_svg]:h-2.5 [&_svg]:w-2.5",
  md: "text-xs px-2 py-0.5 gap-1.5 [&_svg]:h-3 [&_svg]:w-3",
} as const;

export function LockedBadge({
  label = "Locked",
  tooltip,
  tone = "amber",
  size = "md",
  className,
}: LockedBadgeProps) {
  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center rounded-full font-semibold uppercase tracking-wider ring-1 ring-inset",
        toneClasses[tone],
        sizeClasses[size],
        className,
      )}
    >
      <Lock strokeWidth={2.5} aria-hidden />
      {label}
    </span>
  );
}

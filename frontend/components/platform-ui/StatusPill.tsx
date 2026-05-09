"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// StatusPill — single source of truth for severity-tinted chips.
//
// The platform-side pages had three or four near-identical inline pill
// implementations (StatusPill in audit.tsx, in schools.tsx, in features.tsx,
// etc.). Pulling them into one primitive removes the variance — a
// "Suspended" pill renders identically wherever it shows up.
//
// Tones:
//   default — slate (neutral / informational)
//   success — emerald (active, healthy)
//   info    — sky (trial, in progress)
//   warning — amber (attention, expired-soon)
//   danger  — red (suspended, expired, failed)
//   muted   — slate-100 with grey text (inactive, draft)
//
// Sizes:
//   xs (10px text, 1.5 padding) — table cells, dense rows
//   sm (11px text, 2 padding)   — default
//   md (12px text, 2.5 padding) — page headers
// ---------------------------------------------------------------------------

export type PillTone = "default" | "success" | "info" | "warning" | "danger" | "muted";
export type PillSize = "xs" | "sm" | "md";

export interface StatusPillProps {
  children: React.ReactNode;
  tone?: PillTone;
  size?: PillSize;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** Show a small pulsing dot before the label (useful for "live"). */
  dot?: boolean;
  /** Pull label uppercase + tracked, the audit-row look. */
  uppercase?: boolean;
  className?: string;
}

const TONE: Record<PillTone, { bg: string; text: string; ring: string; dot: string }> = {
  default: { bg: "bg-slate-100", text: "text-slate-700", ring: "ring-slate-200", dot: "bg-slate-500" },
  success: { bg: "bg-emerald-100", text: "text-emerald-800", ring: "ring-emerald-200", dot: "bg-emerald-500" },
  info: { bg: "bg-sky-100", text: "text-sky-800", ring: "ring-sky-200", dot: "bg-sky-500" },
  warning: { bg: "bg-amber-100", text: "text-amber-800", ring: "ring-amber-200", dot: "bg-amber-500" },
  danger: { bg: "bg-red-100", text: "text-red-800", ring: "ring-red-200", dot: "bg-red-500" },
  muted: { bg: "bg-slate-50", text: "text-slate-500", ring: "ring-slate-200", dot: "bg-slate-400" },
};

const SIZE: Record<PillSize, string> = {
  xs: "text-[10px] px-1.5 py-0.5 gap-1",
  sm: "text-[11px] px-2 py-0.5 gap-1.5",
  md: "text-xs px-2.5 py-1 gap-1.5",
};

export function StatusPill({
  children,
  tone = "default",
  size = "sm",
  icon,
  dot,
  uppercase,
  className,
}: StatusPillProps) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md font-semibold",
        SIZE[size],
        t.bg,
        t.text,
        uppercase && "uppercase tracking-wider",
        className,
      )}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", t.dot, "animate-pulse")}
          aria-hidden
        />
      )}
      {icon}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Convenience presets — common platform statuses with one-shot lookups.
// ---------------------------------------------------------------------------

export function SchoolStatusPill({
  status,
  size = "sm",
}: {
  status: "ACTIVE" | "TRIAL" | "SUSPENDED" | "EXPIRED";
  size?: PillSize;
}) {
  const map: Record<typeof status, { tone: PillTone; label: string }> = {
    ACTIVE: { tone: "success", label: "Active" },
    TRIAL: { tone: "info", label: "Trial" },
    SUSPENDED: { tone: "danger", label: "Suspended" },
    EXPIRED: { tone: "warning", label: "Expired" },
  };
  const m = map[status];
  return (
    <StatusPill tone={m.tone} size={size} uppercase>
      {m.label}
    </StatusPill>
  );
}

export function PlanPill({
  plan,
  size = "sm",
}: {
  plan: "TRIAL" | "MONTHLY" | "YEARLY" | "UNLIMITED" | string;
  size?: PillSize;
}) {
  // Plans share the slate look — they're informational, not severity.
  return (
    <StatusPill tone="default" size={size} uppercase>
      {plan}
    </StatusPill>
  );
}

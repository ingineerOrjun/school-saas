"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// AuditStamp — compact "who/when" line for sensitive surfaces.
//
// Renders as a single muted line, e.g.:
//
//   • "Locked by Admin · 2026-05-11 10:42 AM"
//   • "Last edited by Teacher Ram · 3 minutes ago"
//   • "Published · Jan 15, 2026"
//
// Drop into the header / footer of marksheet, receipt, attendance
// sheet, fee structure card, anywhere the user benefits from
// knowing who last touched the data. Uses the platform's existing
// muted-foreground / clock-icon visual language so it never
// competes with the primary content.
//
// Time formatting:
//   • Pass an ISO string OR a Date.
//   • Default formatter is locale + 12-hour clock with day/month.
//   • The relative-time variant is opt-in via `relative={true}`.
// ============================================================================

export interface AuditStampProps {
  /** ISO timestamp string or Date object. Required. */
  at: string | Date;
  /**
   * Display name of the actor (e.g., "Admin", "Teacher Ram",
   * "School Owner"). Optional — omit for anonymous/system actions.
   */
  actor?: string | null;
  /**
   * Verb ("locked", "published", "edited", "refunded"). Renders
   * before the actor / timestamp. Defaults to no verb.
   */
  action?: string;
  /**
   * Show as relative time ("3 minutes ago") instead of absolute.
   * Useful in real-time surfaces (notifications, recent activity).
   */
  relative?: boolean;
  /** Tone — defaults to muted. "warning" for marks-locked etc. */
  tone?: "muted" | "warning" | "success";
  className?: string;
}

const toneClasses = {
  muted: "text-muted-foreground",
  warning: "text-amber-700 dark:text-amber-400",
  success: "text-emerald-700 dark:text-emerald-400",
} as const;

export function AuditStamp({
  at,
  actor,
  action,
  relative = false,
  tone = "muted",
  className,
}: AuditStampProps) {
  const date = typeof at === "string" ? new Date(at) : at;
  const formatted = relative ? formatRelative(date) : formatAbsolute(date);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] tabular-nums",
        toneClasses[tone],
        className,
      )}
    >
      <Clock className="h-3 w-3 shrink-0" />
      {action && <span>{action}</span>}
      {actor && (
        <>
          <span>by</span>
          <span className="font-medium">{actor}</span>
        </>
      )}
      {(action || actor) && <span aria-hidden>·</span>}
      <time dateTime={date.toISOString()}>{formatted}</time>
    </span>
  );
}

function formatAbsolute(date: Date): string {
  // Dual-display format used elsewhere in the app: YYYY-MM-DD HH:MM AM/PM.
  // Avoid Intl.DateTimeFormat with locale-dependent ordering; the
  // tabular layout reads better with a fixed shape.
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hours = date.getHours();
  const period = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${h12}:${min} ${period}`;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  // Past 30 days — fall back to absolute so we don't say "5 months
  // ago" when the operator wants a calendar reference.
  return formatAbsolute(date);
}

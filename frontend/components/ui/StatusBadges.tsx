"use client";

import * as React from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Circle,
  CloudOff,
  Loader2,
  Lock,
  Pencil,
  RefreshCcw,
  Shield,
} from "lucide-react";
import { subscribe as subscribeSync, getSyncState } from "@/lib/sync-engine";
import { cn } from "@/lib/utils";

// ============================================================================
// Trust / status badges — Phase ops-visibility Part 6.
//
// Shared visual primitives used across exams, payments, attendance,
// reports surfaces so the "this row is locked / pending / failed /
// draft / published" state reads identically everywhere.
//
// All badges share:
//   • Same shape (rounded-full pill)
//   • Same vertical sizing (sm | md)
//   • Same icon-then-text layout
//   • Tone-keyed background + ring colors
// ============================================================================

interface BadgeChromeProps {
  // Lucide icons type strokeWidth as string | number, so we accept the
  // broader union rather than narrowing to number-only.
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: string | number;
  }>;
  label: string;
  tone: "amber" | "rose" | "emerald" | "slate" | "sky";
  size?: "sm" | "md";
  tooltip?: string;
  className?: string;
  /** Render the icon spinning (used for "Retrying…" / "Syncing…"). */
  spinning?: boolean;
}

const toneClasses = {
  amber:
    "bg-amber-100 text-amber-800 ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  rose:
    "bg-rose-100 text-rose-800 ring-rose-300/60 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  emerald:
    "bg-emerald-100 text-emerald-800 ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  slate:
    "bg-slate-100 text-slate-700 ring-slate-300/60 dark:bg-slate-700/40 dark:text-slate-200 dark:ring-slate-600/40",
  sky:
    "bg-sky-100 text-sky-800 ring-sky-300/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30",
} as const;

const sizeClasses = {
  sm: "text-[10px] px-1.5 py-0.5 gap-1 [&_svg]:h-2.5 [&_svg]:w-2.5",
  md: "text-xs px-2 py-0.5 gap-1.5 [&_svg]:h-3 [&_svg]:w-3",
} as const;

function BadgeChrome({
  icon: Icon,
  label,
  tone,
  size = "md",
  tooltip,
  className,
  spinning,
}: BadgeChromeProps) {
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
      <Icon strokeWidth={2.5} className={spinning ? "animate-spin" : ""} aria-hidden />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// PendingSyncBadge — "N actions waiting to sync".
//
// Live-updates by subscribing to the offline sync-engine. Pass the
// returned pending count via `count` if you want a per-row mini
// badge (e.g., on a specific attendance row); omit `count` to bind
// to the engine's global pending queue (used by the topbar).
// ---------------------------------------------------------------------------

export interface PendingSyncBadgeProps {
  /** Force a specific pending count. Omit to subscribe to the engine. */
  count?: number;
  size?: "sm" | "md";
  className?: string;
}

export function PendingSyncBadge({
  count,
  size = "md",
  className,
}: PendingSyncBadgeProps) {
  const liveCount = useEnginePendingCount(count === undefined);
  const effective = count ?? liveCount ?? 0;
  if (effective <= 0) return null;
  return (
    <BadgeChrome
      icon={CloudOff}
      label={`${effective} pending`}
      tone="amber"
      size={size}
      tooltip={`${effective} ${effective === 1 ? "action" : "actions"} waiting to sync`}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// FailedSyncBadge — surfaces the most recent sync FAILURE.
//
// Hidden when the engine has either no last result or the last
// result was a success / skip / no-pending. Reads
// `getSyncState().lastResult.firstError` for the tooltip.
// ---------------------------------------------------------------------------

export interface FailedSyncBadgeProps {
  size?: "sm" | "md";
  className?: string;
}

export function FailedSyncBadge({ size = "md", className }: FailedSyncBadgeProps) {
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    return subscribeSync((state) => {
      const result = state.lastResult;
      if (!result || result.skipped) {
        setError(null);
        return;
      }
      // Treat any first-error as a failure surface; "all good" runs
      // resolve without firstError.
      setError(result.firstError ?? null);
    });
  }, []);
  if (!error) return null;
  return (
    <BadgeChrome
      icon={AlertTriangle}
      label="Sync failed"
      tone="rose"
      size={size}
      tooltip={`Last sync error: ${error}. Will retry on next online window.`}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// DraftBadge — "unpublished" indicator. Used on result rows, exam
// rows, fee structures that exist but haven't been promoted to a
// public / final state yet.
// ---------------------------------------------------------------------------

export interface DraftBadgeProps {
  size?: "sm" | "md";
  className?: string;
}

export function DraftBadge({ size = "md", className }: DraftBadgeProps) {
  return (
    <BadgeChrome
      icon={Pencil}
      label="Draft"
      tone="slate"
      size={size}
      tooltip="Not yet published. Editable by admin / staff."
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// PublishedBadge — the corollary of DraftBadge. Render on
// surfaces where "this record is final / visible to parents" is
// the operator-relevant signal.
// ---------------------------------------------------------------------------

export interface PublishedBadgeProps {
  size?: "sm" | "md";
  className?: string;
}

export function PublishedBadge({ size = "md", className }: PublishedBadgeProps) {
  return (
    <BadgeChrome
      icon={CheckCircle2}
      label="Published"
      tone="emerald"
      size={size}
      tooltip="Final. Edits are restricted — admins must unlock to re-edit."
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// ArchivedBadge — surfaces the soft-delete state on Student / Exam
// rows. Tooltip carries the "archived on / by" trust info so operators
// don't have to open a detail view to see who hid the record.
//
// Phase DATA LIFECYCLE Part 1+5: every list that surfaces archived
// entities should pair this badge with the row so the operator
// understands why it's read-only.
// ---------------------------------------------------------------------------

export interface ArchivedBadgeProps {
  /** ISO timestamp; renders the "archived on" date in the tooltip. */
  archivedAt: string | Date | null | undefined;
  /** Optional human label for who archived it. */
  archivedByLabel?: string | null;
  /** Optional reason captured at archive time. */
  reason?: string | null;
  size?: "sm" | "md";
  className?: string;
}

export function ArchivedBadge({
  archivedAt,
  archivedByLabel,
  reason,
  size = "md",
  className,
}: ArchivedBadgeProps) {
  if (!archivedAt) return null;
  const dateLabel = formatArchivedDate(archivedAt);
  const tooltipParts: string[] = [];
  if (dateLabel) tooltipParts.push(`Archived ${dateLabel}`);
  if (archivedByLabel) tooltipParts.push(`by ${archivedByLabel}`);
  if (reason) tooltipParts.push(`— ${reason}`);
  const tooltip =
    tooltipParts.length > 0
      ? tooltipParts.join(" ")
      : "This record is archived. Restore it before editing.";
  return (
    <BadgeChrome
      icon={Archive}
      label="Archived"
      tone="slate"
      size={size}
      tooltip={tooltip}
      className={className}
    />
  );
}

/**
 * Render an ISO timestamp into the YYYY-MM-DD form used in the
 * archived tooltip. Falls back to the raw string when parsing fails so
 * the tooltip stays informative rather than going blank.
 */
function formatArchivedDate(value: string | Date): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `on ${yyyy}-${mm}-${dd}`;
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Internal hook — subscribe to sync-engine pending count.
// ---------------------------------------------------------------------------

function useEnginePendingCount(enabled: boolean): number | null {
  const [count, setCount] = React.useState<number | null>(() =>
    enabled ? getSyncState().pendingCount : null,
  );
  React.useEffect(() => {
    if (!enabled) return;
    return subscribeSync((state) => {
      setCount(state.pendingCount);
    });
  }, [enabled]);
  return count;
}

// ---------------------------------------------------------------------------
// Re-export Circle / Loader2 / RefreshCcw / Lock / Shield for
// consumers that want to compose their own one-off badges using the
// chrome (e.g., "Retrying…" pill inside a payment row that's
// auto-retrying).
//
// These were nearly used inside this file but the engine-level
// "currently retrying" surface lives in a follow-up phase; leaving
// the imports referenced here keeps the chrome ready for that work.
// ---------------------------------------------------------------------------

export const _BadgeIconRegistry = {
  Circle,
  Loader2,
  RefreshCcw,
  Lock,
  Shield,
} as const;

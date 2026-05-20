"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { StudentDto } from "@/lib/students";
import { cn } from "@/lib/utils";
import {
  getDisplayedAfterSupport,
  getEffectiveRating,
  type CellState,
  type RatingPhase,
} from "../_lib/rating-cell";

// ============================================================================
// StudentRatingRow — TWO-COLUMN layout (Deviation 001).
//
// Replaces the previous single-column-with-amber-dot-modal flow. Every
// row now shows BOTH a REGULAR and an AFTER_SUPPORT button group
// inline, matching the spec's "two-column mental model": every student
// has two ratings, with the second defaulting (visually) to the first
// until a teacher overrides.
//
// Visual contract:
//   • REGULAR group on the left, AFTER_SUPPORT group on the right.
//     Stacks vertically below 640px (`sm:flex-row` / default
//     `flex-col`) — at 375px viewport the side-by-side variant would
//     compress the 44pt buttons below the iOS minimum, so we trade
//     row height for tap-target integrity.
//   • Group labels are small uppercase muted text immediately above
//     each button strip.
//   • Per-group sync icons (clock pending / red retry failed) sit
//     immediately to the right of each group.
//   • Row accent: a 3px colored left border + a tinted background +
//     a small lucide icon at the right of the name line. All three
//     are derived from `getEffectiveRating(cell)` so they always
//     agree on what the row "means".
//
// Accessibility:
//   • The status icon carries an aria-label describing the rating
//     class ("Achieved", "Needs follow-up", etc.) so screen readers
//     get the same signal as the color.
//   • Rating buttons carry aria-label `"Rate <phase> <value>"` and
//     aria-pressed reflects the current selection.
//   • The ghosted AFTER_SUPPORT button (when default-mirroring
//     REGULAR) has aria-label `"After-support default <value> —
//     tap to confirm or change"` so a screen-reader user understands
//     the visual ghosting.
// ============================================================================

export interface StudentRatingRowProps {
  student: StudentDto;
  displayName: string;
  cell: CellState | undefined;
  /** True while this row's continuous-records query is still in
   *  flight. Disables both phase groups + surfaces a pulsing dot
   *  next to the name. */
  loadingRating: boolean;
  onRate: (phase: RatingPhase, value: 1 | 2 | 3 | 4) => void;
  /** Failed-sync retry handler. The parent reads the current
   *  cell.regular / cell.afterSupport (for the requested phase) and
   *  re-fires applyRating — same code path as a fresh tap. */
  onRetry: (phase: RatingPhase) => void;
}

const RATING_VALUES: ReadonlyArray<1 | 2 | 3 | 4> = [1, 2, 3, 4];

// ---------------------------------------------------------------------------
// Row accent — color + lucide icon + aria-label, per effective rating.
//
// Single dictionary so any future "show me what rating=2 looks like"
// question has one place to read from. The lucide icons are chosen
// for unambiguous-at-a-glance meaning at 20px:
//   • AlertTriangle (red)  — rating 1, needs significant support
//   • Zap            (yellow) — rating 2, needs follow-up
//   • Info           (blue)   — rating 3, achieved
//   • CheckCircle2   (green)  — rating 4, exceeded
// "Both color AND icon" — per the spec's accessibility-friendly choice
// over color-only.
// ---------------------------------------------------------------------------

type RowAccent = {
  rowClass: string;
  iconColor: string;
  // LucideIcon is lucide-react's canonical component type; using
  // React.ComponentType with a narrower prop shape rejected the
  // forward-refs lucide returns. The icon below is rendered via
  // <accent.Icon ... /> at the call site.
  Icon: LucideIcon;
  ariaLabel: string;
};

const ACCENT_FOR_RATING: Record<1 | 2 | 3 | 4, RowAccent> = {
  1: {
    rowClass:
      "bg-red-50 dark:bg-red-950/30 border-l-4 border-red-500",
    iconColor: "text-red-500",
    Icon: AlertTriangle,
    ariaLabel: "Needs significant support",
  },
  2: {
    rowClass:
      "bg-yellow-50 dark:bg-yellow-950/30 border-l-4 border-yellow-500",
    iconColor: "text-yellow-500",
    Icon: Zap,
    ariaLabel: "Needs follow-up",
  },
  3: {
    rowClass:
      "bg-blue-50 dark:bg-blue-950/30 border-l-4 border-blue-500",
    iconColor: "text-blue-500",
    Icon: Info,
    ariaLabel: "Achieved",
  },
  4: {
    rowClass:
      "bg-green-50 dark:bg-green-950/30 border-l-4 border-green-500",
    iconColor: "text-green-500",
    Icon: CheckCircle2,
    ariaLabel: "Exceeded expectations",
  },
};

export function StudentRatingRow({
  student,
  displayName,
  cell,
  loadingRating,
  onRate,
  onRetry,
}: StudentRatingRowProps) {
  const effective = getEffectiveRating(cell);
  const accent = effective !== null ? ACCENT_FOR_RATING[effective] : null;
  const displayedAfterSupport = getDisplayedAfterSupport(cell);

  return (
    <li
      className={cn(
        "flex flex-col gap-2 border-b border-border/60 py-3 px-3 first:border-t",
        // Without an explicit border-l fallback the absence of accent
        // would visually pop other rows out of alignment. Use a
        // transparent border-l-4 so unrated rows reserve the same 4px
        // gutter the accented rows take.
        accent ? accent.rowClass : "border-l-4 border-transparent",
      )}
      data-testid="student-row"
      data-effective-rating={effective ?? "null"}
    >
      {/* ----- First line: roll number + name + accent icon ----- */}
      <div className="flex items-center gap-2">
        <div className="w-10 shrink-0 text-right tabular-nums text-sm text-muted-foreground">
          {student.symbolNumber ?? "—"}.
        </div>
        <div className="flex-1 min-w-0 text-sm font-medium text-foreground leading-snug break-words">
          {displayName}
          {loadingRating && (
            <span
              className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/40"
              data-testid="row-loading-dot"
            />
          )}
        </div>
        {accent ? (
          <accent.Icon
            className={cn("h-5 w-5 shrink-0", accent.iconColor)}
            aria-hidden
          />
        ) : (
          // Reserve the icon slot when unrated so the row width is
          // stable as ratings come in.
          <span
            className="h-5 w-5 shrink-0"
            aria-hidden
            data-testid="row-icon-placeholder"
          />
        )}
        {/* Screen-reader-only description of the row's effective
            rating — drives parity between visual accent and AT
            announce. Always renders; "Not yet rated" when unrated. */}
        <span className="sr-only">
          {accent ? accent.ariaLabel : "Not yet rated"}
        </span>
      </div>

      {/* ----- Second line: REGULAR + AFTER SUPPORT button groups -----
          flex-col below 640px so the two groups stack on mobile (44pt
          buttons + 8 buttons wide just barely overflow 375px even
          with no gutters). sm: switches to side-by-side. */}
      <div className="flex flex-col gap-3 pl-12 sm:flex-row sm:items-start sm:gap-6">
        <PhaseGroup
          phase="REGULAR"
          label="Regular"
          value={cell?.regular ?? null}
          isGhosted={false}
          syncStatus={cell?.regularSyncStatus ?? "synced"}
          pulseKey={cell?.pulseKey ?? 0}
          disabled={loadingRating}
          onRate={(v) => onRate("REGULAR", v)}
          onRetry={() => onRetry("REGULAR")}
        />
        <PhaseGroup
          phase="AFTER_SUPPORT"
          label="After support"
          value={displayedAfterSupport.value}
          isGhosted={displayedAfterSupport.isGhosted}
          syncStatus={cell?.afterSupportSyncStatus ?? "synced"}
          pulseKey={cell?.pulseKey ?? 0}
          disabled={loadingRating}
          onRate={(v) => onRate("AFTER_SUPPORT", v)}
          onRetry={() => onRetry("AFTER_SUPPORT")}
        />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// PhaseGroup — one of the two button groups on the row.
//
// Encapsulates: 4 rating buttons + label + per-group sync icons.
// Ghosted variant: when `isGhosted` is true, the matching button
// renders with dashed border / 30% opacity / no fill, communicating
// "this is the default that will appear on the report unless you
// tap to override."
// ---------------------------------------------------------------------------

interface PhaseGroupProps {
  phase: RatingPhase;
  label: string;
  value: 1 | 2 | 3 | 4 | null;
  isGhosted: boolean;
  syncStatus: "synced" | "pending" | "failed";
  pulseKey: number;
  disabled: boolean;
  onRate: (value: 1 | 2 | 3 | 4) => void;
  onRetry: () => void;
}

function PhaseGroup({
  phase,
  label,
  value,
  isGhosted,
  syncStatus,
  pulseKey,
  disabled,
  onRate,
  onRetry,
}: PhaseGroupProps) {
  return (
    <div
      className="flex flex-col gap-1"
      data-testid={`phase-group-${phase}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {RATING_VALUES.map((v) => {
          const isSelected = value === v;
          const isGhostedHere = isSelected && isGhosted;
          return (
            <button
              key={v}
              type="button"
              disabled={disabled}
              onClick={() => onRate(v)}
              aria-label={
                isGhostedHere
                  ? `After-support default ${v} — tap to confirm or change`
                  : `Rate ${phase} ${v}`
              }
              aria-pressed={isSelected && !isGhosted}
              data-pulse={pulseKey}
              className={cn(
                "h-11 w-11 rounded-md text-sm font-semibold flex items-center justify-center",
                "transition-colors duration-100",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                disabled && "opacity-50 cursor-not-allowed",
                isSelected && !isGhosted
                  ? // Filled state — same shape as the previous
                    // single-column row.
                    "bg-primary text-primary-foreground shadow-sm"
                  : isGhostedHere
                    ? // Ghosted state — communicates "this is what
                      // the report will show unless you override."
                      // 30% opacity + dashed border + no background
                      // fill. Distinct from disabled (which is 50%
                      // opacity + cursor-not-allowed).
                      "border border-dashed border-muted-foreground/60 text-muted-foreground/70 opacity-50 bg-transparent"
                    : "bg-muted text-foreground hover:bg-muted/80",
                isSelected && pulseKey > 0 && !isGhosted && "cdc-pulse",
              )}
            >
              {v}
            </button>
          );
        })}

        {/* Per-group sync icons. Same WhatsApp-style rule: 'synced'
            renders NOTHING, 'pending' = clock, 'failed' = red
            tappable retry. */}
        {syncStatus === "pending" && (
          <span
            aria-label={`Saving ${phase} rating`}
            className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground"
            data-testid={`sync-pending-${phase}`}
          >
            <Clock className="h-4 w-4 animate-pulse" />
          </span>
        )}
        {syncStatus === "failed" && (
          <button
            type="button"
            onClick={onRetry}
            aria-label={`Retry saving ${phase} rating`}
            data-testid={`sync-failed-${phase}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-700 hover:bg-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            <AlertCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

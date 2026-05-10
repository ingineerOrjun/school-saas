"use client";

import * as React from "react";
import { Check, Undo2, X, Zap } from "lucide-react";
import {
  type AttendanceRoster,
  type AttendanceStatus,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";
import {
  StickyActionBar,
  TouchButton,
} from "./primitives";
import {
  SyncStatusBadge,
  type RowSyncState,
} from "./SyncStatusBadge";
import { useAttendanceShortcuts } from "@/hooks/useAttendanceShortcuts";

// ---------------------------------------------------------------------------
// MobileAttendanceList — Phase 25 Sections 1-3.
//
// Phone-shaped attendance UI. Replaces the desktop table with a
// stack of compressed cards, each tappable across its full width.
//
// Row anatomy (44px-min height):
//   ┌─────────────────────────────────────────────┐
//   │ ⓐ  Student name                       [✓]  │
//   │    #symbol · pending sync               P  │
//   └─────────────────────────────────────────────┘
//
//   ⓐ        — colored initials avatar
//   [✓]/[✗]  — status chip (large tap target on the right)
//   sync     — small SyncStatusBadge inline
//
// Bulk actions (top of screen):
//   • Present All
//   • Absent All
//   • Undo last action — restores the previous status of the most
//                         recently-toggled student. The history is
//                         a stack so multi-undo works.
//
// Speed mode toggle:
//   When ON, tapping a row marks it PRESENT and auto-scrolls to
//   the next. ABSENT requires a long-press (or the explicit
//   chip swap). On desktop, the P/A keyboard shortcuts work
//   regardless of mode.
// ---------------------------------------------------------------------------

export interface MobileAttendanceListProps {
  roster: AttendanceRoster[];
  /** Per-student sync state. Default "synced" when not in map. */
  syncMap?: Map<string, RowSyncState>;
  onToggle: (studentId: string, status: AttendanceStatus) => void;
  onMarkAll: (status: AttendanceStatus) => void;
  /** Header actions: refresh button etc. Optional. */
  headerSlot?: React.ReactNode;
  /** True when sync is actively running (header pill animates). */
  syncing?: boolean;
}

interface UndoEntry {
  studentId: string;
  prevStatus: AttendanceStatus | null;
}

export function MobileAttendanceList({
  roster,
  syncMap,
  onToggle,
  onMarkAll,
  headerSlot,
  syncing,
}: MobileAttendanceListProps) {
  const containerRef = React.useRef<HTMLUListElement>(null);
  const [speedMode, setSpeedMode] = React.useState(true);
  const [undoStack, setUndoStack] = React.useState<UndoEntry[]>([]);

  // Index roster for quick previous-status lookups in undo.
  const rosterMap = React.useMemo(
    () => new Map(roster.map((r) => [r.studentId, r])),
    [roster],
  );

  const handleToggle = React.useCallback(
    (studentId: string, next: AttendanceStatus) => {
      const prev = rosterMap.get(studentId)?.status ?? null;
      // Push to undo stack (cap at 25 entries).
      setUndoStack((s) =>
        [...s, { studentId, prevStatus: prev }].slice(-25),
      );
      onToggle(studentId, next);
    },
    [rosterMap, onToggle],
  );

  const handleByIndex = React.useCallback(
    (index: number, next: AttendanceStatus) => {
      const r = roster[index];
      if (r) handleToggle(r.studentId, next);
    },
    [roster, handleToggle],
  );

  // Desktop keyboard shortcuts — also works on mobile with a
  // physical keyboard. Speed-mode toggle controls auto-advance,
  // not whether the keys work.
  const { cursor, setCursor } = useAttendanceShortcuts({
    total: roster.length,
    enabled: true,
    onToggle: handleByIndex,
    containerRef,
    rowSelector: "[data-attendance-row]",
  });

  const handleUndo = () => {
    setUndoStack((s) => {
      const last = s[s.length - 1];
      if (!last) return s;
      // Apply the inverse — if there was no prev status, just toggle
      // back to the opposite of the current one (best-effort revert).
      const restore: AttendanceStatus =
        last.prevStatus ??
        (rosterMap.get(last.studentId)?.status === "PRESENT"
          ? "ABSENT"
          : "PRESENT");
      onToggle(last.studentId, restore);
      return s.slice(0, -1);
    });
  };

  const presentCount = roster.filter((r) => r.status === "PRESENT").length;
  const absentCount = roster.filter((r) => r.status === "ABSENT").length;
  const unmarkedCount = roster.filter((r) => r.status === null).length;

  return (
    <div className="flex flex-col">
      {/* Header — counters + speed-mode toggle */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="tabular-nums font-semibold">{presentCount}</span> present
          </span>
          <span className="inline-flex items-center gap-1 text-red-700">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            <span className="tabular-nums font-semibold">{absentCount}</span> absent
          </span>
          {unmarkedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              <span className="tabular-nums font-semibold">{unmarkedCount}</span> unmarked
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {headerSlot}
          <button
            type="button"
            onClick={() => setSpeedMode((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 h-7 text-[11px] font-medium",
              speedMode
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-input bg-card text-muted-foreground",
            )}
            aria-pressed={speedMode}
          >
            <Zap className={cn("h-3 w-3", speedMode && "fill-current")} />
            Speed
          </button>
        </div>
      </div>

      {/* Roster cards */}
      <ul ref={containerRef} className="space-y-1.5 pb-24">
        {roster.map((row, index) => {
          const sync = syncMap?.get(row.studentId) ?? "synced";
          const isCursor = cursor === index;
          return (
            <li key={row.studentId} data-attendance-row>
              <RosterRow
                row={row}
                index={index}
                isCursor={isCursor}
                syncState={sync}
                speedMode={speedMode}
                onTap={() => {
                  setCursor(index);
                  // Tap toggles between present and absent. In speed
                  // mode a tap on an unmarked student goes PRESENT
                  // (the common case). Subsequent taps cycle.
                  const next: AttendanceStatus =
                    row.status === "PRESENT" ? "ABSENT" : "PRESENT";
                  handleToggle(row.studentId, next);
                }}
                onLongPress={() => {
                  setCursor(index);
                  // Long press always sets ABSENT. Useful in speed
                  // mode where a single tap defaults to PRESENT.
                  handleToggle(row.studentId, "ABSENT");
                }}
              />
            </li>
          );
        })}
      </ul>

      {/* Sticky action bar — Present All / Absent All / Undo */}
      <StickyActionBar>
        <div className="grid grid-cols-3 gap-2">
          <TouchButton
            variant="neutral"
            size="lg"
            onClick={() => onMarkAll("PRESENT")}
            className="gap-1"
          >
            <Check className="h-4 w-4 text-emerald-600" />
            <span className="text-xs">Present all</span>
          </TouchButton>
          <TouchButton
            variant="neutral"
            size="lg"
            onClick={() => onMarkAll("ABSENT")}
            className="gap-1"
          >
            <X className="h-4 w-4 text-red-600" />
            <span className="text-xs">Absent all</span>
          </TouchButton>
          <TouchButton
            variant="neutral"
            size="lg"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="gap-1"
          >
            <Undo2 className="h-4 w-4" />
            <span className="text-xs">Undo</span>
          </TouchButton>
        </div>
        {syncing && (
          <p className="mt-2 text-center text-[11px] text-sky-700">
            Syncing changes…
          </p>
        )}
      </StickyActionBar>
    </div>
  );
}

// ===========================================================================
// RosterRow
// ===========================================================================

function RosterRow({
  row,
  index,
  isCursor,
  syncState,
  speedMode,
  onTap,
  onLongPress,
}: {
  row: AttendanceRoster;
  index: number;
  isCursor: boolean;
  syncState: RowSyncState;
  speedMode: boolean;
  onTap: () => void;
  onLongPress: () => void;
}) {
  // Long-press detector — 500ms hold without moving.
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = React.useRef(false);

  const onPointerDown = () => {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onLongPress();
      // Haptic feedback on supported devices.
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(20);
      }
    }, 500);
  };
  const onPointerUp = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const onClick = () => {
    if (longPressed.current) return; // long-press already fired
    onTap();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(10);
    }
  };

  const displayName =
    [row.firstName, row.lastName].filter(Boolean).join(" ") || "—";
  const initials = `${row.firstName?.[0] ?? ""}${row.lastName?.[0] ?? ""}`.toUpperCase() || "?";

  const stateTone =
    row.status === "PRESENT"
      ? "border-emerald-200 bg-emerald-50/40"
      : row.status === "ABSENT"
        ? "border-red-200 bg-red-50/40"
        : "border-input bg-card";

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      className={cn(
        "w-full min-h-[56px] flex items-center gap-3 rounded-lg border px-3 py-2 text-left",
        stateTone,
        isCursor && "ring-2 ring-primary/40",
        "active:scale-[0.99] transition-transform",
      )}
      aria-pressed={row.status !== null}
    >
      {/* Avatar / initials — colour-stable per student */}
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          avatarTone(index),
        )}
        aria-hidden
      >
        {initials}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">
          {displayName}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {row.status === null ? "Tap to mark" : row.status.toLowerCase()}
          {speedMode && row.status === null ? " · long-press for absent" : ""}
        </p>
      </div>

      {/* Sync indicator + status chip */}
      <div className="flex items-center gap-2 shrink-0">
        <SyncStatusBadge state={syncState} />
        <span
          className={cn(
            "inline-flex h-9 w-9 items-center justify-center rounded-full",
            row.status === "PRESENT" && "bg-emerald-500 text-white",
            row.status === "ABSENT" && "bg-red-500 text-white",
            row.status === null && "bg-muted text-muted-foreground",
          )}
          aria-label={
            row.status === "PRESENT"
              ? "Present"
              : row.status === "ABSENT"
                ? "Absent"
                : "Unmarked"
          }
        >
          {row.status === "PRESENT" ? (
            <Check className="h-4 w-4" />
          ) : row.status === "ABSENT" ? (
            <X className="h-4 w-4" />
          ) : (
            <span className="text-xs">—</span>
          )}
        </span>
      </div>
    </button>
  );
}

// ===========================================================================
// Avatar palette — stable colour per row index
// ===========================================================================

const AVATAR_PALETTE = [
  "bg-sky-100 text-sky-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
];
function avatarTone(index: number): string {
  return AVATAR_PALETTE[index % AVATAR_PALETTE.length];
}

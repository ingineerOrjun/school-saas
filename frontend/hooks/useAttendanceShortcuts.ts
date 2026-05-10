"use client";

import * as React from "react";
import type { AttendanceStatus } from "@/lib/attendance";

// ---------------------------------------------------------------------------
// useAttendanceShortcuts — Phase 25 Section 2.
//
// Desktop keyboard shortcuts for attendance speed mode:
//
//   P  → mark current row PRESENT, advance to next
//   A  → mark current row ABSENT, advance to next
//   ↑  → previous row (no toggle)
//   ↓  → next row (no toggle)
//
// The hook owns:
//   • cursor state (which row is active)
//   • scrolling the active row into view
//
// The caller provides:
//   • `total` — roster length
//   • `enabled` — true when speed mode is on
//   • `onToggle(index, status)` — what to do when P/A is pressed
//
// Returns the cursor + setCursor so the visual UI can highlight the
// active row + jump to it on click.
//
// Why no LATE shortcut:
//   Today's AttendanceStatus is just PRESENT | ABSENT. When LATE
//   lands, add `L` here and update the toggle handler. One-line
//   change.
// ---------------------------------------------------------------------------

export interface AttendanceShortcutsOptions {
  total: number;
  enabled: boolean;
  onToggle: (index: number, status: AttendanceStatus) => void;
  /** Optional ref to the scroll container for `scrollIntoView` calls. */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Selector that resolves to each row inside the container. */
  rowSelector?: string;
}

export function useAttendanceShortcuts({
  total,
  enabled,
  onToggle,
  containerRef,
  rowSelector = "[data-attendance-row]",
}: AttendanceShortcutsOptions) {
  const [cursor, setCursor] = React.useState(0);

  // Clamp cursor when the roster shrinks.
  React.useEffect(() => {
    if (cursor >= total) setCursor(Math.max(0, total - 1));
  }, [total, cursor]);

  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Bail out when the user is typing in an input — P would
      // type a 'p' instead of marking present.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "p" || k === "a") {
        e.preventDefault();
        const status: AttendanceStatus = k === "p" ? "PRESENT" : "ABSENT";
        onToggle(cursor, status);
        setCursor((c) => Math.min(total - 1, c + 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(total - 1, c + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, cursor, total, onToggle]);

  // Scroll the active row into view. Smooth on capable devices;
  // honours reduced motion via the browser default.
  React.useEffect(() => {
    if (!enabled) return;
    if (!containerRef?.current) return;
    const rows = containerRef.current.querySelectorAll<HTMLElement>(rowSelector);
    const row = rows[cursor];
    if (row) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [cursor, enabled, containerRef, rowSelector]);

  return { cursor, setCursor };
}

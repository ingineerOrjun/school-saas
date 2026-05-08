"use client";

import * as React from "react";
import { Calendar, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { daysAgoISO, todayISO } from "@/lib/attendance";

// ---------------------------------------------------------------------------
// DateRangeMenu — one trigger button that opens a popover containing:
//   • Quick-select preset rows ("Last 7 days", "Last 30 days", …)
//   • A "Custom range" section with from/to inputs
//
// Why this replaces the four chips + two date inputs:
//   • The previous bar showed all six controls at once. On a 1280px
//     screen they wrapped to two or three rows, which made the
//     filter area dominate the page above the actual analytics.
//   • Most operators use a preset 95% of the time and never touch
//     the custom inputs. Hiding them inside a menu is the right
//     attention budget for a non-primary control.
//   • The trigger label always shows the active range
//     ("Last 30 days" or "1 Jan → 31 Jan"), so the bar reads as
//     "what range am I looking at" without hunting through chips
//     for the highlighted one.
//
// What this component DOESN'T do:
//   • It doesn't manage its own range state — the parent owns
//     fromDate/toDate and just receives change callbacks. That keeps
//     the URL-driven filter contract intact (the parent writes to
//     the URL via `useAnalyticsFilters.setFilters`).
// ---------------------------------------------------------------------------

export interface DateRangeMenuProps {
  fromDate: string;
  toDate: string;
  onChange: (next: { fromDate: string; toDate: string }) => void;
  /** Optional className for the outer wrapper. */
  className?: string;
}

interface Preset {
  key: string;
  label: string;
  fromDate: string;
  toDate: string;
}

export function DateRangeMenu({
  fromDate,
  toDate,
  onChange,
  className,
}: DateRangeMenuProps) {
  const [open, setOpen] = React.useState(false);
  // `highlighted` drives the keyboard navigation cursor inside the
  // popover. We track an index into the presets array; -1 means
  // "no row pre-selected" (initial state when opening with the
  // mouse). Arrow keys move it; Enter commits.
  const [highlighted, setHighlighted] = React.useState(-1);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Compute presets fresh on every render so a session that crosses
  // midnight still produces correct ranges. The cost is negligible
  // (4 string ops) and the alternative — caching with a date-keyed
  // memo — is more code than it saves.
  const presets: Preset[] = [
    {
      key: "today",
      label: "Today",
      fromDate: todayISO(),
      toDate: todayISO(),
    },
    {
      key: "7d",
      label: "Last 7 days",
      fromDate: daysAgoISO(6),
      toDate: todayISO(),
    },
    {
      key: "30d",
      label: "Last 30 days",
      fromDate: daysAgoISO(29),
      toDate: todayISO(),
    },
    {
      key: "month",
      label: "This month",
      fromDate: startOfMonthISO(),
      toDate: todayISO(),
    },
    {
      key: "year",
      label: "Last 12 months",
      fromDate: daysAgoISO(364),
      toDate: todayISO(),
    },
  ];

  const activePreset = presets.find(
    (p) => p.fromDate === fromDate && p.toDate === toDate,
  );

  // Outside-click closes the popover. Standard pattern: bind on
  // mousedown so the close fires before any in-popover button's
  // click — otherwise rapid double-clicks on a preset re-open the
  // menu after we've just closed it.
  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Keyboard handling — Esc closes, arrows move the highlight,
  // Enter commits the highlighted preset. We bind document-level
  // (rather than on the popover itself) so the keyboard works
  // immediately after the menu opens, before any input has focus.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // Don't hijack arrow keys when the user is typing in the
      // custom-range date inputs — those have their own arrow-key
      // semantics (increment day/month/year).
      const inDateInput =
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.type === "date";
      if (inDateInput) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(presets.length - 1, h + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(0, h - 1));
      } else if (e.key === "Enter" && highlighted >= 0) {
        e.preventDefault();
        const p = presets[highlighted];
        if (p) {
          onChange({ fromDate: p.fromDate, toDate: p.toDate });
          setOpen(false);
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        setHighlighted(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setHighlighted(presets.length - 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, highlighted]);

  // Reset the highlight index when the menu closes so the next open
  // doesn't surface a stale highlight.
  React.useEffect(() => {
    if (!open) setHighlighted(-1);
  }, [open]);

  const triggerLabel = activePreset
    ? activePreset.label
    : `${fromDate} → ${toDate}`;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-md border bg-surface px-3 text-sm font-medium transition-colors",
          open
            ? "border-primary/40 text-primary"
            : "border-border text-foreground hover:border-primary/30 hover:text-primary",
        )}
      >
        <Calendar className="h-4 w-4" aria-hidden />
        <span className="tabular-nums">{triggerLabel}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          // `animate-scale-in` is the existing 180ms cubic-bezier that
          // popovers use elsewhere — uses transform-origin top-left so
          // it visually "drops" out of the trigger rather than
          // appearing from nowhere. Origin set inline since utility
          // classes don't cover it directly.
          style={{ transformOrigin: "top left" }}
          className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-surface shadow-lg animate-scale-in"
        >
          <ul className="py-1" role="none">
            {presets.map((p, idx) => {
              const isActive = activePreset?.key === p.key;
              const isHighlighted = idx === highlighted;
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => {
                      onChange({ fromDate: p.fromDate, toDate: p.toDate });
                      setOpen(false);
                    }}
                    onMouseEnter={() => setHighlighted(idx)}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-sm transition-colors",
                      // Highlight precedence: keyboard highlight wins
                      // visually over "currently active" so the user
                      // can navigate past their current selection
                      // without losing the cursor's location. Both
                      // states show the check on the active row.
                      isHighlighted
                        ? "bg-primary/10 text-primary"
                        : isActive
                          ? "bg-primary/5 text-primary font-medium"
                          : "text-foreground hover:bg-muted/60",
                    )}
                  >
                    <span>{p.label}</span>
                    {isActive && (
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-border bg-muted/30 px-3 py-2.5">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Custom range
            </p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  From
                </span>
                <input
                  type="date"
                  value={fromDate}
                  max={toDate}
                  // Custom-range edits don't auto-close the menu —
                  // the operator usually picks both bounds in
                  // sequence, and snapping the menu shut between
                  // clicks would make that two-step workflow
                  // jarring. They close the menu via outside-click
                  // or Esc when done.
                  onChange={(e) =>
                    onChange({ fromDate: e.target.value, toDate })
                  }
                  className="h-8 rounded-md border border-border bg-surface px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  To
                </span>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  max={todayISO()}
                  onChange={(e) =>
                    onChange({ fromDate, toDate: e.target.value })
                  }
                  className="h-8 rounded-md border border-border bg-surface px-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** YYYY-MM-DD for the first day of the current month (UTC). */
function startOfMonthISO(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

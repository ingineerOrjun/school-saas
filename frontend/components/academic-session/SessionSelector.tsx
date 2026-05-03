"use client";

import * as React from "react";
import { Calendar, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAcademicSession } from "./AcademicSessionProvider";

/**
 * Topbar dropdown that lets the user switch which academic session
 * the frontend filters by. Same composition as ThemeToggle /
 * CalendarToggle — outside-click + Escape close, semantic
 * `menuitemradio` rows.
 *
 * Hidden when the school has no sessions yet — there's nothing to
 * pick. Admins create the first session via /settings/sessions.
 */
export function SessionSelector() {
  const { sessions, selected, active, loading, setSelectedId } =
    useAcademicSession();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Don't render anything until we know the list — and don't render
  // ever when there's nothing to pick. Admins build the catalog from
  // /settings/sessions; until then the selector is invisible.
  if (loading || sessions.length === 0) return null;

  // Trigger label = selected session name. Falls back to "Session"
  // when selection failed to resolve (defensive — shouldn't happen
  // because the provider always picks something when the list is
  // non-empty).
  const triggerLabel = selected?.name ?? "Session";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch academic session"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
      >
        <Calendar className="h-[14px] w-[14px]" />
        {triggerLabel}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 origin-top-right rounded-lg border border-border bg-surface p-1 shadow-lg animate-scale-in"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Academic session
          </p>
          {sessions.map((s) => {
            const isSelected = selected?.id === s.id;
            const isActive = s.id === active?.id;
            return (
              <button
                key={s.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  setSelectedId(s.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm",
                  "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isSelected
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="flex flex-col items-start leading-tight min-w-0">
                  <span
                    className={cn(
                      "text-sm font-medium truncate",
                      isSelected && "text-primary",
                    )}
                  >
                    {s.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {s.startDate.slice(0, 10)} → {s.endDate.slice(0, 10)}
                  </span>
                </span>
                {/* Tiny "Active" pill — independent of selection so
                    the user knows which session new writes will hit
                    even when they're viewing a different one. */}
                {isActive && (
                  <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-200/60 dark:ring-emerald-900/60">
                    Active
                  </span>
                )}
                {isSelected && !isActive && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

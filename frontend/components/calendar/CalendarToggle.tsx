"use client";

import * as React from "react";
import { Calendar, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCalendar } from "./CalendarProvider";
import type { CalendarMode } from "@/lib/date";

interface Option {
  value: CalendarMode;
  label: string;
  detail: string;
}

const OPTIONS: Option[] = [
  { value: "bs", label: "B.S.", detail: "Bikram Sambat" },
  { value: "ad", label: "A.D.", detail: "Anno Domini" },
  { value: "dual", label: "Dual", detail: "Both calendars" },
];

/**
 * Topbar dropdown for switching the calendar display preference.
 * Same composition pattern as ThemeToggle — outside-click + Escape
 * close, semantic `menuitemradio` rows with a check on the active
 * option, label-only trigger that fits the icon-button cluster.
 */
export function CalendarToggle() {
  const { mode, setMode } = useCalendar();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

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

  // Trigger label reflects the active mode in shorthand. Until mounted
  // we fall back to a generic icon to avoid a hydration mismatch on
  // the first render (provider default differs from stored value).
  const triggerLabel = !mounted
    ? null
    : mode === "bs"
      ? "B.S."
      : mode === "ad"
        ? "A.D."
        : "Dual";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change calendar"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
      >
        <Calendar className="h-[14px] w-[14px]" />
        {triggerLabel ?? <span className="w-[28px]" aria-hidden />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-52 origin-top-right rounded-lg border border-border bg-surface p-1 shadow-lg animate-scale-in"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Calendar
          </p>
          {OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setMode(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm",
                  "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  active
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="flex flex-col items-start leading-tight">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      active && "text-primary",
                    )}
                  >
                    {opt.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {opt.detail}
                  </span>
                </span>
                {active && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

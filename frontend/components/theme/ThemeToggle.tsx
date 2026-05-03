"use client";

import * as React from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "./ThemeProvider";

interface Option {
  value: Theme;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const OPTIONS: Option[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Theme picker — a small dropdown of (Light / Dark / System).
 *
 * Trigger icon reflects the RESOLVED theme (sun in light, moon in
 * dark) so the user gets immediate visual feedback even when they
 * picked "System". Mark on the active row reflects the user's saved
 * preference (which can be "system" — that's what gets persisted).
 *
 * Designed to live in the Topbar's right-side action cluster; the
 * surface uses tokens so it works in both themes without overrides.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  // Avoid a SSR/hydration mismatch on the trigger icon: until mounted,
  // render a neutral monitor icon. After mount the right sun/moon
  // appears based on the resolved theme.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Close on outside click + Escape — same pattern as the user menu.
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

  const TriggerIcon = !mounted
    ? Monitor
    : resolvedTheme === "dark"
      ? Moon
      : Sun;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
      >
        <TriggerIcon className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-44 origin-top-right rounded-lg border border-border bg-surface p-1 shadow-lg animate-scale-in"
        >
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(opt.value);
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
                <span className="inline-flex items-center gap-2">
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      active && "text-primary",
                    )}
                  />
                  {opt.label}
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

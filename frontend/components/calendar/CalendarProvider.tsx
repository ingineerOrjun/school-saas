"use client";

import * as React from "react";
import type { CalendarMode } from "@/lib/date";

/**
 * Calendar preference — Bikram Sambat (Nepal default), Anno Domini
 * (Western), or Dual (BS primary, AD parenthetical). Same persistence
 * pattern as ThemeProvider:
 *   • localStorage key `calendar`
 *   • SSR-safe initial value (defaults to 'dual' so a non-hydrated
 *     server render shows BOTH calendars and never has to flash from
 *     one to the other)
 *
 * The provider doesn't apply any DOM class — date components read the
 * preference via `useCalendarMode()` and render accordingly. This
 * scopes the re-render cost to date-display surfaces only.
 */

interface CalendarContextValue {
  mode: CalendarMode;
  setMode: (next: CalendarMode) => void;
}

const CalendarContext = React.createContext<CalendarContextValue | null>(
  null,
);

const STORAGE_KEY = "calendar";

function readStored(): CalendarMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "bs" || raw === "ad" || raw === "dual") return raw;
  } catch {
    /* no-op */
  }
  return null;
}

export function CalendarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // 'dual' default keeps SSR/CSR markup the same on first paint —
  // important because date strings appear in tables and avoiding a
  // hydration mismatch is worth one harmless extra label.
  const [mode, setModeState] = React.useState<CalendarMode>("dual");
  const [hydrated, setHydrated] = React.useState(false);

  // Hydrate from localStorage on mount.
  React.useEffect(() => {
    const stored = readStored();
    if (stored && stored !== mode) setModeState(stored);
    setHydrated(true);
    // Intentionally empty deps — read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on change. Skip the very first persistence (when we just
  // rehydrated from storage) to avoid a redundant write that fires
  // before the user has touched anything.
  React.useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* no-op */
    }
  }, [mode, hydrated]);

  const value = React.useMemo<CalendarContextValue>(
    () => ({ mode, setMode: setModeState }),
    [mode],
  );

  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
}

/**
 * Read-only hook for components that just want the mode. Most date
 * surfaces use this via `<DualDate>` rather than calling directly.
 */
export function useCalendarMode(): CalendarMode {
  return useCalendar().mode;
}

/**
 * Full hook with setter — used by the CalendarToggle in the topbar.
 * Throws when used outside the provider so wiring mistakes surface
 * during development.
 */
export function useCalendar(): CalendarContextValue {
  const ctx = React.useContext(CalendarContext);
  if (!ctx) {
    throw new Error("useCalendar must be used within a <CalendarProvider>");
  }
  return ctx;
}

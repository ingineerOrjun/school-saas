"use client";

import * as React from "react";

/**
 * Theme system — light / dark / system, with localStorage persistence.
 *
 *   • `theme` is the USER PREFERENCE — the value they explicitly chose.
 *     'system' means "track the OS preference", which we resolve via
 *     `matchMedia('(prefers-color-scheme: dark)')`.
 *   • `resolvedTheme` is what's ACTUALLY APPLIED — always 'light' or
 *     'dark', never 'system'. Use this to render conditional UI
 *     (e.g. a moon vs sun icon).
 *
 * Wire-up:
 *   1. `<ThemeProvider>` wraps the app in `app/layout.tsx`.
 *   2. The inline FOUC script at the top of `<html>` (also in layout)
 *      sets the right class BEFORE React hydrates, so a dark-mode
 *      visitor never sees a white flash on first paint.
 *   3. The provider's effects keep the class in sync after hydration
 *      AND react to OS-level changes when the user picked 'system'.
 */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: Theme) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "theme";

/**
 * Resolve a user-preference value into the actual theme to apply.
 * SSR-safe: when window is undefined we fall back to "light" so the
 * server-rendered HTML doesn't lock into dark for everyone.
 */
function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Apply (or remove) the `dark` class on <html>. Same operation the
 * inline FOUC script performs — kept consistent so post-hydration
 * toggles produce the same DOM the script left.
 */
function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read the saved preference once on mount. The default is "system"
  // which respects the visitor's OS setting until they explicitly
  // pick. Using a function initializer keeps localStorage off the
  // SSR render path.
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") {
        return stored;
      }
    } catch {
      /* localStorage unavailable — fall through */
    }
    return "system";
  });

  // Track the resolved value so consumers don't have to re-derive it.
  // Initialized via the same resolver so the very first render after
  // hydration matches the FOUC script's decision.
  const [resolvedTheme, setResolvedTheme] = React.useState<ResolvedTheme>(
    () => resolveTheme(theme),
  );

  // Whenever the user changes their preference, persist + re-resolve.
  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* no-op */
    }
    const next = resolveTheme(theme);
    setResolvedTheme(next);
    applyTheme(next);
  }, [theme]);

  // When 'system' is the chosen preference, listen for OS-level
  // changes so the app flips automatically when the user switches
  // their global theme without touching our app.
  React.useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolvedTheme(next);
      applyTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme: setThemeState }),
    [theme, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * Hook for any component that needs to read or change the theme.
 * Throws when used outside the provider — surfaces wiring mistakes
 * during development instead of silently returning defaults.
 */
export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}

/**
 * Inline script that runs BEFORE React hydrates. Without it, every
 * dark-mode visitor would see a brief white flash on first paint
 * while the JS bundle loads and the provider applies the class.
 *
 * Kept tiny and self-contained — no closures, no imports — so it
 * inlines cleanly into the SSR'd HTML head. Errors are swallowed
 * because a localStorage-blocked browser should still render light
 * mode rather than crashing the page.
 */
export const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark' || stored === 'system'
      ? stored
      : 'system';
    var dark =
      theme === 'dark' ||
      (theme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (_) {
    /* swallow — light mode is the safe fallback */
  }
})();
`;

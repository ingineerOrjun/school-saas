"use client";

import * as React from "react";

// ---------------------------------------------------------------------------
// useMediaQuery + useIsMobile — Phase 25.
//
// Hooks for runtime breakpoint detection. Used by mobile-first
// components that need to render a phone-shaped UI on phones and
// fall back to the existing desktop UI on tablets/laptops.
//
// SSR-safe: returns `false` during SSR + the very first client
// render, then resolves to the actual match after mount. Components
// using these hooks should render the desktop variant by default
// (don't ship layout shift on hydration).
// ---------------------------------------------------------------------------

/**
 * Subscribe to a CSS media query. Returns true when the query
 * currently matches.
 *
 *   const isPhone = useMediaQuery("(max-width: 768px)");
 *
 * Behavior:
 *   • SSR / first render → `false` (don't disrupt hydration with
 *     a server/client mismatch).
 *   • After mount → reflects `window.matchMedia(query).matches`.
 *   • Subscribes to `change` events so re-orientation / dev-tools
 *     resize updates the value.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/**
 * Convenience: true on phone-width viewports (<768px). Tuned to the
 * Tailwind `md` breakpoint so it lines up with the rest of the
 * design system's responsive utilities.
 */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

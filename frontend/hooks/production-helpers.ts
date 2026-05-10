"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Production hardening helpers — Phase 26 Sections 4, 5, 8.
//
// One file, four small hooks. Each is independently useful; bundling
// avoids a dozen one-function files.
//
// Exports:
//
//   useRenderCount(label?)         — dev-only render counter. Logs
//                                     to console.warn when re-renders
//                                     happen unexpectedly often.
//
//   useLazyImage(src)              — IntersectionObserver-backed
//                                     "load image only when visible"
//                                     hook. Returns the src to apply
//                                     once the ref scrolls into view,
//                                     and a ref to attach.
//
//   usePrefetchRoutes(paths)       — calls router.prefetch for each
//                                     supplied path on mount. Used
//                                     by the dashboard to warm the
//                                     5-6 highest-traffic routes.
//
//   useDoubleTapGuard(handler, ms) — wraps a handler so rapid repeat
//                                     calls within `ms` are ignored.
//                                     Stops accidental double-charges
//                                     on cashier flows.
//
//   useScannerInput({ onScan })    — listens for keyboard events
//                                     globally and dispatches `onScan`
//                                     when the timing pattern matches
//                                     a barcode scanner (rapid
//                                     character bursts terminated by
//                                     Enter). Ignores normal typing.
// ---------------------------------------------------------------------------

// ===========================================================================
// useRenderCount
// ===========================================================================

/**
 * Dev-only render counter. Returns the current render count + logs a
 * warning when the count grows unusually fast (signals a render-loop
 * bug). Production builds short-circuit to a no-op.
 */
export function useRenderCount(label = "anonymous"): number {
  const count = React.useRef(0);
  const lastLogTime = React.useRef(Date.now());
  count.current += 1;
  if (process.env.NODE_ENV === "production") return count.current;
  React.useEffect(() => {
    const now = Date.now();
    // 30+ renders in 5s is the warning threshold — well above any
    // legitimate React workload.
    if (count.current % 30 === 0 && now - lastLogTime.current < 5_000) {
      // eslint-disable-next-line no-console
      console.warn(
        `[useRenderCount] "${label}" hit ${count.current} renders — possible render loop`,
      );
    }
    lastLogTime.current = now;
  });
  return count.current;
}

// ===========================================================================
// useLazyImage
// ===========================================================================

/**
 * IntersectionObserver-backed image lazy-loader. Returns:
 *   • `ref` — attach to the wrapping element (the visible card)
 *   • `src` — the image src to render. Empty until in-view, then
 *             flips to the supplied src and stays.
 *
 * Once a card has loaded its image, we don't unload — repeated
 * scrolls don't re-fetch. Cheaper than `loading="lazy"` for cases
 * where the parent is already a heavy React tree.
 */
export function useLazyImage(src: string | null): {
  ref: React.RefObject<HTMLDivElement | null>;
  resolvedSrc: string | null;
} {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    if (!ref.current || shown || typeof IntersectionObserver === "undefined")
      return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [shown]);

  return { ref, resolvedSrc: shown ? src : null };
}

// ===========================================================================
// usePrefetchRoutes
// ===========================================================================

/**
 * Warm Next.js's route cache for the supplied paths on mount. Costs
 * a single request per path (the route's RSC payload), which is
 * cheap on a fresh dashboard and lets later navigations feel instant.
 *
 * Use sparingly — prefetching every route is wasteful. The right
 * candidates are 3-6 routes the operator's role hits within seconds
 * of opening the dashboard.
 */
export function usePrefetchRoutes(paths: readonly string[]): void {
  const router = useRouter();
  React.useEffect(() => {
    for (const p of paths) {
      try {
        router.prefetch(p);
      } catch {
        /* best-effort */
      }
    }
    // Paths array is captured on first render — re-running on every
    // route change would defeat the purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ===========================================================================
// useDoubleTapGuard
// ===========================================================================

/**
 * Wraps a handler so it ignores subsequent calls within `windowMs`
 * (default 800ms). Use it on Pay / Submit / Save buttons where a
 * rapid double-tap should NOT submit twice — even though the mutation
 * itself is idempotent (clientRequestId), refusing the second tap
 * gives clearer UX than the spinner-then-success-then-success flash.
 *
 *   const guarded = useDoubleTapGuard(submit, 1000);
 *   <button onClick={guarded}>Save</button>
 */
export function useDoubleTapGuard<TArgs extends unknown[]>(
  handler: (...args: TArgs) => void,
  windowMs = 800,
): (...args: TArgs) => void {
  const lastFireRef = React.useRef(0);
  const handlerRef = React.useRef(handler);
  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  return React.useCallback(
    (...args: TArgs) => {
      const now = Date.now();
      if (now - lastFireRef.current < windowMs) return;
      lastFireRef.current = now;
      handlerRef.current(...args);
    },
    [windowMs],
  );
}

// ===========================================================================
// useScannerInput
// ===========================================================================

export interface UseScannerInputOptions {
  /**
   * Called when the keyboard input pattern matches a barcode scan.
   * Receives the captured payload (no leading/trailing whitespace).
   */
  onScan: (payload: string) => void;
  /**
   * Per-character ceiling. Real keyboard typing averages 80-150ms
   * per character; barcode scanners burst at < 30ms. Default 30ms.
   */
  maxCharIntervalMs?: number;
  /** Minimum payload length to count as a scan. Default 3. */
  minLength?: number;
  /**
   * Disable when an input field is focused (so the scanner's payload
   * goes to the field, not to onScan). Default true.
   */
  ignoreWhenInputFocused?: boolean;
}

/**
 * Listens for keyboard input that matches a barcode scanner's
 * timing signature: a rapid burst of characters (sub-30ms gaps)
 * terminated by Enter.
 *
 * The hook does NOT consume normal keyboard typing — bursts that
 * exceed the per-character interval are dropped. This means the
 * regular keyboard-shortcut layer (P/A in attendance, command
 * palette Cmd+K) keeps working while the scanner sits in the
 * background.
 *
 * Most USB / Bluetooth handheld scanners emulate a HID keyboard, so
 * this hook works with the majority of off-the-shelf hardware.
 */
export function useScannerInput({
  onScan,
  maxCharIntervalMs = 30,
  minLength = 3,
  ignoreWhenInputFocused = true,
}: UseScannerInputOptions): void {
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    let buffer = "";
    let lastKeyTime = 0;
    let bursting = false;

    const reset = () => {
      buffer = "";
      lastKeyTime = 0;
      bursting = false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (ignoreWhenInputFocused) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
      }

      const now = performance.now();
      const interval = now - lastKeyTime;
      lastKeyTime = now;

      // Enter terminates a scan.
      if (e.key === "Enter") {
        if (bursting && buffer.length >= minLength) {
          const payload = buffer.trim();
          reset();
          // preventDefault so Enter doesn't accidentally submit a
          // form or activate a focused button.
          e.preventDefault();
          onScan(payload);
        } else {
          reset();
        }
        return;
      }

      // Single-character keys only — no Shift, Ctrl, etc.
      if (e.key.length !== 1) {
        // Modifier or function key during a burst aborts.
        if (bursting) reset();
        return;
      }

      // First character of a potential burst — start tracking.
      if (buffer.length === 0) {
        buffer = e.key;
        bursting = true;
        return;
      }

      // Subsequent character — must arrive within the interval.
      if (interval > maxCharIntervalMs) {
        reset();
        return;
      }
      buffer += e.key;
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onScan, maxCharIntervalMs, minLength, ignoreWhenInputFocused]);
}

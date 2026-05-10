"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// UI polish primitives — Phase 24 Sections 7 + 14 + 15.
//
// One file with several small, reusable pieces. Each is:
//   • zero-config (no props for the common case)
//   • motion-aware (honours prefers-reduced-motion)
//   • a11y-correct (real semantics, not div-soup)
//
// Exports:
//
//   <EmptyStateCTA>     — Section 7. Replaces blank screens with
//                          purpose + next-action + CTA button.
//
//   <SkeletonRows>      — calmer loading state (re-export of the
//                          existing primitive's row variant for
//                          discoverability from one import path).
//
//   <SuccessCheck>      — brief animated check after a successful
//                          mutation. Auto-dismisses after 1.5s.
//
//   <FocusRing>         — wraps any element to give it the visible
//                          keyboard focus ring used across the app.
//
//   <SrOnly>            — visually-hidden text, for screen-reader-
//                          only labels.
//
//   useReducedMotion()  — true when the OS asks for less motion.
//                          Gate decorative animations on this.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EmptyStateCTA
// ---------------------------------------------------------------------------

export interface EmptyStateCTAProps {
  /** Heading — what's missing. Short. */
  title: string;
  /** One-sentence explanation of what this surface is for. */
  description: string;
  /** Optional icon — a lucide node passed in. Renders centered, muted. */
  icon?: React.ReactNode;
  /** Primary CTA. */
  cta?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  /** Secondary affordance (e.g. "Learn more" link). */
  secondary?: {
    label: string;
    href: string;
  };
  className?: string;
}

/**
 * The "no rows yet" panel done right. Three lines max:
 *   • title  — what's missing ("No exams yet")
 *   • body   — why this surface exists + what creates the first one
 *   • CTA    — one tap to do that thing
 *
 * Composes inside any panel; the parent supplies the border/card.
 */
export function EmptyStateCTA({
  title,
  description,
  icon,
  cta,
  secondary,
  className,
}: EmptyStateCTAProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-10",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground leading-relaxed">
        {description}
      </p>
      {(cta || secondary) && (
        <div className="mt-4 flex items-center gap-2">
          {cta &&
            (cta.href ? (
              <a
                href={cta.href}
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {cta.label}
              </a>
            ) : (
              <button
                type="button"
                onClick={cta.onClick}
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {cta.label}
              </button>
            ))}
          {secondary && (
            <a
              href={secondary.href}
              className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              {secondary.label}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuccessCheck — brief celebration after a mutation succeeds
// ---------------------------------------------------------------------------

export function SuccessCheck({
  message = "Saved",
  onDone,
  durationMs = 1_500,
}: {
  message?: string;
  onDone?: () => void;
  durationMs?: number;
}) {
  const reduced = useReducedMotion();
  React.useEffect(() => {
    if (!onDone) return;
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
  }, [onDone, durationMs]);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-emerald-700 text-xs font-medium",
        !reduced && "animate-in fade-in zoom-in-95 duration-150",
      )}
    >
      <CheckCircle2 className="h-4 w-4" />
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FocusRing — accessibility helper
// ---------------------------------------------------------------------------

/**
 * Wraps a child element to give it the standard visible focus ring
 * the rest of the app uses. Only the child's keyboard-focus state
 * applies the ring (not :hover) so mouse users don't see noise.
 *
 * Usage:
 *   <FocusRing><button …>OK</button></FocusRing>
 *
 * For most controls, the design system's <Button> / <Input>
 * already does this — use FocusRing for ad-hoc clickables that
 * don't go through those primitives.
 */
export function FocusRing({ children }: { children: React.ReactElement }) {
  return React.cloneElement(children, {
    className: cn(
      (children.props as { className?: string }).className,
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    ),
  });
}

// ---------------------------------------------------------------------------
// SrOnly — visually hidden, screen-reader visible
// ---------------------------------------------------------------------------

/**
 * Wraps text to be invisible to sighted users but read by screen
 * readers. Used for icon-only buttons that need a label.
 *
 *   <button>
 *     <X />
 *     <SrOnly>Close dialog</SrOnly>
 *   </button>
 */
export function SrOnly({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// useReducedMotion
// ---------------------------------------------------------------------------

/**
 * Respects the OS-level "reduce motion" preference. Wrap any
 * decorative animation in this so users on macOS / iOS / Windows
 * with that toggle on don't see jumpy UI.
 *
 *   const reduced = useReducedMotion();
 *   <div className={cn(reduced ? "" : "animate-in fade-in")} />
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

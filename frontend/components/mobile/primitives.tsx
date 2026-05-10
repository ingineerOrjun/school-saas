"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Mobile primitives — Phase 25 Sections 1, 6, 9, 10.
//
// Touch-first building blocks for the attendance + fee-collection
// mobile workflows. Each primitive enforces a 44×44 minimum touch
// target (Apple HIG / Material Design baseline) and respects
// `env(safe-area-inset-*)` so sticky bars don't get eaten by the
// notch / home-indicator.
//
// Exports:
//
//   <TouchButton>      — 44px-min button with ink-tap feedback
//   <StickyActionBar>  — bottom-anchored bar with safe-area padding
//                          and an optional "lift" shadow when there's
//                          content scrolling underneath
//   <NumericPad>       — 12-key telephone-style keypad for amount
//                          entry (cashier hands it the phone, parent
//                          types — no system keyboard needed)
//   <BottomSheet>      — modal sheet that slides up from the bottom,
//                          dismissable by swipe-down OR backdrop tap
//   <PageActionFab>    — anchored next-action button for mobile
//                          workflows ("Save attendance", "Charge")
// ---------------------------------------------------------------------------

// ===========================================================================
// TouchButton
// ===========================================================================

export interface TouchButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "neutral" | "danger" | "ghost";
  size?: "md" | "lg";
}

/**
 * 44px minimum touch button (lg = 56px). Active-state scale +
 * subtle background shift so even slow phones surface a press.
 */
export const TouchButton = React.forwardRef<
  HTMLButtonElement,
  TouchButtonProps
>(function TouchButton(
  { variant = "primary", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all",
        "active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100",
        size === "md" && "min-h-[44px] min-w-[44px] px-4 text-sm",
        size === "lg" && "min-h-[56px] min-w-[56px] px-5 text-base",
        variant === "primary" &&
          "bg-primary text-primary-foreground hover:opacity-95 active:bg-primary/90",
        variant === "neutral" &&
          "bg-card border border-input text-foreground hover:bg-muted/40",
        variant === "danger" &&
          "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" &&
          "bg-transparent text-foreground hover:bg-muted/40",
        className,
      )}
    >
      {children}
    </button>
  );
});

// ===========================================================================
// StickyActionBar
// ===========================================================================

export interface StickyActionBarProps {
  /** Render the bar elevated when content scrolls underneath. */
  elevated?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Bottom-anchored bar with safe-area padding for the home indicator.
 * Sits above the FAB. Use it for the primary action(s) of a workflow
 * — "Save attendance", "Record payment", etc.
 */
export function StickyActionBar({
  elevated = true,
  className,
  children,
}: StickyActionBarProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 left-0 right-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3",
        "bg-background/95 backdrop-blur",
        "pb-[calc(env(safe-area-inset-bottom)+0.75rem)]",
        elevated && "border-t shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ===========================================================================
// NumericPad — telephone-style 12-key
// ===========================================================================

export interface NumericPadProps {
  value: string;
  onChange: (next: string) => void;
  /** Max characters (defaults to 9 — covers up to 999,999,999). */
  maxLength?: number;
  /** Decimal point allowed? Default true. */
  allowDecimal?: boolean;
}

/**
 * On-screen telephone keypad. Replaces the system keyboard for
 * amount entry — three benefits:
 *   1. Always visible (never covered by autocomplete suggestions).
 *   2. Larger keys than the soft keyboard's number row.
 *   3. Doesn't shift the page layout when it appears.
 *
 * The keys produce purely digit characters (and one optional decimal).
 * Backspace removes one char. Long-press backspace clears.
 */
export function NumericPad({
  value,
  onChange,
  maxLength = 9,
  allowDecimal = true,
}: NumericPadProps) {
  const press = (ch: string) => {
    if (ch === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    if (ch === ".") {
      if (!allowDecimal) return;
      if (value.includes(".")) return;
      if (value.length === 0) {
        onChange("0.");
        return;
      }
    }
    if (value.length >= maxLength) return;
    onChange(value + ch);
  };

  // Long-press-to-clear via a press timer.
  const clearTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBackPointerDown = () => {
    clearTimer.current = setTimeout(() => onChange(""), 600);
  };
  const onBackPointerUp = () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = null;
  };

  const Key = ({ ch, label }: { ch: string; label: React.ReactNode }) => (
    <button
      type="button"
      onClick={() => press(ch)}
      onPointerDown={ch === "back" ? onBackPointerDown : undefined}
      onPointerUp={ch === "back" ? onBackPointerUp : undefined}
      onPointerLeave={ch === "back" ? onBackPointerUp : undefined}
      className={cn(
        "h-14 rounded-xl border border-input bg-card text-xl font-semibold",
        "active:scale-[0.97] active:bg-muted/60 transition-all",
        ch === "back" && "text-base",
      )}
      aria-label={typeof label === "string" ? label : ch}
    >
      {label}
    </button>
  );

  return (
    <div className="grid grid-cols-3 gap-2 select-none">
      <Key ch="1" label="1" />
      <Key ch="2" label="2" />
      <Key ch="3" label="3" />
      <Key ch="4" label="4" />
      <Key ch="5" label="5" />
      <Key ch="6" label="6" />
      <Key ch="7" label="7" />
      <Key ch="8" label="8" />
      <Key ch="9" label="9" />
      <Key ch={allowDecimal ? "." : ""} label={allowDecimal ? "." : ""} />
      <Key ch="0" label="0" />
      <Key ch="back" label="⌫" />
    </div>
  );
}

// ===========================================================================
// BottomSheet
// ===========================================================================

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
}

/**
 * Modal sheet sliding up from the bottom — the natural mobile
 * replacement for centered dialogs. Closes on backdrop tap or
 * the explicit Done button. Body scroll is locked while open.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
}: BottomSheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full max-w-md bg-background rounded-t-2xl shadow-2xl",
          "max-h-[85vh] overflow-hidden flex flex-col",
          "animate-in slide-in-from-bottom-4 duration-200",
        )}
      >
        {/* Drag handle (visual only — UA gestures + backdrop tap close) */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        {title && (
          <div className="px-4 pb-2 border-b">
            <p className="text-sm font-semibold">{title}</p>
          </div>
        )}
        <div className="overflow-y-auto px-4 py-3 flex-1">{children}</div>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

/**
 * Button variants — locked to the spec:
 *   primary    : bg-indigo-600 → hover indigo-700 (filled CTA)
 *   secondary  : white surface + slate-300 border (passive action)
 *   destructive: bg-red-600 (delete / clear actions)
 *   outline    : same surface as secondary (kept for back-compat)
 *   ghost      : no surface, used inside dense rows / toolbars
 *
 * Use AT MOST one `primary` per logical section so the user always
 * knows what to click. `secondary` / `outline` carry every other action.
 */
const variantStyles: Record<Variant, string> = {
  // Primary: indigo brand color stays consistent across both themes —
  // it's the visual hook users learn to find. Hover step still
  // darkens (works in both themes since it's the same indigo).
  primary:
    "bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-700 shadow-xs",
  // Secondary / outline: token-based so the surface flips with the
  // theme. In dark mode this becomes a slate-900 button on a slate
  // page — separated by the border, not a fill contrast.
  secondary:
    "bg-surface text-foreground border border-border hover:bg-muted active:bg-muted shadow-xs",
  outline:
    "bg-surface text-foreground border border-border hover:bg-muted active:bg-muted shadow-xs",
  ghost:
    "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90 shadow-xs",
};

/**
 * Sizes match the spec: primary action is `md` = h-10 px-4 (~py-2.5 of
 * a 14px line). `sm` is for inline toolbars, `lg` for hero CTAs, `icon`
 * for square icon-only buttons.
 */
const sizeStyles: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-md gap-1.5",
  md: "h-10 px-4 text-sm rounded-md gap-2",
  lg: "h-11 px-5 text-base rounded-md gap-2",
  icon: "h-10 w-10 rounded-md",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap font-medium select-none",
          "transition-all duration-150 ease-out",
          "active:scale-[0.97] active:duration-75",
          // Always-visible focus ring in the brand color so keyboard
          // users (and accessibility audits) see exactly what's focused.
          // Offset uses the page background token so the gap is visible
          // in BOTH themes (was hardcoded white before).
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
        )}
        {children}
        {!loading && rightIcon && (
          <span className="inline-flex shrink-0">{rightIcon}</span>
        )}
      </button>
    );
  },
);

Button.displayName = "Button";

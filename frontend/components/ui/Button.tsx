"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95 shadow-xs",
  secondary:
    "bg-muted text-foreground hover:bg-muted/70 active:bg-muted border border-border/60",
  ghost:
    "bg-transparent text-foreground hover:bg-muted active:bg-muted/80",
  outline:
    "bg-surface text-foreground border border-border hover:bg-muted active:bg-muted/80 shadow-xs",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-md gap-1.5",
  md: "h-9 px-3.5 text-sm rounded-md gap-2",
  lg: "h-11 px-5 text-base rounded-lg gap-2",
  icon: "h-9 w-9 rounded-md",
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
          "focus-ring",
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

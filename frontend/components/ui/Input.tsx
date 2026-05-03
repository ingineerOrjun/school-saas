"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
}

/**
 * Form-input primitive.
 *
 * Locked to the spec:
 *   • Label is ALWAYS rendered above the input (when present).
 *   • Input height: h-10 (default). Fixed so labels align across rows.
 *   • Focus ring: indigo-500 — visible on every theme.
 *   • Error text: red-600, text-xs, immediately below the field.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      containerClassName,
      label,
      hint,
      error,
      leftIcon,
      rightIcon,
      id,
      type = "text",
      ...props
    },
    ref,
  ) => {
    const inputId = id ?? React.useId();

    return (
      <div className={cn("flex flex-col gap-1.5", containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-foreground"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 flex h-4 w-4 items-center justify-center text-muted-foreground">
              {leftIcon}
            </span>
          )}
          <input
            id={inputId}
            ref={ref}
            type={type}
            aria-invalid={!!error}
            className={cn(
              // Tokens: bg-surface + border-border give us white/slate-300
              // in light, slate-900/slate-700 in dark — both with proper
              // contrast against the form's background.
              "w-full h-10 rounded-md border bg-surface text-sm text-foreground",
              "placeholder:text-muted-foreground/60",
              "transition-shadow duration-150",
              // Primary focus ring — same color as the CTA button.
              "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted",
              leftIcon ? "pl-9" : "pl-3",
              rightIcon ? "pr-9" : "pr-3",
              error
                ? "border-destructive focus:border-destructive focus:ring-destructive/25"
                : "border-border",
              className,
            )}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 flex h-4 w-4 items-center justify-center text-muted-foreground">
              {rightIcon}
            </span>
          )}
        </div>
        {(error || hint) && (
          <p
            className={cn(
              "text-xs",
              // Errors win over hints when both are passed.
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {error ?? hint}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

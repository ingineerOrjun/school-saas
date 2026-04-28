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
              "w-full h-10 rounded-md border bg-surface text-sm text-foreground",
              "placeholder:text-muted-foreground/80",
              "transition-all duration-150",
              "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted",
              leftIcon ? "pl-9" : "pl-3",
              rightIcon ? "pr-9" : "pr-3",
              error
                ? "border-destructive/70 focus:border-destructive focus:ring-destructive/20"
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

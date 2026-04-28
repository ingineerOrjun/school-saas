"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

// Must match `animate-fade-out` / `animate-scale-out` in tailwind config.
const EXIT_DURATION_MS = 180;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: ModalProps) {
  const [mounted, setMounted] = React.useState(false);
  // `render` keeps the modal in the tree during the exit animation.
  // `closing` toggles the exit-animation classNames.
  const [render, setRender] = React.useState(open);
  const [closing, setClosing] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Sync open → render with a delayed unmount for the exit animation.
  React.useEffect(() => {
    if (open) {
      setRender(true);
      setClosing(false);
      return;
    }
    if (render) {
      setClosing(true);
      const t = setTimeout(() => {
        setRender(false);
        setClosing(false);
      }, EXIT_DURATION_MS);
      return () => clearTimeout(t);
    }
  }, [open, render]);

  // Escape-to-close + body scroll lock, only while actually open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
    };
  }, [open, onClose]);

  if (!mounted || !render) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "absolute inset-0 bg-foreground/30 backdrop-blur-sm",
          closing ? "animate-fade-out" : "animate-fade-in",
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full bg-surface rounded-xl border border-border shadow-xl",
          closing ? "animate-scale-out" : "animate-scale-in",
          sizeClasses[size],
          className,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors focus-ring rounded-md p-1"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        {(title || description) && (
          <div className="px-6 pt-6 pb-4 border-b border-border/70">
            {title && (
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/70 bg-muted/30 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

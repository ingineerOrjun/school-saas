"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Toast provider styled to match the Scholaris glass design system.
 * Render once in the root layout. Import `toast` from `sonner` to use.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-surface/90 group-[.toaster]:backdrop-blur-xl group-[.toaster]:text-foreground group-[.toaster]:border-border/60 group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:!border-success/30",
          error: "group-[.toaster]:!border-destructive/30",
        },
      }}
    />
  );
}

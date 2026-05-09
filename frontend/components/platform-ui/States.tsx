"use client";

import * as React from "react";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Empty / Error / Loading states — the three states every panel needs.
//
// Tuned for the platform's quiet operational look:
//   • centered icon + label, no large illustrations.
//   • no gradients, no animation beyond the spinner.
//   • action buttons are slate-only, never primary-blue.
//
// Use inside <SectionCard> bodies — sized to fit a card without
// dominating the viewport.
// ---------------------------------------------------------------------------

export interface PanelEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; icon?: React.ReactNode };
  className?: string;
}

export function PanelEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: PanelEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-400">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {action.icon}
          {action.label}
        </button>
      )}
    </div>
  );
}

export interface PanelErrorStateProps {
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function PanelErrorState({
  message,
  onRetry,
  className,
}: PanelErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-red-500">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          <RotateCw className="h-3 w-3" />
          Try again
        </button>
      )}
    </div>
  );
}

export interface PanelLoadingStateProps {
  /** Optional label rendered next to the spinner. */
  label?: string;
  /** Compact (centered, small) vs full (taller) layout. */
  size?: "compact" | "full";
  className?: string;
}

export function PanelLoadingState({
  label,
  size = "full",
  className,
}: PanelLoadingStateProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 text-slate-500",
        size === "full" ? "py-10" : "py-4",
        className,
      )}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton primitives — uniform pulse + sizing so every loading surface
// in the platform looks the same.
// ---------------------------------------------------------------------------

export function SkeletonLine({
  className,
  width = "100%",
}: {
  className?: string;
  width?: string;
}) {
  return (
    <div
      className={cn("h-3 animate-pulse rounded-md bg-slate-100", className)}
      style={{ width }}
    />
  );
}

export function SkeletonRows({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonLine key={i} width={`${65 + ((i * 7) % 30)}%`} />
      ))}
    </div>
  );
}

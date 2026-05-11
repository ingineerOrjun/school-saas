"use client";

import * as React from "react";
import { AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// DangerZoneCard — visually-distinct container for irreversible
// settings actions (delete school, force-logout, reset all marks, …).
//
// Convention: every page that surfaces destructive admin operations
// puts them inside ONE DangerZoneCard at the very bottom of the
// page, separated from the rest of the form. Operators learn the
// pattern: red-tinted card === "actions you cannot undo".
//
// Renders the destructive children as-is (typically Buttons +
// supporting copy). The card itself has no buttons of its own —
// it's a styled container, not a controller.
// ============================================================================

export interface DangerZoneCardProps {
  /** Heading. Defaults to "Danger zone". */
  title?: string;
  /** Short paragraph above the children. */
  description?: React.ReactNode;
  /** Destructive controls go here (Buttons, ConfirmDestructive triggers). */
  children: React.ReactNode;
  className?: string;
}

export function DangerZoneCard({
  title = "Danger zone",
  description,
  children,
  className,
}: DangerZoneCardProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-destructive/30 bg-destructive/5 p-5",
        className,
      )}
      aria-labelledby="danger-zone-title"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <AlertOctagon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <h3
            id="danger-zone-title"
            className="text-sm font-semibold text-destructive"
          >
            {title}
          </h3>
          {description && (
            <p className="text-xs text-destructive/80 leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

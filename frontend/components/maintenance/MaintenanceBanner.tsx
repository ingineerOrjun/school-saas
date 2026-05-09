"use client";

import * as React from "react";
import { Wrench } from "lucide-react";
import { useFeatures } from "@/lib/features";

// ---------------------------------------------------------------------------
// MaintenanceBanner — Phase 17 school-side notice.
//
// Renders a thin amber strip above the dashboard topbar when the
// tenant is in maintenance mode. The actual write-blocking happens
// server-side (MaintenanceModeGuard) — this is the proactive UX
// signal so users see "writes are paused" before they try to save.
//
// Self-hides when not in maintenance mode (the most common case).
// ---------------------------------------------------------------------------

export function MaintenanceBanner() {
  const { maintenanceMode } = useFeatures();
  if (!maintenanceMode) return null;
  return (
    <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
      <Wrench className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        <strong>Maintenance mode is on.</strong> You can still read data,
        but saving changes is paused. Contact your administrator if this
        is unexpected.
      </span>
    </div>
  );
}

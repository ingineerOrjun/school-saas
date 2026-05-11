"use client";

import * as React from "react";
import type { AuditEvent } from "@/lib/audit";
import { AuditEventRow } from "./AuditEventRow";
import { cn } from "@/lib/utils";

// ============================================================================
// ActivityTimeline — vertical event list with a connecting rule.
//
// Used inside RecentActivityPanel and entity-history sidebars. Just
// a stylistic wrapper around N `AuditEventRow`s — keeps the
// connecting-line / hover-zebra visual consistent everywhere.
//
// No internal pagination; the parent owns the data fetch (the
// useRecentActivity hook returns the slice it wants to render).
// ============================================================================

export interface ActivityTimelineProps {
  events: AuditEvent[];
  /** Pass true on dedicated activity pages to expand each row. */
  expanded?: boolean;
  className?: string;
}

export function ActivityTimeline({
  events,
  expanded = false,
  className,
}: ActivityTimelineProps) {
  if (events.length === 0) {
    return null;
  }
  return (
    <ul
      className={cn("divide-y divide-border/70", className)}
      role="list"
      aria-label="Activity timeline"
    >
      {events.map((event) => (
        <li key={event.id} className="px-1">
          <AuditEventRow event={event} expanded={expanded} />
        </li>
      ))}
    </ul>
  );
}

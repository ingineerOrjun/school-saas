"use client";

import * as React from "react";
import { Activity, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { useRecentActivity, type AuditFilters } from "@/lib/audit";
import { ActivityTimeline } from "./ActivityTimeline";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

// ============================================================================
// RecentActivityPanel — drop-in card showing the school's recent
// audit events.
//
// Two use cases:
//
//   1. Dashboard widget — no `filters` prop, shows the latest 10
//      events across the whole school. The header reads "Recent
//      activity". Operators get a passive "what's been happening"
//      glance.
//
//   2. Entity-history sidebar — pass `filters = { targetType,
//      targetId }`. The panel filters to that one entity (one exam,
//      one payment, one student). Used inside marksheet / payment /
//      student-detail pages.
//
// States:
//   • loading   → skeleton list
//   • error     → small inline retry banner (defers permission errors
//                 silently — non-admins shouldn't see a "you don't
//                 have access" message; the panel just hides itself).
//   • empty     → small "no recent activity" copy with icon.
//   • populated → ActivityTimeline render.
//
// Per Phase ops-visibility Part 1, supports compact (default) and
// expanded modes via the `expanded` prop. Compact is one-line per
// event; expanded shows before/after snippets.
// ============================================================================

export interface RecentActivityPanelProps {
  /**
   * Optional filters — narrow to a specific entity for the history-
   * sidebar use case. When omitted, the panel shows all school
   * activity.
   */
  filters?: AuditFilters;
  /** Title override — defaults to "Recent activity". */
  title?: string;
  /** Show the expanded per-row body (before/after, ip). */
  expanded?: boolean;
  /**
   * Maximum rows to fetch. Defaults to 10. The backend caps at 100
   * per page anyway.
   */
  limit?: number;
  /**
   * Render the panel as a card chrome (border + padding + header).
   * Pass `false` to drop the chrome and embed the timeline inside an
   * existing parent card.
   */
  card?: boolean;
  /**
   * Initial collapsed state. Defaults to false (open). The dashboard
   * widget stays open; the entity-history sidebar can pass true.
   */
  collapsible?: boolean;
  className?: string;
}

export function RecentActivityPanel({
  filters,
  title = "Recent activity",
  expanded = false,
  limit = 10,
  card = true,
  collapsible = false,
  className,
}: RecentActivityPanelProps) {
  const [collapsed, setCollapsed] = React.useState(collapsible);

  const query = useRecentActivity({
    ...filters,
    pageSize: limit,
  });

  // 401/403 — silently hide. The backend's role guard 403s
  // non-admins; the panel is operator-facing.
  const status = (query.error as { status?: number } | null)?.status;
  if (status === 401 || status === 403) {
    return null;
  }

  const body = (
    <>
      {query.isLoading ? (
        <div className="space-y-3 py-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-7 w-7 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : query.error ? (
        <div className="flex items-start gap-2 py-2 text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
          <span>Couldn&apos;t load activity right now.</span>
        </div>
      ) : !query.data || query.data.rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground italic">
          No recent activity yet.
        </p>
      ) : (
        <ActivityTimeline events={query.data.rows} expanded={expanded} />
      )}
    </>
  );

  if (!card) {
    return <div className={className}>{body}</div>;
  }

  return (
    <section
      className={cn(
        "glass rounded-xl p-5",
        className,
      )}
      aria-label={title}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {query.data && query.data.total > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              · {query.data.total} event
              {query.data.total === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="text-muted-foreground hover:text-foreground rounded-md p-1"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </header>
      {!collapsed && <div className="mt-3">{body}</div>}
    </section>
  );
}

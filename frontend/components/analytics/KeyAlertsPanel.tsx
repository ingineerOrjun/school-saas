"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Info,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// KeyAlertsPanel — the "what needs your attention right now?" surface.
//
// Sits at the top of the Overview tab, above the KPI grid, so a
// principal scanning the page reads ALERTS → KPIs → CHARTS in order
// of urgency. The point isn't to be a notification center; the point
// is to compress "I should worry about three things this morning"
// into one glance.
//
// Design rules:
//   • Each alert is a single row — icon, title, one-line description,
//     optional drilldown CTA. No nested card-in-card layouts; the
//     panel itself is one card.
//   • Severity carries weight visually: critical (red) > warning
//     (amber) > info (slate). Rows render in severity order so the
//     red ones land at the top regardless of the input array.
//   • The empty state is RENDERED, not hidden. "All clear" is
//     information — it says we checked and nothing's flagged. Hiding
//     would imply we forgot to look.
//   • No dismiss buttons. Alerts are computed each render from
//     underlying state; when the condition resolves, the alert
//     disappears on its own. Persisted dismissal would need a "did
//     you remember to come back to this?" feature — out of scope.
//
// Reusability: this primitive takes a generic `KeyAlert[]` so future
// tabs (Fees-specific alerts, Attendance-specific alerts) can reuse
// it. Today only the Overview tab consumes it.
// ---------------------------------------------------------------------------

export type AlertSeverity = "critical" | "warning" | "info";

export interface KeyAlert {
  /** Stable identifier — used as React key. Doesn't appear in the UI. */
  id: string;
  severity: AlertSeverity;
  /** Headline — bold, short. "Rs 1,23,500 overdue across 12 students." */
  title: string;
  /** Optional one-line context. Skipped when redundant with the title. */
  description?: string;
  /** Drilldown target — turns the right side into a "View →" CTA. */
  href?: string;
  /** Override CTA copy (default "View"). */
  ctaLabel?: string;
}

export interface KeyAlertsPanelProps {
  alerts: KeyAlert[];
  /** Optional className passthrough for layout tweaks. */
  className?: string;
  /** Loading state — renders a skeleton placeholder of fixed height. */
  loading?: boolean;
}

export function KeyAlertsPanel({
  alerts,
  loading,
  className,
}: KeyAlertsPanelProps) {
  if (loading) {
    return (
      <section
        className={cn(
          "rounded-xl border border-border bg-surface p-4 sm:p-5",
          className,
        )}
      >
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-3 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/50" />
          ))}
        </div>
      </section>
    );
  }

  // Severity-first ordering with a stable secondary sort by id, so
  // re-renders don't shuffle equal-priority rows. The caller can pre-
  // sort if they want a different in-severity order; this is the
  // safe default.
  const ordered = React.useMemo(() => {
    const rank: Record<AlertSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    return [...alerts].sort((a, b) => {
      const r = rank[a.severity] - rank[b.severity];
      return r !== 0 ? r : a.id.localeCompare(b.id);
    });
  }, [alerts]);

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-surface p-4 sm:p-5",
        className,
      )}
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Needs attention
        </h2>
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {ordered.length === 0 ? "All clear" : `${ordered.length} item${ordered.length === 1 ? "" : "s"}`}
        </span>
      </header>

      {ordered.length === 0 ? (
        <EmptyAllClear />
      ) : (
        <ul className="divide-y divide-border">
          {ordered.map((a, idx) => (
            <AlertRow key={a.id} alert={a} index={idx} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function AlertRow({ alert, index }: { alert: KeyAlert; index: number }) {
  const meta = severityMeta(alert.severity);
  const Icon = meta.icon;

  return (
    <li
      // Cascade entry — each row plays fade-in-up shifted by 50ms ×
      // index. With a typical 1-3 alerts the tail is < 200ms, which
      // is below the threshold where staggering reads as decoration
      // rather than purposeful motion.
      style={{ animationDelay: `${index * 50}ms` }}
      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 animate-fade-in-up"
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          meta.iconBg,
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium leading-snug",
            meta.titleClass,
          )}
        >
          {alert.title}
        </p>
        {alert.description && (
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
            {alert.description}
          </p>
        )}
      </div>
      {alert.href && (
        <Link
          href={alert.href}
          className={cn(
            "inline-flex items-center gap-0.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium transition-all duration-150",
            "hover:border-primary/40 hover:text-primary hover:bg-primary/5",
            "active:scale-[0.97]",
          )}
        >
          {alert.ctaLabel ?? "View"}
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------

function EmptyAllClear() {
  return (
    <div className="flex items-center gap-3 rounded-md border border-emerald-300/40 bg-emerald-50/40 p-3">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-700"
        aria-hidden
      >
        <CheckCircle2 className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-emerald-900">All clear.</p>
        <p className="mt-0.5 text-[11px] text-emerald-800/70">
          Nothing needs your attention right now.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Severity styling. Kept in one block so adding a future severity
// (e.g. "success" for positive notable events) is a one-place change.
// ---------------------------------------------------------------------------

function severityMeta(severity: AlertSeverity): {
  icon: typeof AlertOctagon;
  iconBg: string;
  titleClass: string;
} {
  switch (severity) {
    case "critical":
      return {
        icon: AlertOctagon,
        iconBg: "bg-destructive/15 text-destructive",
        titleClass: "text-destructive",
      };
    case "warning":
      return {
        icon: AlertTriangle,
        iconBg: "bg-amber-500/15 text-amber-700",
        titleClass: "text-foreground",
      };
    case "info":
    default:
      return {
        icon: Info,
        iconBg: "bg-muted text-muted-foreground",
        titleClass: "text-foreground",
      };
  }
}

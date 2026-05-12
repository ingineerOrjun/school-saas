"use client";

import * as React from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Lock,
  ShieldAlert,
} from "lucide-react";
import {
  PROMOTION_ISSUE_COPY,
  type PromotionIssue,
  type PromotionPreviewEntry,
  type PromotionValidationResult,
} from "@/lib/promotion";
import { cn } from "@/lib/utils";

// ============================================================================
// PromotionPreviewCard — Phase ACADEMIC TRANSITION SAFETY Part 2.
//
// Pure presentation of a `PromotionValidationResult`. The host page
// owns the data fetch + the "Execute promotion" button; this card
// only renders the review.
//
// Layout principle: PESSIMISTIC FIRST.
//   1. Blockers up top — if anything would prevent execution, the
//      operator sees it before scanning anything else.
//   2. Warnings next — visible but non-blocking, so they sit below
//      the blockers and above the per-row table.
//   3. Counts strip — totals matter for confidence in the result.
//   4. Per-row table — operator can scan exactly who would be
//      promoted, retained, left, or blocked.
//
// Empty-state: when the preview returns 0 entries (no payload yet)
// the card shows a clear "compose your promotion plan" affordance
// rather than rendering an empty grid.
// ============================================================================

export interface PromotionPreviewCardProps {
  result: PromotionValidationResult | null;
  /** True while the preview is being refetched after the operator
   *  tweaked the payload — dim the panel rather than rip it out. */
  refreshing?: boolean;
  /** Optional max rows before the per-student table collapses to a
   *  "and N more" footer. Defaults to 200. */
  maxRows?: number;
  className?: string;
}

export function PromotionPreviewCard({
  result,
  refreshing,
  maxRows = 200,
  className,
}: PromotionPreviewCardProps) {
  if (!result) {
    return (
      <div className={cn("glass rounded-xl p-6", className)}>
        <EmptyShell />
      </div>
    );
  }

  const { fromSession, nextSession, counts, entries, blockers, warnings } =
    result;

  return (
    <section
      aria-labelledby="promotion-preview-heading"
      className={cn(
        "glass rounded-xl p-6 space-y-6",
        refreshing && "opacity-70",
        className,
      )}
    >
      {/* ----- Heading + can-run summary ----- */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="promotion-preview-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            Promotion preview
          </h2>
          <p className="text-sm text-muted-foreground">
            {fromSession ? (
              <>
                Roll forward from{" "}
                <span className="font-medium text-foreground">
                  {fromSession.name}
                </span>{" "}
                <ArrowRight className="inline h-3.5 w-3.5 -translate-y-px" />{" "}
                <span className="font-medium text-foreground">
                  {nextSession.name || "(unnamed)"}
                </span>
                {fromSession.isLocked ? null : (
                  <span className="ml-2 text-amber-700 dark:text-amber-300">
                    — current session is not locked yet.
                  </span>
                )}
              </>
            ) : (
              <>
                No active session detected. Configure one in Settings →
                Sessions before previewing.
              </>
            )}
          </p>
        </div>
        <RunReadyChip canRun={result.canRun} blockedCount={blockers.length} />
      </header>

      {/* ----- Blockers (errors) ----- */}
      {blockers.length > 0 && (
        <IssueGroup
          title={`${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`}
          tone="rose"
          icon={<AlertOctagon className="h-4 w-4" />}
          issues={blockers}
        />
      )}

      {/* ----- Warnings ----- */}
      {warnings.length > 0 && (
        <IssueGroup
          title={`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
          tone="amber"
          icon={<AlertTriangle className="h-4 w-4" />}
          issues={warnings}
        />
      )}

      {/* ----- Counts strip ----- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <CountStat
          label="Total"
          value={counts.total}
          tone="slate"
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <CountStat
          label="Will promote"
          value={counts.willPromote}
          tone="emerald"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <CountStat label="Will retain" value={counts.willRetain} tone="sky" />
        <CountStat label="Will leave" value={counts.willLeave} tone="slate" />
        <CountStat
          label="Blocked"
          value={counts.blocked}
          tone={counts.blocked > 0 ? "rose" : "slate"}
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <CountStat
          label="Archived excluded"
          value={counts.archivedExcluded}
          tone={counts.archivedExcluded > 0 ? "amber" : "slate"}
          icon={<Archive className="h-4 w-4" />}
        />
      </div>

      {/* ----- Per-row table ----- */}
      {entries.length > 0 && (
        <PreviewTable entries={entries} maxRows={maxRows} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RunReadyChip({
  canRun,
  blockedCount,
}: {
  canRun: boolean;
  blockedCount: number;
}) {
  if (canRun) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Ready to run
      </span>
    );
  }
  return (
    <span
      title={`${blockedCount} blocker${blockedCount === 1 ? "" : "s"} prevent execution`}
      className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-rose-800 ring-1 ring-rose-300/60 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30"
    >
      <Lock className="h-3.5 w-3.5" />
      Cannot run
    </span>
  );
}

function IssueGroup({
  title,
  tone,
  icon,
  issues,
}: {
  title: string;
  tone: "rose" | "amber";
  icon: React.ReactNode;
  issues: PromotionIssue[];
}) {
  const toneClass =
    tone === "rose"
      ? "border-rose-300/50 bg-rose-50 text-rose-900 dark:bg-rose-500/5 dark:border-rose-500/30 dark:text-rose-200"
      : "border-amber-300/50 bg-amber-50 text-amber-900 dark:bg-amber-500/5 dark:border-amber-500/30 dark:text-amber-200";
  return (
    <div className={cn("rounded-md border p-4 space-y-2", toneClass)}>
      <div className="flex items-center gap-2 font-semibold text-sm">
        {icon}
        {title}
      </div>
      <ul className="space-y-1.5 text-sm">
        {issues.map((issue, i) => (
          <IssueLine key={`${issue.code}-${i}`} issue={issue} />
        ))}
      </ul>
    </div>
  );
}

function IssueLine({ issue }: { issue: PromotionIssue }) {
  const copy = PROMOTION_ISSUE_COPY[issue.code];
  const title = copy?.title ?? issue.code;
  const remediation = copy?.remediation;
  return (
    <li>
      <div className="font-medium">{title}</div>
      <div className="opacity-90">{issue.message}</div>
      {remediation && (
        <div className="text-[12px] opacity-80 mt-0.5">
          → {remediation}
        </div>
      )}
    </li>
  );
}

function CountStat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "rose" | "amber" | "sky";
  icon?: React.ReactNode;
}) {
  const toneClass = {
    slate: "bg-muted/40 text-foreground",
    emerald: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
    rose: "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-300",
    amber: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
    sky: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  }[tone];
  return (
    <div className={cn("rounded-md p-3 space-y-0.5", toneClass)}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PreviewTable({
  entries,
  maxRows,
}: {
  entries: PromotionPreviewEntry[];
  maxRows: number;
}) {
  const visible = entries.slice(0, maxRows);
  const hiddenCount = entries.length - visible.length;
  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/30 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Th>Student</Th>
            <Th>From</Th>
            <Th>To</Th>
            <Th>Status</Th>
            <Th className="text-right">Issues</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <PreviewRow key={row.studentId} row={row} />
          ))}
          {hiddenCount > 0 && (
            <tr>
              <td
                colSpan={5}
                className="px-4 py-2 text-center text-xs italic text-muted-foreground"
              >
                + {hiddenCount} more row(s) hidden — refine the payload or
                paginate.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PreviewRow({ row }: { row: PromotionPreviewEntry }) {
  return (
    <tr
      className={cn(
        "border-t border-border/40 align-top",
        row.blocked && "bg-rose-50/50 dark:bg-rose-500/5",
      )}
    >
      <Td>
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{row.studentName}</span>
          {row.archived && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700 dark:bg-slate-700/40 dark:text-slate-200">
              <Archive className="h-2.5 w-2.5" />
              Archived
            </span>
          )}
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          #{row.studentId.slice(0, 8)}
        </div>
      </Td>
      <Td className="text-muted-foreground">
        {row.currentClassName ?? "—"}
      </Td>
      <Td>
        {row.proposedStatus === "PROMOTED" ? (
          <span className="font-medium text-foreground">
            {row.nextClassName ?? "—"}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td>
        <StatusPill status={row.proposedStatus} blocked={row.blocked} />
      </Td>
      <Td className="text-right">
        {row.issues.length === 0 ? (
          <span className="text-emerald-700 dark:text-emerald-400">OK</span>
        ) : (
          <RowIssueSummary issues={row.issues} />
        )}
      </Td>
    </tr>
  );
}

function StatusPill({
  status,
  blocked,
}: {
  status: PromotionPreviewEntry["proposedStatus"];
  blocked: boolean;
}) {
  if (blocked) {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">
        Blocked
      </span>
    );
  }
  const map: Record<
    PromotionPreviewEntry["proposedStatus"],
    { label: string; tone: string }
  > = {
    PROMOTED: {
      label: "Promote",
      tone:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    },
    RETAINED: {
      label: "Retain",
      tone:
        "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    },
    LEFT: {
      label: "Leave",
      tone:
        "bg-slate-200 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200",
    },
  };
  const { label, tone } = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        tone,
      )}
    >
      {label}
    </span>
  );
}

function RowIssueSummary({ issues }: { issues: PromotionIssue[] }) {
  // Compact summary chip — hover for the full message list.
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warning").length;
  const tooltip = issues
    .map((i) => `[${i.severity}] ${PROMOTION_ISSUE_COPY[i.code]?.title ?? i.code}: ${i.message}`)
    .join("\n");
  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 text-xs"
    >
      {errors > 0 && (
        <span className="rounded-full bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">
          {errors} error{errors === 1 ? "" : "s"}
        </span>
      )}
      {warns > 0 && (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          {warns} warn
        </span>
      )}
    </span>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("h-10 px-4 align-middle font-semibold", className)}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("px-4 py-2.5 align-middle", className)}>{children}</td>
  );
}

function EmptyShell() {
  return (
    <div className="flex items-start gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ClipboardList className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          Promotion preview
        </h2>
        <p className="text-sm text-muted-foreground max-w-prose">
          Compose your roll-forward payload on the left, then hit{" "}
          <span className="font-medium text-foreground">Preview</span> to see
          exactly what would happen — before any rows change. Nothing is
          written until you explicitly execute.
        </p>
      </div>
    </div>
  );
}

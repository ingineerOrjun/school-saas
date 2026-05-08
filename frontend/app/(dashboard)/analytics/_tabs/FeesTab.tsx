"use client";

import * as React from "react";
import Link from "next/link";
import {
  Wallet,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  Calendar,
  RotateCcw,
  Banknote,
  Building2,
  Smartphone,
  CircleDashed,
  ExternalLink,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import {
  feesApi,
  type FeesSummary,
  type CashierSummary,
  type DuesRow,
  type PaymentMethod,
} from "@/lib/fees";
import { formatCurrency } from "@/lib/currency";
import { downloadCsv, csvFilenameStamp } from "@/lib/csv";
import { todayISO } from "@/lib/attendance";
import { KpiCard, KpiCardSkeleton } from "@/components/analytics/KpiCard";
import { DeltaBadge } from "@/components/analytics/DeltaBadge";
import type { AnalyticsFilters } from "../page";
import {
  compareLabel,
  currentFromTrend,
  previousFromTrend,
} from "../_compare";

/** YYYY-MM-DD for the first day of the current month — used for
 *  the "This month" KPI's drilldown range. */
function startOfMonthIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// Fees & Finance tab — the deepest dive into school money flow.
//
// Composition:
//   • KPI grid (6 tiles): collected today, this month, total collected,
//     pending, overdue, refunds today
//   • Method split + cashier split (two cards side-by-side, both
//     sourced from /fees/cashier-summary)
//   • Top-overdue students table (sourced from /fees/dues, ranked by
//     totalDue desc among overdue rows)
//   • Monthly collection table — same data as Overview's chart, here
//     as numbers because the audit-trail audience wants the figures.
//
// All data comes from existing endpoints — no new backend work here.
// The date filter from the page shell is informational only for v1
// (most fees aggregations are "as of now"); a future iteration could
// honor it by adding `?fromDate=&toDate=` to /fees/summary.
// ---------------------------------------------------------------------------

export function FeesTab({ filters }: { filters: AnalyticsFilters }) {
  // `filters.compare` drives Phase-2 delta rendering; other filter
  // fields don't yet alter the data fetch (the fees aggregations are
  // "as of now" — Phase 2.2 work to honor a date range here).
  const [summary, setSummary] = React.useState<FeesSummary | null>(null);
  const [cashier, setCashier] = React.useState<CashierSummary | null>(null);
  const [dues, setDues] = React.useState<DuesRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      feesApi.getSummary(),
      feesApi.getCashierSummary(),
      feesApi.getDues(),
    ])
      .then(([s, c, d]) => {
        if (cancelled) return;
        setSummary(s);
        setCashier(c);
        setDues(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load fees data.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="space-y-6">
      <KpiGrid
        summary={summary}
        cashier={cashier}
        loading={loading}
        compare={filters.compare}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Collection by method" subtitle="Today">
          {loading || !cashier ? (
            <Loader />
          ) : (
            <MethodBreakdown summary={cashier} />
          )}
        </Card>
        <Card title="Collection by cashier" subtitle="Today">
          {loading || !cashier ? (
            <Loader />
          ) : (
            <CashierBreakdown summary={cashier} />
          )}
        </Card>
      </div>

      <Card
        title="Top overdue students"
        subtitle="Highest balance first"
        cta={{ href: "/fees", label: "View all dues" }}
        toolbar={
          dues && dues.some((d) => d.overdue) ? (
            <ExportButton
              label="Export overdue"
              onClick={() => exportOverdueCsv(dues)}
            />
          ) : undefined
        }
      >
        {loading || !dues ? <Loader /> : <TopOverdueTable dues={dues} />}
      </Card>

      <Card
        title="Monthly collection · last 12 months"
        subtitle={compareLabel(filters.compare) ?? undefined}
        toolbar={
          summary && summary.monthlyTrend.length > 0 ? (
            <ExportButton
              label="Export months"
              onClick={() => exportMonthlyTrendCsv(summary.monthlyTrend)}
            />
          ) : undefined
        }
      >
        {loading || !summary ? (
          <Loader />
        ) : (
          <MonthlyCollectionTable trend={summary.monthlyTrend} />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiGrid({
  summary,
  cashier,
  loading,
  compare,
}: {
  summary: FeesSummary | null;
  cashier: CashierSummary | null;
  loading: boolean;
  compare: import("../_filters").CompareMode;
}) {
  if (loading || !summary || !cashier) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  // Drilldown date strings — Today's-collection deep-links to a Payment
  // History view filtered to today; This-month uses the calendar-month
  // start as the lower bound. The Payment History page already accepts
  // these query params, so the deep link surfaces the exact subset
  // the KPI represents.
  const today = todayISO();
  const monthStart = startOfMonthIso();

  // Compare-mode wiring. The 12-month trend is the data source for
  // both prev_month + prev_year deltas — see `_compare.ts` for the
  // selection rule. When compare === "none", `previousFromTrend`
  // returns null and `<DeltaBadge>` is rendered as `null` (skipped
  // by KpiCard's optional `delta` slot).
  const prevMonthCollection = previousFromTrend(
    summary.monthlyTrend,
    compare,
    "collected",
  );
  const thisMonthFromTrend = currentFromTrend(
    summary.monthlyTrend,
    "collected",
  );
  const renderDelta = compare !== "none";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        label="Today"
        value={formatCurrency(cashier.collectedToday)}
        icon={<CheckCircle2 className="h-4 w-4" />}
        tone="primary"
        hint={`${cashier.transactionsToday} txn${cashier.transactionsToday === 1 ? "" : "s"}`}
        href={`/fees/payments?fromDate=${today}&toDate=${today}`}
      />
      <KpiCard
        label="This month"
        value={formatCurrency(summary.thisMonthCollection)}
        icon={<Calendar className="h-4 w-4" />}
        tone="primary"
        href={`/fees/payments?fromDate=${monthStart}&toDate=${today}`}
        delta={
          renderDelta ? (
            <DeltaBadge
              // We use the monthly-trend's "current month" value
              // rather than `thisMonthCollection` so the delta math
              // stays internally consistent: same source, same
              // bucketing, no off-by-one between mid-month + month-
              // boundary.
              current={thisMonthFromTrend}
              previous={prevMonthCollection}
              format="percent"
              goodWhen="up"
            />
          ) : null
        }
      />
      <KpiCard
        label="Total collected"
        value={formatCurrency(summary.totalCollected)}
        icon={<TrendingUp className="h-4 w-4" />}
        tone="muted"
        hint={`of ${formatCurrency(summary.totalAssigned)} assigned`}
        href="/fees/payments"
      />
      <KpiCard
        label="Total pending"
        value={formatCurrency(summary.totalPending)}
        icon={<Wallet className="h-4 w-4" />}
        tone={summary.totalPending > 0 ? "muted" : "success"}
        href="/fees"
      />
      <KpiCard
        label="Overdue"
        value={formatCurrency(summary.totalOverdue)}
        icon={<AlertTriangle className="h-4 w-4" />}
        tone={summary.totalOverdue > 0 ? "destructive" : "muted"}
        hint={
          summary.studentsWithDues > 0
            ? `${summary.studentsWithDues} owe`
            : undefined
        }
        href="/fees"
      />
      <KpiCard
        label="Refunds today"
        value={
          cashier.refundsToday === 0
            ? "0"
            : `${cashier.refundsToday} · ${formatCurrency(cashier.refundsAmountToday)}`
        }
        icon={<RotateCcw className="h-4 w-4" />}
        tone={cashier.refundsToday > 0 ? "destructive" : "muted"}
        // Refund drilldown: Payment History scoped to today. The
        // history page renders refund rows with a "Refund" pill so
        // they're scannable inside the today's-payments list — no
        // dedicated refund-only filter needed.
        href={
          cashier.refundsToday > 0
            ? `/fees/payments?fromDate=${today}&toDate=${today}`
            : undefined
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Method breakdown — horizontal-bar list. Each row shows the method's
// label, its amount + transaction count, and a thin bar whose width
// represents share of net positive collection.
// ---------------------------------------------------------------------------

function MethodBreakdown({ summary }: { summary: CashierSummary }) {
  const positives = summary.byMethod.filter((m) => m.amount > 0);
  const positiveTotal = positives.reduce((s, m) => s + m.amount, 0);

  if (summary.byMethod.length === 0) {
    return <EmptyHint>No payments today.</EmptyHint>;
  }

  // Method drilldown: each row links to today's Payment History
  // filtered to that method. The "UNKNOWN" bucket (no recorded method)
  // can't be filtered server-side because there's no `method=null`
  // query — so those rows render as static (no link).
  const today = todayISO();

  return (
    <ul className="space-y-3">
      {summary.byMethod.map((m) => {
        const pct = positiveTotal > 0 ? (m.amount / positiveTotal) * 100 : 0;
        // The "UNKNOWN" bucket can't be filtered server-side (no
        // method=null query); render it as static. Everything else
        // becomes a drilldown link to today's history filtered to
        // that method.
        const drilldownHref =
          m.method === "UNKNOWN"
            ? null
            : `/fees/payments?fromDate=${today}&toDate=${today}&method=${m.method}`;
        const body = (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded text-muted-foreground",
                    methodChipBg(m.method),
                  )}
                >
                  {methodIcon(m.method)}
                </span>
                {methodLabel(m.method)}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatCurrency(m.amount)} · {m.count} txn
                {m.count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full", methodBarColor(m.method))}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </>
        );
        return (
          <li key={m.method}>
            {drilldownHref ? (
              <Link
                href={drilldownHref}
                title={`View ${methodLabel(m.method)} payments today`}
                className="block rounded-md hover:bg-muted/40 transition-colors -mx-1 px-1 py-1"
              >
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Cashier breakdown — same horizontal-bar treatment as method, but the
// rows are users (email + role). Useful for end-of-day reconciliation
// when multiple staff have been collecting in parallel.
// ---------------------------------------------------------------------------

function CashierBreakdown({ summary }: { summary: CashierSummary }) {
  if (summary.byCashier.length === 0) {
    return <EmptyHint>No payments today.</EmptyHint>;
  }
  const total = summary.byCashier.reduce(
    (s, c) => s + Math.max(0, c.amount),
    0,
  );
  return (
    <ul className="space-y-3">
      {summary.byCashier.map((c) => {
        const pct = total > 0 ? (Math.max(0, c.amount) / total) * 100 : 0;
        const label = c.email ?? "Unattributed (legacy)";
        return (
          <li key={c.userId ?? "__legacy__"}>
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex flex-col leading-tight">
                <span className="font-medium text-foreground">{label}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {c.role ?? "—"}
                </span>
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatCurrency(c.amount)} · {c.count} txn
                {c.count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Top-overdue table — show the 8 highest-balance overdue students.
// Each row is a drilldown link to the student's fees ledger.
// ---------------------------------------------------------------------------

function TopOverdueTable({ dues }: { dues: DuesRow[] }) {
  const overdue = dues
    .filter((d) => d.overdue)
    .sort((a, b) => b.totalDue - a.totalDue)
    .slice(0, 8);

  if (overdue.length === 0) {
    return <EmptyHint>Nothing past due. 🎉</EmptyHint>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Student</th>
            <th className="px-3 py-2 text-left">Class</th>
            <th className="px-3 py-2 text-left">Oldest due</th>
            <th className="px-3 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {overdue.map((d) => (
            <tr key={d.studentId} className="bg-destructive/[0.02]">
              <td className="px-3 py-2">
                <Link
                  href={`/fees/${d.studentId}`}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {d.firstName} {d.lastName}
                </Link>
                {d.symbolNumber && (
                  <div className="text-[10px] font-mono text-muted-foreground">
                    {d.symbolNumber}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {d.className ?? "Unassigned"}
                {d.sectionName && (
                  <span className="text-muted-foreground/70">
                    {" · "}
                    {d.sectionName}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                {d.oldestDueDate ?? "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-destructive">
                {formatCurrency(d.totalDue)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly collection — table view of the same data the Overview tab
// renders as a chart. Numbers-first audience wants tabular form so they
// can copy a single month or eyeball the per-month figure.
// ---------------------------------------------------------------------------

function MonthlyCollectionTable({
  trend,
}: {
  trend: FeesSummary["monthlyTrend"];
}) {
  if (trend.length === 0)
    return <EmptyHint>No payments yet.</EmptyHint>;
  const max = Math.max(...trend.map((t) => t.collected), 1);
  // Show in reverse-chronological order so the most recent month
  // surfaces at the top — that's what an admin reaches for first.
  const reversed = [...trend].reverse();
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-3 py-2">Share</th>
            <th className="px-3 py-2 text-right">Collected</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reversed.map((t) => {
            const pct = max > 0 ? (t.collected / max) * 100 : 0;
            return (
              <tr key={t.month}>
                <td className="px-3 py-2 font-mono text-xs">{t.month}</td>
                <td className="px-3 py-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                  {formatCurrency(t.collected)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared cards / hints
// ---------------------------------------------------------------------------

function Card({
  title,
  subtitle,
  cta,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: string;
  cta?: { href: string; label: string };
  /**
   * Optional inline action (e.g. Export CSV) rendered to the right of
   * the card title. Sits to the LEFT of `cta` when both are provided
   * — toolbar actions are operations on the card's data, `cta` is
   * navigation away from the card. Reading flow: data action → drilldown.
   */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <header className="mb-3 flex items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <span className="text-[11px] text-muted-foreground">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toolbar}
          {cta && (
            <Link
              href={cta.href}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              {cta.label}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

function ExportButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
    >
      <Download className="h-3 w-3" />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CSV builders for the Fees tab. Live next to the components that use
// them so the column order + labels stay obvious; share the
// `downloadCsv` helper for the actual file machinery.
// ---------------------------------------------------------------------------

function exportOverdueCsv(dues: DuesRow[]) {
  const rows = dues
    .filter((d) => d.overdue)
    .sort((a, b) => b.totalDue - a.totalDue)
    .map((d) => [
      d.firstName + " " + d.lastName,
      d.symbolNumber ?? "",
      d.className ?? "",
      d.sectionName ?? "",
      d.oldestDueDate ?? "",
      // Number, no symbol — Excel reads it as currency-ready and the
      // column stays sortable.
      d.totalDue.toFixed(2),
      d.totalAssigned.toFixed(2),
      d.totalPaid.toFixed(2),
    ]);
  downloadCsv({
    filename: `overdue-${csvFilenameStamp()}.csv`,
    header: [
      "Student",
      "Symbol No.",
      "Class",
      "Section",
      "Oldest due",
      "Balance",
      "Assigned",
      "Paid",
    ],
    rows,
  });
}

function exportMonthlyTrendCsv(trend: FeesSummary["monthlyTrend"]) {
  // Reverse-chronological matches what the table shows on screen so
  // an exported view mirrors the rendered one.
  const rows = [...trend]
    .reverse()
    .map((t) => [t.month, t.collected.toFixed(2)]);
  downloadCsv({
    filename: `collection-by-month-${csvFilenameStamp()}.csv`,
    header: ["Month", "Collected"],
    rows,
  });
}

function Loader() {
  return <div className="h-32 animate-pulse rounded bg-muted/50" />;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/10 px-4 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-destructive font-medium">
        <AlertTriangle className="h-4 w-4" />
        {message}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Method styling — kept in sync with the Cashier workspace's stats bar
// so the same method always reads the same color across the app.
// ---------------------------------------------------------------------------

function methodLabel(m: PaymentMethod | "UNKNOWN"): string {
  switch (m) {
    case "CASH":
      return "Cash";
    case "BANK":
      return "Bank";
    case "ESEWA":
      return "eSewa";
    case "OTHER":
      return "Other";
    case "UNKNOWN":
      return "Unspecified";
  }
}

function methodIcon(m: PaymentMethod | "UNKNOWN"): React.ReactNode {
  switch (m) {
    case "CASH":
      return <Banknote className="h-3 w-3" />;
    case "BANK":
      return <Building2 className="h-3 w-3" />;
    case "ESEWA":
      return <Smartphone className="h-3 w-3" />;
    case "OTHER":
    case "UNKNOWN":
      return <CircleDashed className="h-3 w-3" />;
  }
}

function methodBarColor(m: PaymentMethod | "UNKNOWN"): string {
  switch (m) {
    case "CASH":
      return "bg-emerald-500";
    case "BANK":
      return "bg-sky-500";
    case "ESEWA":
      return "bg-violet-500";
    case "OTHER":
    case "UNKNOWN":
      return "bg-slate-400";
  }
}

function methodChipBg(m: PaymentMethod | "UNKNOWN"): string {
  switch (m) {
    case "CASH":
      return "bg-emerald-500/15 text-emerald-700";
    case "BANK":
      return "bg-sky-500/15 text-sky-700";
    case "ESEWA":
      return "bg-violet-500/15 text-violet-700";
    case "OTHER":
    case "UNKNOWN":
      return "bg-slate-500/15 text-slate-700";
  }
}

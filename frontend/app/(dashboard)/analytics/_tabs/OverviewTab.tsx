"use client";

import * as React from "react";
import {
  Users,
  GraduationCap,
  CalendarCheck,
  Wallet,
  AlertTriangle,
  School,
  PiggyBank,
  TrendingUp,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { dashboardApi, type DashboardSummary } from "@/lib/dashboard";
import { feesApi, type FeesSummary } from "@/lib/fees";
import { attendanceApi, type AttendanceTrend } from "@/lib/attendance";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";
import { AttendanceTrendChart } from "@/components/charts/AttendanceTrendChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { KpiCard, KpiCardSkeleton } from "@/components/analytics/KpiCard";
import { DeltaBadge } from "@/components/analytics/DeltaBadge";
import {
  KeyAlertsPanel,
  type KeyAlert,
} from "@/components/analytics/KeyAlertsPanel";
import type { AnalyticsFilters } from "../page";
import { currentFromTrend, previousFromTrend } from "../_compare";

// ---------------------------------------------------------------------------
// Overview tab — the principal's "what's happening today" snapshot.
//
// Composition:
//   • Top KPI grid (8 tiles): students, teachers, classes, today's
//     attendance %, this-month collection, total pending, overdue
//     amount, general credit.
//   • Two trend cards side-by-side:
//       - Attendance trend (the existing AttendanceTrendChart)
//       - Monthly collection trend (Sparkline against the
//         `/fees/summary.monthlyTrend` data we already have)
//
// Data flow: three parallel fetches (dashboard, fees-summary, attendance
// trend). The dashboard endpoint already aggregates most KPIs in a
// single round-trip; fees-summary adds month/year context; attendance
// trend handles the chart data. No new backend endpoints needed for this
// tab — pure composition over what exists.
// ---------------------------------------------------------------------------

export function OverviewTab({ filters }: { filters: AnalyticsFilters }) {
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [fees, setFees] = React.useState<FeesSummary | null>(null);
  const [attendance, setAttendance] = React.useState<AttendanceTrend | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Parallel fetch. The fees + dashboard payloads are global (no
    // date filter); only the attendance trend respects the picker.
    // That asymmetry is intentional — fees rolling totals are
    // "as of now" by design (so deltas stay meaningful even if the
    // user moves the date range), while attendance is a windowed
    // trend that benefits from the picker.
    Promise.all([
      dashboardApi.getSummary(),
      feesApi.getSummary(),
      // Attendance trend honors classId / sectionId from the global
      // filter bar. The trend endpoint accepts either (or neither) —
      // when both are empty we get the school-wide trend, which is the
      // default Overview view.
      attendanceApi.getTrend({
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
        ...(filters.classId && !filters.sectionId
          ? { classId: filters.classId }
          : {}),
      }),
    ])
      .then(([s, f, a]) => {
        if (cancelled) return;
        setSummary(s);
        setFees(f);
        setAttendance(a);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load overview.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Only re-fetch when filter values that the queries actually
    // consume change. classId/sectionId on attendance trend; dates on
    // the trend window.
  }, [filters.fromDate, filters.toDate, filters.classId, filters.sectionId]);

  if (error) {
    return <ErrorBanner message={error} />;
  }

  // Compute the principal's alert list from the data we already have.
  // Pure derivation — no extra fetches. `useMemo` keys on the three
  // payloads so the alerts re-derive only when their source actually
  // changes, not on every parent re-render.
  const alerts = React.useMemo(
    () => deriveKeyAlerts({ summary, fees, attendance }),
    [summary, fees, attendance],
  );

  return (
    <div className="space-y-6">
      {/* Key alerts come FIRST. This is the framing shift from
          "analytics dashboard" to "principal's control center" —
          before you scan the KPI grid, you see what needs your
          attention. When nothing's flagged, the panel renders an
          "All clear" empty state rather than disappearing, so the
          principal knows we checked. */}
      <KeyAlertsPanel alerts={alerts} loading={loading} />

      <KpiGrid
        summary={summary}
        fees={fees}
        loading={loading}
        compare={filters.compare}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Attendance trend" subtitle={attendanceSubtitle(attendance)}>
          {loading || !attendance ? (
            <div className="h-[220px] animate-pulse rounded bg-muted/50" />
          ) : (
            <AttendanceTrendChart data={attendance.daily} height={220} />
          )}
        </Card>
        <Card
          title="Monthly collection"
          subtitle={fees ? `${fees.monthlyTrend.length} months tracked` : ""}
        >
          {loading || !fees ? (
            <div className="h-[220px] animate-pulse rounded bg-muted/50" />
          ) : (
            <CollectionTrend data={fees.monthlyTrend} />
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI grid — 8 tiles, two rows.
//
// Row 1 — operational identity (people + today)
//   • Students · Teachers · Classes · Today's attendance
//
// Row 2 — money + alerts
//   • This month · Total pending · Overdue · Credit pool
// ---------------------------------------------------------------------------

function KpiGrid({
  summary,
  fees,
  loading,
  compare,
}: {
  summary: DashboardSummary | null;
  fees: FeesSummary | null;
  loading: boolean;
  compare: import("../_filters").CompareMode;
}) {
  if (loading || !summary || !fees) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const att = summary.stats.attendanceTodayPct;
  const attMarked = summary.stats.attendanceMarkedToday;

  // Compare-mode: pull current + previous month-collection from the
  // monthlyTrend that's already on the fees-summary payload. Other
  // tiles (students, teachers, classes, today's attendance) don't
  // get deltas in v1 because the dashboard endpoint doesn't carry a
  // historical baseline — Phase 2.2 will add `studentsDelta` /
  // `teachersDelta` to the dashboard summary so those tiles can
  // surface change-vs-period too.
  const renderDelta = compare !== "none";
  const prevMonthCollection = previousFromTrend(
    fees.monthlyTrend,
    compare,
    "collected",
  );
  const thisMonthFromTrend = currentFromTrend(
    fees.monthlyTrend,
    "collected",
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Total students"
          value={summary.stats.totalStudents.toLocaleString("en-IN")}
          icon={<Users className="h-4 w-4" />}
          tone="muted"
          href="/students"
        />
        <KpiCard
          label="Teachers"
          value={summary.stats.totalTeachers.toLocaleString("en-IN")}
          icon={<GraduationCap className="h-4 w-4" />}
          tone="muted"
          href="/teachers"
        />
        <KpiCard
          label="Active classes"
          value={summary.stats.totalClasses.toLocaleString("en-IN")}
          icon={<School className="h-4 w-4" />}
          tone="muted"
          href="/classes"
        />
        <KpiCard
          label="Today's attendance"
          value={attMarked > 0 ? `${att.toFixed(1)}%` : "—"}
          icon={<CalendarCheck className="h-4 w-4" />}
          tone={
            attMarked === 0
              ? "muted"
              : att >= 90
                ? "success"
                : att >= 75
                  ? "primary"
                  : "destructive"
          }
          hint={
            attMarked > 0
              ? `${attMarked} of ${summary.stats.attendanceTotalToday} marked`
              : "Not marked yet"
          }
          href="/attendance"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="This month collected"
          value={formatCurrency(fees.thisMonthCollection)}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="primary"
          href="/fees/payments"
          delta={
            renderDelta ? (
              <DeltaBadge
                current={thisMonthFromTrend}
                previous={prevMonthCollection}
                format="percent"
                goodWhen="up"
              />
            ) : null
          }
        />
        <KpiCard
          label="Total pending"
          value={formatCurrency(fees.totalPending)}
          icon={<Wallet className="h-4 w-4" />}
          tone={fees.totalPending > 0 ? "muted" : "success"}
          hint={
            fees.totalAssigned > 0
              ? `of ${formatCurrency(fees.totalAssigned)} assigned`
              : undefined
          }
          href="/fees"
        />
        <KpiCard
          label="Overdue amount"
          value={formatCurrency(fees.totalOverdue)}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={fees.totalOverdue > 0 ? "destructive" : "muted"}
          hint={
            fees.studentsWithDues > 0
              ? `${fees.studentsWithDues} student${fees.studentsWithDues === 1 ? "" : "s"} owe`
              : "Nothing outstanding"
          }
          href="/fees"
        />
        <KpiCard
          label="General Credit"
          value={formatCurrencyShort(summary.stats.totalCredit)}
          icon={<PiggyBank className="h-4 w-4" />}
          tone="muted"
          hint="Unallocated parent payments"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <header className="mb-3 flex items-end justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <span className="text-[11px] text-muted-foreground">{subtitle}</span>
        )}
      </header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// CollectionTrend — small bar chart over the 12-month series.
//
// Why bars instead of a line: monthly collection is naturally
// discrete + comparable across months. A line implies "smooth flow
// between data points" which doesn't reflect how a school's billing
// cycle actually works (collection clusters around fee-due windows).
// Bars preserve the discreteness AND make the highest/lowest months
// scan-readable at a glance.
//
// Layout: SVG with viewBox so it scales to the card width. We render
// the y-axis as the implicit chart height (no axis labels — the
// max-month value lives in the tooltip on hover instead).
// ---------------------------------------------------------------------------

function CollectionTrend({
  data,
}: {
  data: FeesSummary["monthlyTrend"];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
        No payments yet.
      </div>
    );
  }
  const max = Math.max(...data.map((d) => d.collected), 1);
  const total = data.reduce((s, d) => s + d.collected, 0);
  const avg = total / data.length;

  // Use Sparkline for the headline visual + a compact bar grid below.
  // Sparkline gives a single sweep; the grid gives per-month numbers.
  // Sparkline values are the per-month collected amounts; the chart
  // honors null for gaps but here we always have a value (zero is
  // valid).
  return (
    <div>
      <Sparkline
        values={data.map((d) => d.collected)}
        height={64}
        filled
        // strokeClassName uses `currentColor` for both the stroke and
        // (via `fill-current`) the area fill, so the emerald tone
        // applies to both.
        strokeClassName="text-emerald-600"
      />
      <div className="mt-3 grid grid-cols-6 gap-1 sm:grid-cols-12">
        {data.map((d) => {
          const heightPct = max > 0 ? (d.collected / max) * 100 : 0;
          const ym = d.month.slice(5); // "MM"
          return (
            <div
              key={d.month}
              className="flex flex-col items-center gap-1"
              title={`${d.month}: ${formatCurrency(d.collected)}`}
            >
              <div className="flex h-12 w-full items-end">
                <div
                  className="w-full rounded-sm bg-emerald-500/40"
                  style={{ height: `${Math.max(heightPct, 2)}%` }}
                />
              </div>
              <span className="text-[9px] tabular-nums text-muted-foreground">
                {ym}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Avg{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCurrency(avg)}
          </span>{" "}
          / month
        </span>
        <span>
          Last 12 months total{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatCurrency(total)}
          </span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

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

function attendanceSubtitle(a: AttendanceTrend | null): string {
  if (!a) return "";
  return `${a.fromDate} → ${a.toDate}`;
}

// ---------------------------------------------------------------------------
// deriveKeyAlerts — turn the three loaded payloads into a prioritised
// list of "what should the principal do today?" cards.
//
// Source data:
//   • summary    → today's attendance %, marked-vs-total, school totals
//   • fees       → totalOverdue, studentsWithDues, monthlyTrend
//   • attendance → daily buckets for the active window
//
// Rules (in evaluation order — but the panel sorts by severity, not
// declaration order, so the order below is just for readability):
//
//   CRITICAL
//     1. Overdue amount > 0           → "Rs X across N students"
//     2. Today's attendance < 60%     → "Today's attendance is X%"
//     3. Monthly collection dropped >25% vs previous month
//
//   WARNING
//     4. Today's attendance 60–74%    → "Today's attendance is X%"
//     5. Attendance not yet marked   → "Marked for X / Y students"
//     6. ≥3 of last 7 days < 75%     → recurring low-attendance pattern
//
//   INFO
//     7. Refunds today > 0           → "N refunds today" (visibility)
//     8. Students with dues          → standing total (suppressed when
//                                       overdue alert is already up to
//                                       avoid duplicating the financial
//                                       message)
//
// What's NOT here (deferred to Phase 2.2 / 4):
//   • "Pending exam grading" — needs an endpoint we don't have
//   • "Suspicious activity" — needs the audit-log table (Phase 4)
//   • "Sync queue backlog" — device-local; surfaces on the Cashier
//     workspace already
// ---------------------------------------------------------------------------

function deriveKeyAlerts(input: {
  summary: DashboardSummary | null;
  fees: FeesSummary | null;
  attendance: AttendanceTrend | null;
}): KeyAlert[] {
  const alerts: KeyAlert[] = [];
  const { summary, fees, attendance } = input;

  // 1 — Overdue (CRITICAL). Surfaces both the rupee total and the
  // headcount so the principal knows scale + reach in one read.
  if (fees && fees.totalOverdue > 0) {
    alerts.push({
      id: "overdue-amount",
      severity: "critical",
      title: `${formatCurrency(fees.totalOverdue)} overdue${
        fees.studentsWithDues > 0
          ? ` across ${fees.studentsWithDues} student${fees.studentsWithDues === 1 ? "" : "s"}`
          : ""
      }`,
      description: "Past their due date — chase the parents this week.",
      href: "/fees",
      ctaLabel: "View dues",
    });
  }

  // 2 — Today's attendance. Tier on percentage. Skip when nothing's
  // marked yet (handled by alert 5) so we don't double-flag the same
  // morning.
  if (summary && summary.stats.attendanceMarkedToday > 0) {
    const att = summary.stats.attendanceTodayPct;
    if (att < 60) {
      alerts.push({
        id: "attendance-today-critical",
        severity: "critical",
        title: `Today's attendance is ${att.toFixed(1)}%`,
        description: `Only ${summary.stats.attendanceMarkedToday} of ${summary.stats.attendanceTotalToday} students present.`,
        href: "/attendance",
        ctaLabel: "Open attendance",
      });
    } else if (att < 75) {
      alerts.push({
        id: "attendance-today-warning",
        severity: "warning",
        title: `Today's attendance is ${att.toFixed(1)}%`,
        description: "Below the 75% comfort line — worth checking why.",
        href: "/attendance",
        ctaLabel: "Open attendance",
      });
    }
  }

  // 3 — Monthly collection drop. Compare last fully-recorded month to
  // the one before it. We exclude the CURRENT month from the
  // comparison because mid-month figures are misleading vs. a
  // completed month — the partial month would always look "down".
  if (fees && fees.monthlyTrend.length >= 3) {
    const len = fees.monthlyTrend.length;
    // [-1] is current month (in-progress), [-2] is the most-recent
    // completed month, [-3] is the month before that.
    const completed = fees.monthlyTrend[len - 2];
    const prior = fees.monthlyTrend[len - 3];
    if (prior.collected > 0 && completed.collected > 0) {
      const drop = (prior.collected - completed.collected) / prior.collected;
      if (drop > 0.25) {
        alerts.push({
          id: "collection-drop",
          severity: "critical",
          title: `Collection dropped ${(drop * 100).toFixed(0)}% last month`,
          description: `${formatCurrency(completed.collected)} vs ${formatCurrency(prior.collected)} the month before.`,
          href: "/fees/payments",
          ctaLabel: "View payments",
        });
      }
    }
  }

  // 5 — Attendance not yet marked. Threshold at 50% to avoid early-
  // morning false positives (8am, two sections marked, the rest still
  // arriving). At < 50% marked we genuinely haven't started the day.
  if (
    summary &&
    summary.stats.attendanceTotalToday > 0 &&
    summary.stats.attendanceMarkedToday <
      summary.stats.attendanceTotalToday * 0.5
  ) {
    const remaining =
      summary.stats.attendanceTotalToday - summary.stats.attendanceMarkedToday;
    alerts.push({
      id: "attendance-not-marked",
      severity: "warning",
      title: `Attendance not marked for ${remaining} student${remaining === 1 ? "" : "s"}`,
      description: `${summary.stats.attendanceMarkedToday} of ${summary.stats.attendanceTotalToday} marked so far today.`,
      href: "/attendance",
      ctaLabel: "Mark attendance",
    });
  }

  // 6 — Recurring low-attendance pattern over the trailing 7 days.
  // Three or more low days within a week is more concerning than a
  // single low day; a separate alert flags this so the principal
  // sees the pattern, not just today's number.
  if (attendance && attendance.daily.length > 0) {
    const last7 = attendance.daily.slice(-7);
    const lowDays = last7.filter(
      (d) => d.percentage !== null && d.percentage < 75,
    );
    if (lowDays.length >= 3) {
      alerts.push({
        id: "attendance-pattern",
        severity: "warning",
        title: `${lowDays.length} of the last 7 days were below 75%`,
        description: "Recurring low attendance — investigate the cause.",
        href: "/attendance/insights",
        ctaLabel: "See trend",
      });
    }
  }

  // 7 — Students with dues (INFO). Suppressed when an overdue alert
  // is already in the list — that one carries the more urgent version
  // of the same financial story.
  if (
    fees &&
    fees.studentsWithDues > 0 &&
    fees.totalOverdue === 0
  ) {
    alerts.push({
      id: "students-with-dues",
      severity: "info",
      title: `${fees.studentsWithDues} student${fees.studentsWithDues === 1 ? "" : "s"} with outstanding dues`,
      description: `Total pending: ${formatCurrency(fees.totalPending)}.`,
      href: "/fees",
      ctaLabel: "View dues",
    });
  }

  return alerts;
}

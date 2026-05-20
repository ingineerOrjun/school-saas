"use client";

import * as React from "react";
import {
  CalendarCheck,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Users,
  Download,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  attendanceApi,
  type AttendanceTrend,
} from "@/lib/attendance";
import { useClasses } from "@/lib/classes";
import { downloadCsv, csvFilenameStamp } from "@/lib/csv";
import { AttendanceTrendChart } from "@/components/charts/AttendanceTrendChart";
import { LowAttendanceBar } from "@/components/charts/LowAttendanceBar";
import { KpiCard, KpiCardSkeleton } from "@/components/analytics/KpiCard";
import type { AnalyticsFilters } from "../page";

// ---------------------------------------------------------------------------
// Attendance tab — multi-scope attendance analytics.
//
// Composition:
//   • KPI grid (4 tiles): avg attendance %, present-days, absent-days,
//     student-days marked
//   • Trend chart (existing AttendanceTrendChart) — school-wide line
//   • Class-comparison bars — average attendance % per class, sorted
//     ascending (the LOW classes need the principal's attention)
//   • Low-attendance leaderboard — students under 75%, ranked
//
// Data flow: school-wide trend powers the headline KPIs + chart in one
// fetch. Class breakdown fans out per-class trend fetches in parallel
// (each class's totals are summarized into a single bar). Low-
// attendance comes from the reports endpoint, but the existing
// /attendance/insights page already does deep per-class work — this
// tab focuses on a school-wide single-screen read.
// ---------------------------------------------------------------------------

interface ClassAverageRow {
  classId: string;
  className: string;
  percentage: number | null;
  totalDays: number;
}

export function AttendanceTab({ filters }: { filters: AnalyticsFilters }) {
  const [trend, setTrend] = React.useState<AttendanceTrend | null>(null);
  const [classRows, setClassRows] = React.useState<ClassAverageRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Classes via the shared React Query hook (10m staleTime). Was an
  // inline classesApi.list() inside the effect below; switching to
  // the cached hook closes the /classes dupe flagged by the
  // request-pressure panel. The effect now depends on the hook's
  // data so it re-runs when the classes list arrives (and again
  // on any filter change).
  const classesQuery = useClasses();
  const classesData = classesQuery.data;

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // School-wide trend first — drives the headline KPIs + chart.
        // School-wide trend honors classId/sectionId when set — picking
        // a class in the global filter bar narrows BOTH the headline
        // chart and the per-class comparison below (which already
        // applies its own per-class filter, so when a single class is
        // selected globally the comparison reduces to one row, which
        // is fine).
        const schoolTrend = await attendanceApi.getTrend({
          fromDate: filters.fromDate,
          toDate: filters.toDate,
          ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
          ...(filters.classId && !filters.sectionId
            ? { classId: filters.classId }
            : {}),
        });
        if (cancelled) return;
        setTrend(schoolTrend);

        // Then fan out per-class. Reads from the cached classes list
        // populated by `useClasses()` above. While the hook is still
        // loading (`classesData === undefined`), we skip the
        // per-class fan-out and leave `classRows` empty; the effect
        // re-runs when classes arrive and populates it. This matches
        // the previous "await classesApi.list(); then map" sequence
        // — the wait now happens at the effect level rather than
        // inline.
        const classes = classesData ?? [];
        if (cancelled) return;

        const perClass = await Promise.all(
          classes.map((c) =>
            attendanceApi
              .getTrend({
                fromDate: filters.fromDate,
                toDate: filters.toDate,
                classId: c.id,
              })
              .then((t) => ({
                classId: c.id,
                className: c.name,
                percentage: t.totals.percentage,
                totalDays: t.totals.totalDays,
              }))
              // Soft-fail per-class — one missing class shouldn't blank
              // the whole comparison view.
              .catch(() => ({
                classId: c.id,
                className: c.name,
                percentage: null,
                totalDays: 0,
              })),
          ),
        );
        if (cancelled) return;
        setClassRows(perClass);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load attendance analytics.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    filters.fromDate,
    filters.toDate,
    filters.classId,
    filters.sectionId,
    // Re-run when the cached classes list lands (or when the cache
    // invalidates) so the per-class fan-out gets the fresh list.
    classesData,
  ]);

  // Bridge classesQuery.error into the existing error banner — the
  // previous inline classesApi.list() funneled its failure into
  // `setError` via the surrounding try/catch; preserve that surface.
  React.useEffect(() => {
    if (classesQuery.error) {
      setError((prev) =>
        prev ??
        (classesQuery.error instanceof ApiError
          ? classesQuery.error.message
          : "Failed to load classes."),
      );
    }
  }, [classesQuery.error]);

  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="space-y-6">
      <KpiGrid trend={trend} loading={loading} />

      <Card title="School-wide trend" subtitle={dateSubtitle(trend)}>
        {loading || !trend ? (
          <div className="h-[220px] animate-pulse rounded bg-muted/50" />
        ) : (
          <AttendanceTrendChart data={trend.daily} height={220} />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Class comparison"
          subtitle="Lowest first — these need attention"
          toolbar={
            classRows.length > 0 ? (
              <ExportButton
                label="Export"
                onClick={() =>
                  exportClassComparisonCsv(classRows, filters)
                }
              />
            ) : undefined
          }
        >
          {loading ? (
            <Loader />
          ) : (
            <ClassComparison rows={classRows} />
          )}
        </Card>
        <Card title="Headline numbers" subtitle="Across the selected window">
          {loading || !trend ? (
            <Loader />
          ) : (
            <HeadlineSummary trend={trend} />
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI grid — 4 tiles. Tone the average tile by performance band.
// ---------------------------------------------------------------------------

function KpiGrid({
  trend,
  loading,
}: {
  trend: AttendanceTrend | null;
  loading: boolean;
}) {
  if (loading || !trend) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  const pct = trend.totals.percentage;
  const tone =
    pct === null
      ? "muted"
      : pct >= 90
        ? "success"
        : pct >= 75
          ? "primary"
          : "destructive";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        label="Avg attendance"
        value={pct === null ? "—" : `${pct.toFixed(1)}%`}
        icon={<CalendarCheck className="h-4 w-4" />}
        tone={tone}
        hint={pct === null ? "No data in this window" : "Across the window"}
      />
      <KpiCard
        label="Present-days"
        value={trend.totals.presentDays.toLocaleString("en-IN")}
        icon={<TrendingUp className="h-4 w-4" />}
        tone="muted"
      />
      <KpiCard
        label="Absent-days"
        value={trend.totals.absentDays.toLocaleString("en-IN")}
        icon={<TrendingDown className="h-4 w-4" />}
        tone={trend.totals.absentDays > 0 ? "destructive" : "muted"}
      />
      <KpiCard
        label="Student-days marked"
        value={trend.totals.totalDays.toLocaleString("en-IN")}
        icon={<Users className="h-4 w-4" />}
        tone="muted"
        hint="Sum across the window"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Class comparison — uses the existing LowAttendanceBar primitive.
//
// LowAttendanceBar expects `items` shaped like { studentId, name,
// percentage, symbolNumber }. We adapt our class-level rows to match
// (classId → studentId, className → name, no symbolNumber) so the bar
// component renders without modification. The threshold marker is the
// 75% line we use elsewhere; classes below it are highlighted red.
// ---------------------------------------------------------------------------

function ClassComparison({ rows }: { rows: ClassAverageRow[] }) {
  const items = rows
    // Drop classes with no data — they'd render as 0% and look like
    // a problem when really nobody's marked attendance there.
    .filter((r) => r.percentage !== null && r.totalDays > 0)
    .map((r) => ({
      studentId: r.classId,
      name: r.className,
      percentage: r.percentage as number,
      symbolNumber: null,
    }));

  if (items.length === 0) {
    return <EmptyHint>No class-level attendance in this window.</EmptyHint>;
  }

  return <LowAttendanceBar items={items} threshold={75} />;
}

// ---------------------------------------------------------------------------
// Headline summary card — accompanies the school-wide trend chart with
// the same numbers in tabular form. Useful as a quick "what's the avg
// for the period?" answer when the chart shows a noisy series.
// ---------------------------------------------------------------------------

function HeadlineSummary({ trend }: { trend: AttendanceTrend }) {
  const dailyWithMarks = trend.daily.filter((d) => d.percentage !== null);
  const best = dailyWithMarks.reduce<{ date: string; pct: number } | null>(
    (acc, d) =>
      d.percentage !== null && (acc === null || d.percentage > acc.pct)
        ? { date: d.date, pct: d.percentage }
        : acc,
    null,
  );
  const worst = dailyWithMarks.reduce<{ date: string; pct: number } | null>(
    (acc, d) =>
      d.percentage !== null && (acc === null || d.percentage < acc.pct)
        ? { date: d.date, pct: d.percentage }
        : acc,
    null,
  );

  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      <Stat label="Best day">
        {best ? (
          <>
            {best.pct.toFixed(1)}%{" "}
            <span className="text-[10px] text-muted-foreground">
              · {best.date}
            </span>
          </>
        ) : (
          "—"
        )}
      </Stat>
      <Stat label="Worst day">
        {worst ? (
          <>
            {worst.pct.toFixed(1)}%{" "}
            <span className="text-[10px] text-muted-foreground">
              · {worst.date}
            </span>
          </>
        ) : (
          "—"
        )}
      </Stat>
      <Stat label="Days with marks">{dailyWithMarks.length}</Stat>
      <Stat label="Total days in window">{trend.daily.length}</Stat>
    </dl>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
        {children}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Card({
  title,
  subtitle,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Inline action (typically an Export button) right of the title. */
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
        {toolbar}
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
// CSV builder for the Attendance tab. Exports the class-comparison
// rows that drive the "lowest first" bar chart, with the date range
// embedded in the filename so a finance officer can keep multiple
// snapshots without renaming.
// ---------------------------------------------------------------------------

function exportClassComparisonCsv(
  rows: ClassAverageRow[],
  filters: AnalyticsFilters,
) {
  // Sort ascending by percentage (matches the chart). Classes with no
  // data go last — the percentage is null so they'd otherwise sort
  // weirdly under a numeric comparator.
  const sorted = [...rows].sort((a, b) => {
    if (a.percentage === null && b.percentage === null) return 0;
    if (a.percentage === null) return 1;
    if (b.percentage === null) return -1;
    return a.percentage - b.percentage;
  });
  const csvRows = sorted.map((r) => [
    r.className,
    // Empty string for "no data" rather than 0 — preserves the
    // "we didn't measure this" semantics in the export.
    r.percentage === null ? "" : r.percentage.toFixed(2),
    r.totalDays,
  ]);
  downloadCsv({
    filename: `class-attendance-${filters.fromDate}-to-${filters.toDate}.csv`,
    header: ["Class", "Avg %", "Student-days marked"],
    rows: csvRows,
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

function dateSubtitle(t: AttendanceTrend | null): string {
  if (!t) return "";
  return `${t.fromDate} → ${t.toDate}`;
}

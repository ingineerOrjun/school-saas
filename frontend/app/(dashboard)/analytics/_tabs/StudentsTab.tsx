"use client";

import * as React from "react";
import {
  Users,
  UserPlus,
  AlertTriangle,
  School,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import {
  studentsApi,
  type StudentAnalytics,
} from "@/lib/students";
import { Sparkline } from "@/components/charts/Sparkline";
import { KpiCard, KpiCardSkeleton } from "@/components/analytics/KpiCard";
import type { AnalyticsFilters } from "../page";

// ---------------------------------------------------------------------------
// Student analytics tab.
//
// Composition:
//   • KPI grid (4 tiles): total · admissions this month · admissions
//     last 12 months · classes with students
//   • Gender split card (compact horizontal bar with chip legend)
//   • Class strength table (per-class counts, sorted A→Z)
//   • Admissions trend (Sparkline + bar grid, last 12 months)
//
// Data: a single /students/analytics call covers everything. The date
// filter from the page shell is informational — the analytics shape
// is "as of now", and the admissions-trend window is fixed at 12
// months because the backend rollup is computed against that window.
// ---------------------------------------------------------------------------

export function StudentsTab({ filters }: { filters: AnalyticsFilters }) {
  void filters;
  const [data, setData] = React.useState<StudentAnalytics | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    studentsApi
      .getAnalytics()
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load student analytics.",
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
      <KpiGrid data={data} loading={loading} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Gender split">
          {loading || !data ? (
            <Loader />
          ) : (
            <GenderSplit split={data.genderSplit} total={data.total} />
          )}
        </Card>
        <Card title="Admissions · last 12 months">
          {loading || !data ? (
            <Loader />
          ) : (
            <AdmissionsTrend trend={data.admissionsTrend} />
          )}
        </Card>
      </div>

      <Card title="Class strength" subtitle="Students per class">
        {loading || !data ? (
          <Loader />
        ) : (
          <ClassStrengthTable rows={data.classStrength} total={data.total} />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiGrid({
  data,
  loading,
}: {
  data: StudentAnalytics | null;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  // Most-recent month is the last entry in the (oldest-first) trend.
  const thisMonth =
    data.admissionsTrend[data.admissionsTrend.length - 1]?.count ?? 0;
  const lastYear = data.admissionsTrend.reduce((s, m) => s + m.count, 0);
  const classesWithStudents = data.classStrength.filter(
    (c) => c.classId !== null,
  ).length;
  const unassigned =
    data.classStrength.find((c) => c.classId === null)?.count ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        label="Total students"
        value={data.total.toLocaleString("en-IN")}
        icon={<Users className="h-4 w-4" />}
        tone="muted"
        href="/students"
      />
      <KpiCard
        label="Admissions this month"
        value={thisMonth.toLocaleString("en-IN")}
        icon={<UserPlus className="h-4 w-4" />}
        tone={thisMonth > 0 ? "primary" : "muted"}
      />
      <KpiCard
        label="Admissions · 12 months"
        value={lastYear.toLocaleString("en-IN")}
        icon={<UserPlus className="h-4 w-4" />}
        tone="muted"
      />
      <KpiCard
        label="Classes with students"
        value={classesWithStudents.toLocaleString("en-IN")}
        icon={<School className="h-4 w-4" />}
        tone={unassigned > 0 ? "destructive" : "muted"}
        hint={
          unassigned > 0
            ? `${unassigned} unassigned`
            : "Every student is placed"
        }
        href="/classes"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gender split — proportional bar + chip legend. We don't render a pie
// chart because pie charts are hard to compare visually; a stacked
// bar makes "is the school 60/40 or 50/50?" answerable at a glance.
// ---------------------------------------------------------------------------

function GenderSplit({
  split,
  total,
}: {
  split: StudentAnalytics["genderSplit"];
  total: number;
}) {
  if (total === 0) {
    return <EmptyHint>No students enrolled yet.</EmptyHint>;
  }
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        {split.map((g) => {
          const pct = total > 0 ? (g.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={g.gender}
              className={cn("h-full", genderBarColor(g.gender))}
              style={{ width: `${pct}%` }}
              title={`${genderLabel(g.gender)}: ${g.count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {split.map((g) => {
          const pct = total > 0 ? (g.count / total) * 100 : 0;
          return (
            <li
              key={g.gender}
              className="flex flex-col rounded-md border border-border bg-surface p-2"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    genderBarColor(g.gender),
                  )}
                  aria-hidden
                />
                <span className="font-medium text-foreground">
                  {genderLabel(g.gender)}
                </span>
              </span>
              <span className="mt-1 tabular-nums text-foreground font-semibold">
                {g.count.toLocaleString("en-IN")}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {pct.toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function genderLabel(g: StudentAnalytics["genderSplit"][number]["gender"]): string {
  switch (g) {
    case "MALE":
      return "Male";
    case "FEMALE":
      return "Female";
    case "OTHER":
      return "Other";
  }
}

function genderBarColor(
  g: StudentAnalytics["genderSplit"][number]["gender"],
): string {
  // Sky / rose / slate — distinguishable, calm, none scream for
  // attention. Same palette in print: sky on white reads OK as light
  // gray, rose as medium gray, slate as dark gray.
  switch (g) {
    case "MALE":
      return "bg-sky-500";
    case "FEMALE":
      return "bg-rose-500";
    case "OTHER":
      return "bg-slate-500";
  }
}

// ---------------------------------------------------------------------------
// Admissions trend — Sparkline + 12 bars + month total. Mirrors the
// shape of the Overview tab's monthly-collection trend so the two
// visualisations read as siblings of the same school operation.
// ---------------------------------------------------------------------------

function AdmissionsTrend({
  trend,
}: {
  trend: StudentAnalytics["admissionsTrend"];
}) {
  if (trend.length === 0) {
    return <EmptyHint>No admissions data yet.</EmptyHint>;
  }
  const total = trend.reduce((s, m) => s + m.count, 0);
  if (total === 0) {
    return <EmptyHint>No admissions in the last 12 months.</EmptyHint>;
  }
  const max = Math.max(...trend.map((m) => m.count), 1);
  const avg = total / trend.length;
  return (
    <div>
      <Sparkline
        values={trend.map((m) => m.count)}
        height={64}
        filled
        strokeClassName="text-sky-600"
      />
      <div className="mt-3 grid grid-cols-6 gap-1 sm:grid-cols-12">
        {trend.map((m) => {
          const heightPct = max > 0 ? (m.count / max) * 100 : 0;
          const ym = m.month.slice(5);
          return (
            <div
              key={m.month}
              className="flex flex-col items-center gap-1"
              title={`${m.month}: ${m.count} admission${m.count === 1 ? "" : "s"}`}
            >
              <div className="flex h-12 w-full items-end">
                <div
                  className="w-full rounded-sm bg-sky-500/40"
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
            {avg.toFixed(1)}
          </span>{" "}
          / month
        </span>
        <span>
          12-month total{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {total.toLocaleString("en-IN")}
          </span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ClassStrengthTable({
  rows,
  total,
}: {
  rows: StudentAnalytics["classStrength"];
  total: number;
}) {
  if (rows.length === 0) {
    return <EmptyHint>No classes have students yet.</EmptyHint>;
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Class</th>
            <th className="px-3 py-2">Share</th>
            <th className="px-3 py-2 text-right">Students</th>
            <th className="px-3 py-2 text-right">% of total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const sharePct = total > 0 ? (r.count / total) * 100 : 0;
            const widthPct = max > 0 ? (r.count / max) * 100 : 0;
            const isUnassigned = r.classId === null;
            return (
              <tr
                key={r.classId ?? "__unassigned__"}
                className={cn(
                  isUnassigned && "bg-destructive/[0.03] italic",
                )}
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {r.className}
                </td>
                <td className="px-3 py-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full",
                        isUnassigned ? "bg-destructive" : "bg-sky-500",
                      )}
                      style={{ width: `${Math.max(widthPct, 2)}%` }}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                  {r.count.toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {sharePct.toFixed(1)}%
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

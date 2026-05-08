"use client";

import * as React from "react";
import Link from "next/link";
import {
  GraduationCap,
  Users,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import {
  examsApi,
  type ExamAnalytics,
  type ExamDto,
} from "@/lib/exams";
import type { LetterGrade } from "@/lib/grading";
import { KpiCard, KpiCardSkeleton } from "@/components/analytics/KpiCard";
import type { AnalyticsFilters } from "../page";
import { useAnalyticsFilters } from "../_filters";

// ---------------------------------------------------------------------------
// Exam analytics tab — dive into a single exam's results.
//
// The user picks an exam from a dropdown (we list every exam in the
// school, newest first, capped to 50). The selection drives a
// `getAnalytics` fetch which returns enough to render the whole tab
// in one round-trip.
//
// Why a picker rather than a "latest exam" auto-pick: schools with
// session-based exams often want to compare past papers, and the
// dropdown is the simplest UX that supports that without committing
// to a "compare two exams" feature in v1.
//
// What this tab DOESN'T do (yet, deferred):
//   • Cross-exam comparison (overlay two exams' grade distributions)
//   • Subject-difficulty index (would need a "harder" subject signal —
//     class-cohort relative pass-rate is a starter; not in scope here)
//   • Per-class breakdown within an exam (would need class roster join)
// ---------------------------------------------------------------------------

export function ExamsTab({ filters }: { filters: AnalyticsFilters }) {
  // Exam selection lives in the URL via `?examId=` so picking an exam
  // generates a shareable deep-link to its analytics. We read the
  // value from props (which the shell threads from the same hook) and
  // call the hook directly to get the setter — no prop drilling.
  const { setFilters } = useAnalyticsFilters();
  const selectedExamId = filters.examId;

  const [exams, setExams] = React.useState<ExamDto[] | null>(null);
  const [examsError, setExamsError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<ExamAnalytics | null>(null);
  const [loadingData, setLoadingData] = React.useState(false);
  const [dataError, setDataError] = React.useState<string | null>(null);

  // Load the exam list once. If the URL has no `examId`, auto-select
  // the most recent exam — that's the most useful default for a fresh
  // visit. We write the choice back to the URL so the user sees a
  // canonical link they can share.
  React.useEffect(() => {
    let cancelled = false;
    examsApi
      .list()
      .then((rows) => {
        if (cancelled) return;
        setExams(rows);
        if (rows.length > 0 && !selectedExamId) {
          setFilters({ examId: rows[0].id });
        } else if (rows.length === 0 && selectedExamId) {
          // The URL has a stale exam id (or one from another school).
          // Drop it so we don't loop on a 404 fetch below.
          setFilters({ examId: "" });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setExamsError(
          err instanceof ApiError ? err.message : "Failed to load exams.",
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch analytics whenever the URL's examId changes.
  React.useEffect(() => {
    if (!selectedExamId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoadingData(true);
    setDataError(null);
    examsApi
      .getAnalytics(selectedExamId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setDataError(
          err instanceof ApiError ? err.message : "Failed to load analytics.",
        );
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedExamId]);

  if (examsError) return <ErrorBanner message={examsError} />;

  return (
    <div className="space-y-6">
      <ExamPicker
        exams={exams}
        value={selectedExamId}
        onChange={(id) => setFilters({ examId: id })}
      />

      {!exams ? (
        <Loader />
      ) : exams.length === 0 ? (
        <EmptyHint>
          No exams have been created yet.{" "}
          <Link
            href="/exams/create"
            className="font-medium text-primary hover:underline"
          >
            Create one
          </Link>{" "}
          to see analytics.
        </EmptyHint>
      ) : dataError ? (
        <ErrorBanner message={dataError} />
      ) : (
        <>
          <KpiGrid data={data} loading={loadingData} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Grade distribution" subtitle="Across all subject results">
              {loadingData || !data ? (
                <Loader />
              ) : (
                <GradeHistogram distribution={data.gradeDistribution} />
              )}
            </Card>
            <Card title="Top performers" subtitle="Highest aggregate average">
              {loadingData || !data ? (
                <Loader />
              ) : (
                <TopPerformers
                  performers={data.topPerformers}
                  examId={data.exam.id}
                />
              )}
            </Card>
          </div>
          <Card
            title="Per-subject performance"
            subtitle="Average % and pass rate · subject toppers"
          >
            {loadingData || !data ? (
              <Loader />
            ) : (
              <SubjectsTable subjects={data.subjects} examId={data.exam.id} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExamPicker({
  exams,
  value,
  onChange,
}: {
  exams: ExamDto[] | null;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Exam</h3>
          <p className="text-[11px] text-muted-foreground">
            Pick an exam to see results, grade distribution, and toppers.
          </p>
        </div>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!exams || exams.length === 0}
          className="h-10 min-w-[260px] rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
        >
          {!exams && <option>Loading…</option>}
          {exams && exams.length === 0 && <option>No exams yet</option>}
          {exams &&
            exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiGrid({
  data,
  loading,
}: {
  data: ExamAnalytics | null;
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
  const { passed, failed } = data.studentOutcomes;
  const totalGraded = passed + failed;
  const passRate = totalGraded > 0 ? (passed / totalGraded) * 100 : 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        label="Students graded"
        value={data.studentCount.toLocaleString("en-IN")}
        icon={<Users className="h-4 w-4" />}
        tone="muted"
        hint={`Across ${data.exam.subjectCount} subject${data.exam.subjectCount === 1 ? "" : "s"}`}
      />
      <KpiCard
        label="Passed"
        value={passed.toLocaleString("en-IN")}
        icon={<TrendingUp className="h-4 w-4" />}
        tone={passed > 0 ? "success" : "muted"}
        hint={
          totalGraded > 0
            ? `${passRate.toFixed(1)}% of graded`
            : "Nobody graded yet"
        }
      />
      <KpiCard
        label="Failed"
        value={failed.toLocaleString("en-IN")}
        icon={<AlertTriangle className="h-4 w-4" />}
        tone={failed > 0 ? "destructive" : "muted"}
        hint={
          totalGraded > 0
            ? `${(100 - passRate).toFixed(1)}% of graded`
            : "—"
        }
      />
      <KpiCard
        label="Subjects"
        value={data.exam.subjectCount.toLocaleString("en-IN")}
        icon={<GraduationCap className="h-4 w-4" />}
        tone="muted"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grade histogram — bar chart of letter-grade counts.
//
// We render directly as div widths instead of SVG because:
//   • The data is fixed-shape (8 grades, ordered) — no need for a
//     general-purpose chart abstraction.
//   • Tailwind's percentage widths flex to whatever container is
//     available, no resize observer needed.
//   • Bars stay readable when printed in grayscale (the height carries
//     the meaning, color is just decoration).
// ---------------------------------------------------------------------------

function GradeHistogram({
  distribution,
}: {
  distribution: ExamAnalytics["gradeDistribution"];
}) {
  const total = distribution.reduce((s, g) => s + g.count, 0);
  if (total === 0) {
    return (
      <EmptyHint>No results recorded for this exam yet.</EmptyHint>
    );
  }
  const max = Math.max(...distribution.map((g) => g.count), 1);

  return (
    <ul className="space-y-2">
      {distribution.map((g) => {
        const pct = max > 0 ? (g.count / max) * 100 : 0;
        const sharePct = total > 0 ? (g.count / total) * 100 : 0;
        return (
          <li
            key={g.grade}
            className="grid grid-cols-[60px_1fr_70px] items-center gap-3"
          >
            <span
              className={cn(
                "inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[11px] font-bold",
                gradeChipClass(g.grade),
              )}
            >
              {gradeLabel(g.grade)}
            </span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full", gradeBarColor(g.grade))}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
            <span className="text-right text-xs tabular-nums text-foreground">
              {g.count}{" "}
              <span className="text-muted-foreground">
                · {sharePct.toFixed(0)}%
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function TopPerformers({
  performers,
  examId,
}: {
  performers: ExamAnalytics["topPerformers"];
  examId: string;
}) {
  if (performers.length === 0) {
    return <EmptyHint>No graded students yet.</EmptyHint>;
  }
  return (
    <ul className="space-y-2">
      {performers.map((p, idx) => (
        <li
          key={p.studentId}
          className="flex items-center gap-3 rounded-md border border-border bg-surface p-2"
        >
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold",
              idx === 0
                ? "bg-amber-500/15 text-amber-700"
                : idx === 1
                  ? "bg-slate-400/20 text-slate-700"
                  : idx === 2
                    ? "bg-orange-500/15 text-orange-700"
                    : "bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            {idx === 0 ? <Trophy className="h-3.5 w-3.5" /> : `#${idx + 1}`}
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={`/marksheet/${examId}/${p.studentId}`}
              target="_blank"
              className="block font-medium text-foreground hover:text-primary hover:underline truncate"
            >
              {p.firstName} {p.lastName}
            </Link>
            <div className="text-[10px] text-muted-foreground font-mono">
              {p.symbolNumber ?? "—"} ·{" "}
              <span className="font-sans">
                {p.subjectsTaken} subject
                {p.subjectsTaken === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <span className="tabular-nums font-semibold text-foreground">
            {p.averagePercentage.toFixed(2)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function SubjectsTable({
  subjects,
  examId,
}: {
  subjects: ExamAnalytics["subjects"];
  examId: string;
}) {
  if (subjects.length === 0) {
    return <EmptyHint>This exam has no subjects yet.</EmptyHint>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Subject</th>
            <th className="px-3 py-2 text-right">Avg %</th>
            <th className="px-3 py-2 text-right">Pass rate</th>
            <th className="px-3 py-2 text-right">Results</th>
            <th className="px-3 py-2 text-left">Topper</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {subjects.map((s) => {
            const passPct = s.passRate * 100;
            const lowPass = passPct > 0 && passPct < 60;
            return (
              <tr
                key={s.subjectId}
                className={cn(lowPass && "bg-destructive/[0.03]")}
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {s.name}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {s.resultsCount > 0 ? (
                    <span
                      className={cn(
                        s.averagePercentage < 50
                          ? "text-destructive font-semibold"
                          : "text-foreground",
                      )}
                    >
                      {s.averagePercentage.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {s.resultsCount > 0 ? (
                    <span className={cn(lowPass && "text-destructive font-semibold")}>
                      {passPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {s.resultsCount}
                </td>
                <td className="px-3 py-2">
                  {s.topper ? (
                    <Link
                      href={`/marksheet/${examId}/${s.topper.studentId}`}
                      target="_blank"
                      className="inline-flex items-center gap-1 text-xs text-foreground hover:text-primary hover:underline"
                    >
                      {s.topper.firstName} {s.topper.lastName}
                      <span className="ml-1 rounded bg-muted px-1 py-px text-[10px] font-mono text-muted-foreground">
                        {s.topper.percentage.toFixed(1)}%
                      </span>
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </Link>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
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
// Letter grade styling — kept colocated so the chip + the bar stay
// in sync. NEB-ish convention: A+ is brightest emerald, NG is red.
// ---------------------------------------------------------------------------

function gradeLabel(g: LetterGrade): string {
  return g === "A_PLUS"
    ? "A+"
    : g === "B_PLUS"
      ? "B+"
      : g === "C_PLUS"
        ? "C+"
        : g;
}

function gradeChipClass(g: LetterGrade): string {
  switch (g) {
    case "A_PLUS":
      return "bg-emerald-500/15 text-emerald-700";
    case "A":
      return "bg-emerald-500/10 text-emerald-700";
    case "B_PLUS":
      return "bg-sky-500/15 text-sky-700";
    case "B":
      return "bg-sky-500/10 text-sky-700";
    case "C_PLUS":
      return "bg-amber-500/15 text-amber-700";
    case "C":
      return "bg-amber-500/10 text-amber-700";
    case "D":
      return "bg-orange-500/15 text-orange-700";
    case "NG":
      return "bg-destructive/15 text-destructive";
  }
}

function gradeBarColor(g: LetterGrade): string {
  switch (g) {
    case "A_PLUS":
    case "A":
      return "bg-emerald-500";
    case "B_PLUS":
    case "B":
      return "bg-sky-500";
    case "C_PLUS":
    case "C":
      return "bg-amber-500";
    case "D":
      return "bg-orange-500";
    case "NG":
      return "bg-destructive";
  }
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

"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Printer,
  Download,
  ArrowLeft,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { marksheetApi, type Marksheet } from "@/lib/exams";
import { gpaToLetterGrade } from "@/lib/grading";
import { DocumentLogo } from "@/components/documents/DocumentLogo";
import { formatDual } from "@/lib/date";

export default function MarksheetPage() {
  const params = useParams<{ examId: string; studentId: string }>();
  const router = useRouter();
  const [data, setData] = React.useState<Marksheet | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!params?.examId || !params?.studentId) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await marksheetApi.get(params.examId, params.studentId);
        if (!cancelled) setData(m);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load marksheet.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.examId, params?.studentId, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Preparing marksheet…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <div className="max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 text-lg font-semibold text-foreground">
            Couldn&apos;t load marksheet
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {error ?? "Unknown error"}
          </p>
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-4 text-sm font-medium text-primary hover:underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Print-specific CSS — hides chrome, tightens the sheet */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .marksheet { box-shadow: none !important; margin: 0 !important; border: 1px solid #111 !important; }
          tr, td { page-break-inside: avoid; break-inside: avoid; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      <div className="min-h-screen bg-muted/40 py-8">
        {/* Toolbar — only on screen */}
        <div className="no-print mx-auto mb-4 flex max-w-[820px] items-center justify-between px-6">
          <Link
            href="/exams"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to exams
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              title="Opens your browser's print dialog — choose 'Save as PDF' as the destination"
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background shadow-sm hover:bg-foreground/90 active:scale-[0.98] transition-all"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground shadow-xs hover:border-primary/40 hover:text-primary active:scale-[0.98] transition-all"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>

        {/* The sheet */}
        <article className="marksheet mx-auto max-w-[820px] bg-white shadow-sm print:shadow-none border border-slate-300 text-slate-900">
          <Header data={data} />
          <Body data={data} />
          <Footer data={data} />
        </article>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Header({ data }: { data: Marksheet }) {
  // Marksheets always print with both calendars (BS primary + AD
  // parenthetical) regardless of UI preference — they're official
  // paper artifacts and Nepali parents expect to see the BS date.
  const examDate = formatDual(data.examCreatedAt);
  // Use the server-issued timestamp — that's the authoritative "issued"
  // moment, not the client's local clock at print time.
  const issuedDate = formatDual(data.generatedAt);

  return (
    <header className="border-b-2 border-slate-900 px-10 py-6">
      {/* Stabilized 3-col grid:
            [64px logo] [centered title, max 60% width] [right meta]
          `min-w-0` lets the center column shrink so line-clamp can
          actually trim the school name; `max-w-[60%]` caps the title
          so it never crowds the side columns even with a very long
          name. The logo width is fixed by the shared DocumentLogo
          component (h-16 w-16). */}
      <div className="grid grid-cols-[64px_1fr_auto] items-center gap-6">
        <DocumentLogo logoUrl={data.school.logoUrl} />

        <div className="min-w-0 mx-auto max-w-[60%] text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            Official Marksheet
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 uppercase line-clamp-2 text-balance break-words">
            {data.school.name}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">Grade Ledger</p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Issued
          </p>
          <p className="mt-0.5 font-mono text-sm text-slate-900">
            {issuedDate}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 text-left sm:grid-cols-4">
        <InfoField label="Student">
          {data.studentFirstName} {data.studentLastName}
        </InfoField>
        <InfoField label="Symbol No.">
          {data.studentSymbolNumber ? (
            <span className="rounded border border-slate-400 bg-slate-50 px-2 py-0.5 font-mono text-sm tracking-wider text-slate-900">
              {data.studentSymbolNumber}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </InfoField>
        <InfoField label="Class / Section">
          {data.studentSection
            ? `${data.studentSection.className} · ${data.studentSection.name}`
            : "—"}
        </InfoField>
        <InfoField label="Exam">
          <span className="block">{data.examName}</span>
          <span className="mt-0.5 block text-[11px] text-slate-500">
            {examDate}
          </span>
        </InfoField>
      </div>
    </header>
  );
}

function InfoField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-medium text-slate-900">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Body({ data }: { data: Marksheet }) {
  return (
    <section className="px-10 py-6">
      <table className="w-full border-collapse text-sm">
        <thead>
          {/* Numeric columns right-align so figures column up neatly
              under the digits — standard for any marks/grade ledger.
              "Credit Hrs" sits right after Subject so it reads as the
              subject's weight before the marks numbers begin. */}
          <tr className="border-y-2 border-slate-900">
            <Th align="left">Subject</Th>
            <Th align="right">Credit Hrs</Th>
            <Th align="right">Full Marks</Th>
            <Th align="right">Marks Obtained</Th>
            <Th align="right">Percentage</Th>
            <Th>Grade</Th>
            <Th align="right">Grade Point</Th>
          </tr>
        </thead>
        <tbody>
          {data.results.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="border-b border-slate-200 py-6 text-center text-sm italic text-slate-500"
              >
                No marks recorded for this exam.
              </td>
            </tr>
          ) : (
            data.results.map((r) => (
              <tr key={r.id} className="border-b border-slate-200">
                <Td align="left" className="font-medium">
                  {r.subjectName}
                </Td>
                {/* Credit hours — falls back to 5 (the schema default)
                    if the API response pre-dates the field. */}
                <Td align="right" className="tabular-nums text-slate-600">
                  {(r.creditHours ?? 5).toString()}
                </Td>
                <Td align="right" className="tabular-nums text-slate-600">
                  {r.fullMarks}
                </Td>
                <Td align="right" className="tabular-nums font-medium">
                  {r.marks}
                </Td>
                <Td align="right" className="tabular-nums">
                  {r.percentage.toFixed(2)}%
                </Td>
                <Td
                  className={cn(
                    "font-semibold",
                    r.letterGradeLabel === "NG" && "text-red-600",
                  )}
                >
                  {r.letterGradeLabel}
                </Td>
                <Td align="right" className="tabular-nums">
                  {r.gradePoint.toFixed(1)}
                </Td>
              </tr>
            ))
          )}
          {data.results.length > 0 && <TableSummaryRow data={data} />}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Bottom-of-table totals row. Sums the per-subject Credit Hours, Full
 * Marks, and Marks Obtained columns, shows the overall percentage, and
 * surfaces the credit-hour-weighted GPA in the Grade / Grade Point
 * columns so it reads as a natural footer for the table.
 *
 * No prior summary-row pattern existed in this component, so styling
 * uses a heavy top border + bg-slate-50 + font-semibold to set it apart
 * from data rows — consistent in spirit with the table's existing
 * use of border-y-2 on the header. (Distinct from `SummaryRow` lower
 * in the file, which is a label/value KV row used inside the Footer.)
 */
function TableSummaryRow({ data }: { data: Marksheet }) {
  const totalCreditHrs = data.results.reduce(
    (sum, r) => sum + (r.creditHours ?? 5),
    0,
  );
  const totalFullMarks = data.results.reduce((sum, r) => sum + r.fullMarks, 0);
  const totalMarks = data.results.reduce((sum, r) => sum + r.marks, 0);
  const overallPct = totalFullMarks > 0 ? (totalMarks / totalFullMarks) * 100 : 0;
  // Backend's data.gpa is the weighted GPA (the out-of-range sentinel
  // -1 when failing — 0 in the legacy response shape); we surface the
  // NG state via gpaLetterGrade. The `data.gpa < 0` defense mirrors
  // the Footer's guard so the totals row never renders "-1.00".
  const isNG = data.hasFailingSubject || data.gpa < 0;
  const gpaValue = isNG ? null : data.gpa;
  const gpaLabel =
    data.gpaLetterGrade ??
    (gpaValue !== null ? gpaToLetterGrade(gpaValue) : "NG");

  return (
    <tr className="border-t-2 border-slate-900 bg-slate-50 font-semibold">
      <Td align="left">Total</Td>
      <Td align="right" className="tabular-nums">
        {totalCreditHrs}
      </Td>
      <Td align="right" className="tabular-nums">
        {totalFullMarks}
      </Td>
      <Td align="right" className="tabular-nums">
        {totalMarks}
      </Td>
      <Td align="right" className="tabular-nums">
        {overallPct.toFixed(2)}%
      </Td>
      <Td
        className={cn(
          "font-bold tracking-wide",
          gpaLabel === "NG" && "text-red-600",
        )}
      >
        {gpaLabel}
      </Td>
      <Td align="right" className="tabular-nums">
        {gpaValue !== null ? gpaValue.toFixed(2) : "NG"}
      </Td>
    </tr>
  );
}

function Th({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-700",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "center",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 text-sm text-slate-900",
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------

function Footer({ data }: { data: Marksheet }) {
  const failing = data.hasFailingSubject;
  // Weighted GPA — backend sends -1 (out-of-range sentinel) when
  // failing; surface as null for display so we render "NG" rather
  // than a misleading "-1.00" or "0.00". The `data.gpa < 0` arm
  // also catches the legacy `0` sentinel, keeping older API
  // responses rendering correctly. The gpaLetterGrade fallback uses
  // the new CDC overall-GPA mapping when the API response pre-dates
  // that field.
  const gpa = (failing || data.gpa < 0) ? null : data.gpa;
  const gpaGrade =
    data.gpaLetterGrade ??
    (gpa !== null ? gpaToLetterGrade(gpa) : "NG");
  const remark = failing
    ? "Student has not passed all subjects."
    : gpaGrade === "A+"
      ? "Outstanding performance."
      : gpaGrade === "A"
        ? "Excellent performance."
        : gpaGrade === "NG"
          ? "Result not graded."
          : "Qualified.";

  return (
    <section className="px-10 py-6 border-t border-slate-300">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <SummaryRow
            label="Grade Point Average (GPA)"
            value={
              <span
                className={cn(
                  "tabular-nums font-semibold",
                  failing && "line-through text-slate-500",
                )}
              >
                {gpa !== null ? `${gpa.toFixed(2)} (${gpaGrade})` : `NG (${gpaGrade})`}
              </span>
            }
          />
          <SummaryRow
            label="Final Result"
            value={
              <span
                className={cn(
                  "text-lg font-bold tracking-wide",
                  gpaGrade === "NG" ? "text-red-600" : "text-slate-900",
                )}
              >
                {gpaGrade}
              </span>
            }
          />
          <SummaryRow
            label="Remarks"
            value={<span className="italic text-slate-700">{remark}</span>}
          />
        </div>

        <div className="flex flex-col justify-end">
          <div className="mt-auto grid grid-cols-2 gap-6 pt-8">
            <SignatureLine label="Class Teacher" />
            <SignatureLine label="Principal" />
          </div>
        </div>
      </div>

      {failing && (
        <div className="mt-6 rounded-sm border border-red-300 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          <strong className="font-semibold">Result not graded:</strong>{" "}
          Under Nepal NEB rules, the final result is <strong>NG</strong> when
          any subject is graded NG, regardless of GPA.
        </div>
      )}

      <GradeLegend />

      <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-slate-400">
        {data.school.name} &middot; Computer-generated document
      </p>
    </section>
  );
}

/** Compact NEB reference band — mirrors backend GradingService. */
function GradeLegend() {
  const bands: Array<{ label: string; gp: string }> = [
    { label: "A+", gp: "4.0" },
    { label: "A", gp: "3.6" },
    { label: "B+", gp: "3.2" },
    { label: "B", gp: "2.8" },
    { label: "C+", gp: "2.4" },
    { label: "C", gp: "2.0" },
    { label: "D", gp: "1.6" },
    { label: "NG", gp: "0.0" },
  ];
  return (
    <div className="mt-6 rounded-sm border border-slate-300 bg-slate-50/80 px-4 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Grading scale (NEB)
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-700 tabular-nums">
        {bands.map((b, i) => (
          <React.Fragment key={b.label}>
            <span>
              <span
                className={cn(
                  "font-semibold",
                  b.label === "NG" ? "text-red-600" : "text-slate-900",
                )}
              >
                {b.label}
              </span>{" "}
              = {b.gp}
            </span>
            {i < bands.length - 1 && <span className="text-slate-300">·</span>}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-dashed border-slate-200 pb-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div className="text-center">
      <div className="h-12 border-b border-slate-400" />
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

// `formatDate` removed: dead code that bypassed the calendar
// preference. Marksheet date surfaces use <DualDate /> directly,
// which routes through `formatByMode` and honors the user's choice
// (B.S. / A.D. / Dual) — adding back a Western-only formatter here
// would silently re-introduce the divergence the dual-date system
// is meant to prevent.

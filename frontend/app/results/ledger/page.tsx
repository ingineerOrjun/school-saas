"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Printer,
  Download,
  Loader2,
  BookOpen,
  GraduationCap,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { getToken, getStoredSchool } from "@/lib/auth";
import {
  examsApi,
  ledgerApi,
  type ClassLedger,
  type ExamDto,
} from "@/lib/exams";
import { classesApi, type ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * /results/ledger — class-wide grade ledger (a.k.a. result sheet).
 *
 * Renders one row per student in the chosen class, one column per
 * subject in the chosen exam. Designed to print as a chrome-free A4
 * landscape document for official archives.
 */
export default function LedgerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialExamId = searchParams.get("examId") ?? "";
  const initialClassId = searchParams.get("classId") ?? "";

  // Auth gate.
  React.useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const schoolName = React.useMemo(
    () => getStoredSchool()?.name ?? "Your school",
    [],
  );

  const [exams, setExams] = React.useState<ExamDto[]>([]);
  const [classes, setClasses] = React.useState<ClassWithSections[]>([]);
  const [examId, setExamId] = React.useState(initialExamId);
  const [classId, setClassId] = React.useState(initialClassId);
  const [ledger, setLedger] = React.useState<ClassLedger | null>(null);
  const [loadingMeta, setLoadingMeta] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Load exams + classes once.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [e, c] = await Promise.all([
          examsApi.list(),
          classesApi.list(),
        ]);
        if (!cancelled) {
          setExams(e);
          setClasses(c);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to load exams and classes.",
          );
        }
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Fetch ledger whenever both selections are set.
  React.useEffect(() => {
    if (!examId || !classId) {
      setLedger(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await ledgerApi.get(examId, classId);
        if (!cancelled) setLedger(data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        const msg =
          err instanceof ApiError ? err.message : "Failed to load ledger.";
        if (!cancelled) {
          setError(msg);
          setLedger(null);
        }
        toast.error(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [examId, classId, router]);

  return (
    <>
      {/*
        Print rules — A4 LANDSCAPE because grade ledgers tend to have
        more subject columns than fit on portrait. We force chrome
        elements off, drop the page background to plain white, and
        keep table rows from splitting across pages.
      */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .ledger { box-shadow: none !important; margin: 0 !important; border: 1px solid #111 !important; }
          tr, td, th { page-break-inside: avoid; break-inside: avoid; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      `}</style>

      <div className="min-h-screen bg-muted/40 py-6">
        {/* Toolbar — only on screen */}
        <div className="no-print mx-auto mb-4 flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-6">
          <Link
            href="/exams"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to exams
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <ExamPicker
              value={examId}
              exams={exams}
              loading={loadingMeta}
              onChange={setExamId}
            />
            <ClassPicker
              value={classId}
              classes={classes}
              loading={loadingMeta}
              onChange={setClassId}
            />
            <Button
              type="button"
              onClick={() => window.print()}
              disabled={!ledger || ledger.students.length === 0}
              title="Opens your browser's print dialog — choose 'Save as PDF' to archive"
              leftIcon={<Download className="h-4 w-4" />}
            >
              Download PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.print()}
              disabled={!ledger || ledger.students.length === 0}
              leftIcon={<Printer className="h-4 w-4" />}
            >
              Print Ledger
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="mx-auto max-w-[1180px] px-6">
          {loadingMeta ? (
            <Skeleton className="h-[60vh] w-full rounded-xl" />
          ) : error ? (
            <ErrorPanel message={error} />
          ) : !examId || !classId ? (
            <ChoosePrompt />
          ) : loading ? (
            <Skeleton className="h-[60vh] w-full rounded-xl" />
          ) : ledger ? (
            <Sheet ledger={ledger} schoolName={schoolName} />
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Toolbar pickers
// ---------------------------------------------------------------------------

function ExamPicker({
  value,
  exams,
  loading,
  onChange,
}: {
  value: string;
  exams: ExamDto[];
  loading: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative">
      <BookOpen className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || exams.length === 0}
        className="h-9 rounded-md border border-border bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-muted disabled:cursor-not-allowed"
      >
        <option value="">
          {exams.length === 0 ? "No exams" : "Choose exam…"}
        </option>
        {exams.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ClassPicker({
  value,
  classes,
  loading,
  onChange,
}: {
  value: string;
  classes: ClassWithSections[];
  loading: boolean;
  onChange: (id: string) => void;
}) {
  return (
    <div className="relative">
      <GraduationCap className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || classes.length === 0}
        className="h-9 rounded-md border border-border bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-muted disabled:cursor-not-allowed"
      >
        <option value="">
          {classes.length === 0 ? "No classes" : "Choose class…"}
        </option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function ChoosePrompt() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/60 backdrop-blur-md p-12 text-center">
      <BookOpen className="mx-auto h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="mt-3 text-lg font-semibold tracking-tight text-foreground">
        Pick an exam and a class
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The ledger fills in once both are selected. Use the toolbar above.
      </p>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-md font-semibold tracking-tight text-foreground">
          Couldn&apos;t load ledger
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sheet itself
// ---------------------------------------------------------------------------

function Sheet({
  ledger,
  schoolName,
}: {
  ledger: ClassLedger;
  schoolName: string;
}) {
  if (ledger.students.length === 0) {
    return (
      <article className="ledger mx-auto bg-white shadow-sm border border-slate-300 text-slate-900 p-12 text-center">
        <p className="text-sm italic text-slate-500">
          No students assigned to {ledger.class.name}. Add students to this
          class to see the ledger.
        </p>
      </article>
    );
  }

  return (
    <article className="ledger mx-auto bg-white shadow-sm print:shadow-none border border-slate-300 text-slate-900">
      <SheetHeader ledger={ledger} schoolName={schoolName} />
      <LedgerTable ledger={ledger} />
      <LedgerSummary ledger={ledger} />
      <SheetFooter ledger={ledger} schoolName={schoolName} />
    </article>
  );
}

function SheetHeader({
  ledger,
  schoolName,
}: {
  ledger: ClassLedger;
  schoolName: string;
}) {
  const issued = formatDate(ledger.generatedAt);
  return (
    <header className="border-b-2 border-slate-900 px-8 py-5">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-6">
        <div
          aria-hidden
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-slate-400 bg-slate-50 text-slate-500 print:border-solid print:border-slate-700"
          title="School logo"
        >
          <GraduationCap className="h-7 w-7" strokeWidth={1.5} />
        </div>
        <div className="text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            CLASS LEDGER
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 uppercase">
            {schoolName}
          </h1>
          <p className="mt-0.5 text-xs text-slate-600">
            {ledger.exam.name} &middot; {ledger.class.name} &middot;{" "}
            {ledger.students.length}{" "}
            {ledger.students.length === 1 ? "student" : "students"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Issued
          </p>
          <p className="mt-0.5 font-mono text-sm text-slate-900">{issued}</p>
        </div>
      </div>
    </header>
  );
}

function LedgerTable({ ledger }: { ledger: ClassLedger }) {
  return (
    <div className="overflow-x-auto px-6 py-4">
      {/* Compact table — small font + tight padding so even ~10 subject
          columns fit cleanly on A4 landscape. */}
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-slate-100 border-y-2 border-slate-900">
            {/* SN column matches the real-world school ledger format —
                serial numbering from 1, derived from row position after
                the backend's symbolNumber-ASC sort. */}
            <Th className="text-center">SN</Th>
            <Th className="text-left">Symbol</Th>
            <Th className="text-left">Name</Th>
            {ledger.subjects.map((s) => (
              <Th key={s.id} className="text-center">
                {s.name}
              </Th>
            ))}
            <Th className="text-right">GPA</Th>
            <Th className="text-center">Result</Th>
          </tr>
        </thead>
        <tbody>
          {ledger.students.map((s, idx) => (
            <tr
              key={s.id}
              className={cn(
                "border-b border-slate-200",
                idx % 2 === 1 && "bg-slate-50/60",
              )}
            >
              <Td className="text-center tabular-nums text-slate-600">
                {idx + 1}
              </Td>
              <Td className="text-left font-mono text-slate-700">
                {s.symbolNumber ?? "—"}
              </Td>
              <Td className="text-left font-medium">{s.name}</Td>
              {s.results.map((cell) => (
                <Td key={cell.subjectId} className="text-center">
                  <GradeCell grade={cell.grade} />
                </Td>
              ))}
              <Td className="text-right tabular-nums font-medium">
                {s.finalResult ? s.gpa.toFixed(2) : "—"}
              </Td>
              <Td
                className={cn(
                  "text-center font-bold tracking-wide",
                  s.finalResult === "NG" && "text-red-600",
                  s.finalResult === null && "text-slate-400",
                )}
              >
                {s.finalResult ?? "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GradeCell({ grade }: { grade: string | null }) {
  if (grade === null) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <span
      className={cn(
        "font-semibold",
        grade === "NG" && "text-red-600",
      )}
    >
      {grade}
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
    <th
      className={cn(
        "px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-700 whitespace-nowrap",
        className,
      )}
    >
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
    <td className={cn("px-2 py-1.5 text-slate-900", className)}>{children}</td>
  );
}

/**
 * Quick-glance pass/fail tally rendered between the table and the
 * signature footer. Counts:
 *   • Total Students = every row in the ledger
 *   • Passed         = finalResult set AND not "NG"
 *   • Failed (NG)    = finalResult === "NG"
 * Students with `finalResult === null` (no results recorded) are tallied
 * separately as "Ungraded" so the three primary numbers always reconcile
 * with the row count when present.
 */
function LedgerSummary({ ledger }: { ledger: ClassLedger }) {
  const total = ledger.students.length;
  const failed = ledger.students.filter((s) => s.finalResult === "NG").length;
  const passed = ledger.students.filter(
    (s) => s.finalResult !== null && s.finalResult !== "NG",
  ).length;
  const ungraded = total - passed - failed;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return (
    <section className="px-6 py-3 border-t-2 border-slate-900 bg-slate-50">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <SummaryPill label="Total Students" value={total} tone="slate" />
          <SummaryPill label="Passed" value={passed} tone="success" />
          <SummaryPill label="Failed (NG)" value={failed} tone="danger" />
          {ungraded > 0 && (
            <SummaryPill label="Ungraded" value={ungraded} tone="muted" />
          )}
        </div>
        {total > 0 && (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Pass rate{" "}
            <span className="font-bold text-slate-900 tabular-nums">
              {passRate}%
            </span>
          </span>
        )}
      </div>
    </section>
  );
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "success" | "danger" | "muted";
}) {
  const tones = {
    slate: "bg-slate-200 text-slate-800",
    success: "bg-emerald-100 text-emerald-800",
    danger: "bg-red-100 text-red-700",
    muted: "bg-slate-100 text-slate-500",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 rounded-md px-2.5 py-1 font-medium",
        tones[tone],
      )}
    >
      <span className="text-[10px] uppercase tracking-wider opacity-80">
        {label}
      </span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </span>
  );
}

function SheetFooter({
  ledger,
  schoolName,
}: {
  ledger: ClassLedger;
  schoolName: string;
}) {
  const ngCount = ledger.students.filter((s) => s.finalResult === "NG").length;
  return (
    <footer className="px-8 py-4 border-t border-slate-300">
      {/* Two signature blocks — Class Teacher (left) and Principal
          (right) — with generous space between so the actual ink
          signatures don't overlap when the sheet is signed by hand. */}
      <div className="mt-6 grid grid-cols-2 gap-x-24 gap-y-2 print:mt-10">
        <SignatureLine label="Class Teacher" align="left" />
        <SignatureLine label="Principal" align="right" />
      </div>
      <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-400">
        <span>{schoolName} &middot; Computer-generated</span>
        {ngCount > 0 && (
          <span className="text-red-600 font-semibold normal-case tracking-normal">
            {ngCount}{" "}
            {ngCount === 1 ? "student" : "students"} graded NG
          </span>
        )}
      </div>
    </footer>
  );
}

function SignatureLine({
  label,
  align = "center",
}: {
  label: string;
  align?: "left" | "center" | "right";
}) {
  // Taller line (h-14) leaves comfortable room for an ink signature when
  // the ledger is printed and signed by hand.
  return (
    <div
      className={cn(
        align === "left" && "text-left",
        align === "center" && "text-center",
        align === "right" && "text-right",
      )}
    >
      <div className="h-14 border-b border-slate-500" />
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
        {label}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

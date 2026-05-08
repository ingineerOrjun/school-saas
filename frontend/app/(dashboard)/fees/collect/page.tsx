"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  User,
  Phone,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import {
  feesApi,
  todayISO,
  type CashierSummary,
  type StudentFeesReport,
  type PaymentMethod,
} from "@/lib/fees";
import { studentsApi, type StudentDto } from "@/lib/students";
import { formatCurrency } from "@/lib/currency";
import { Skeleton } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";
import { StudentSearchPicker } from "@/components/fees/collect/StudentSearchPicker";
import { CashierStatsBar } from "@/components/fees/collect/CashierStatsBar";
import { PaymentSuccessPanel } from "@/components/fees/collect/PaymentSuccessPanel";

// ---------------------------------------------------------------------------
// /fees/collect — the cashier workspace.
//
// Layout (desktop):
//
//   ┌─────────────────────── Today's stats ────────────────────────┐
//   ├─────────────────────────┬────────────────────────────────────┤
//   │ Search                  │ Selected student                   │
//   │   ┌─────────────────┐   │ ┌──────────────────────────────┐ │
//   │   │ search box      │   │ │ name · class · phone          │ │
//   │   │ recent students │   │ │ ────────────────────────────  │ │
//   │   └─────────────────┘   │ │ outstanding fees table        │ │
//   │                         │ │ ────────────────────────────  │ │
//   │ Recent activity         │ │ payment form (live preview)   │ │
//   │ (this session)          │ │ ────────────────────────────  │ │
//   │                         │ │ [Save & Print]                │ │
//   │                         │ └──────────────────────────────┘ │
//   └─────────────────────────┴────────────────────────────────────┘
//
// Mobile collapses to a single column with the search up top, the
// stats bar above that, and the selected-student panel filling the
// rest of the viewport when a student is chosen.
//
// Keyboard contract:
//   • Page mounts with focus on the search input
//   • Tab moves through: search → method → amount → notes → Save
//   • Enter in search picks the highlighted student
//   • Enter in amount triggers Save & Print (when valid)
// ---------------------------------------------------------------------------

interface RecordedPayment {
  id: string;
  receiptNumber: string | null;
  amount: number;
  date: string;
  /** Student snapshot at the moment of recording. */
  student: StudentDto;
  /** Computed by the workspace when we recorded — drives the success panel. */
  remainingAfterPayment: number;
}

interface RecentActivity {
  id: string;
  receiptNumber: string | null;
  studentName: string;
  amount: number;
  at: number; // Date.now() ms
}

export default function CashierWorkspacePage() {
  const [summary, setSummary] = React.useState<CashierSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<StudentDto | null>(null);
  const [report, setReport] = React.useState<StudentFeesReport | null>(null);
  const [reportLoading, setReportLoading] = React.useState(false);
  const [reportError, setReportError] = React.useState<string | null>(null);
  const [lastPayment, setLastPayment] = React.useState<RecordedPayment | null>(
    null,
  );
  const [recents, setRecents] = React.useState<StudentDto[]>([]);
  const [activity, setActivity] = React.useState<RecentActivity[]>([]);

  // Load today's stats on mount + refresh after every successful
  // payment so the bar stays in sync with the cashier's progress.
  const refreshSummary = React.useCallback(async () => {
    try {
      setSummaryLoading(true);
      const s = await feesApi.getCashierSummary();
      setSummary(s);
    } catch (err) {
      // Soft-fail: the workspace works without the stats. Errors here
      // shouldn't block payment entry.
      if (err instanceof ApiError && err.status >= 500) {
        toast.error("Couldn't load today's stats — payments still work.");
      }
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refreshSummary();
    // Pre-load the recents list so the empty-search state has data to
    // show. Failure here is silent — the search picker falls back to
    // the server-side empty-query behaviour.
    studentsApi
      .search("", 8)
      .then(setRecents)
      .catch(() => setRecents([]));
  }, [refreshSummary]);

  // When a student is picked, fetch their fee report. This is the
  // payload that drives the outstanding-fees table + the live payment
  // form. We clear `lastPayment` here too — picking a new student
  // means the previous success panel is no longer relevant.
  const loadReport = React.useCallback(async (studentId: string) => {
    setReportLoading(true);
    setReportError(null);
    setLastPayment(null);
    try {
      const r = await feesApi.getStudentFees(studentId);
      setReport(r);
    } catch (err) {
      setReportError(
        err instanceof ApiError ? err.message : "Failed to load student fees.",
      );
      setReport(null);
    } finally {
      setReportLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (selected) loadReport(selected.id);
  }, [selected, loadReport]);

  const handleSelect = (s: StudentDto) => {
    // Clear the previous success panel synchronously. `loadReport`
    // (kicked off by the effect below) also clears it, but doing it
    // here avoids a one-frame flicker where the success panel from
    // the previous student is briefly visible alongside the new
    // student's loading state.
    setLastPayment(null);
    setSelected(s);
  };

  const handleContinue = () => {
    // "Next student" — clear the selection + report so the workspace
    // returns to its "search someone" state. We DON'T clear `recents`
    // or `activity` because those are workspace-wide context the
    // cashier wants to keep across sessions.
    setSelected(null);
    setReport(null);
    setLastPayment(null);
  };

  // Wire a successful payment back to the workspace. The payment form
  // calls this with the newly-recorded payment + the new remaining
  // balance so we can render the success panel without a refetch.
  const handlePaymentRecorded = (recorded: RecordedPayment) => {
    setLastPayment(recorded);
    refreshSummary();
    setActivity((prev) => [
      {
        id: recorded.id,
        receiptNumber: recorded.receiptNumber,
        studentName: `${recorded.student.firstName} ${recorded.student.lastName}`,
        amount: recorded.amount,
        at: Date.now(),
      },
      // Keep last 8 entries — enough to remember the morning rush
      // without scrolling the sidebar.
      ...prev.slice(0, 7),
    ]);
  };

  return (
    <div className="space-y-5">
      <Header />

      <CashierStatsBar summary={summary} loading={summaryLoading} />

      {/* Two-column grid on desktop, stacked on mobile. The search
          column has a fixed minimum width so the input doesn't shrink
          to the point of being unusable on tablet sizes. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(320px,400px)_1fr]">
        <aside className="space-y-5">
          <SearchPanel
            recents={recents}
            onSelect={handleSelect}
            // Only autofocus when the workspace is fresh — once a
            // payment has been recorded the success panel takes
            // priority and stealing focus would be jarring.
            autoFocus={!selected && !lastPayment}
          />
          <RecentActivityPanel activity={activity} />
        </aside>

        <main>
          {lastPayment ? (
            <div className="space-y-4">
              <PaymentSuccessPanel
                payment={{
                  id: lastPayment.id,
                  receiptNumber: lastPayment.receiptNumber,
                  amount: lastPayment.amount,
                  date: lastPayment.date,
                }}
                student={lastPayment.student}
                remainingAfterPayment={lastPayment.remainingAfterPayment}
                onContinue={handleContinue}
              />
              {/* Keep the student panel mounted but read-only so the
                  cashier can verify against the just-printed receipt. */}
              {selected && report && (
                <SelectedStudentPanel
                  student={selected}
                  report={report}
                  reportLoading={false}
                  reportError={null}
                  readOnly
                  onPaymentRecorded={handlePaymentRecorded}
                  onReportRefresh={() => loadReport(selected.id)}
                />
              )}
            </div>
          ) : selected ? (
            <SelectedStudentPanel
              student={selected}
              report={report}
              reportLoading={reportLoading}
              reportError={reportError}
              readOnly={false}
              onPaymentRecorded={handlePaymentRecorded}
              onReportRefresh={() => loadReport(selected.id)}
            />
          ) : (
            <EmptyWorkspace />
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <Link
          href="/fees"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to fees
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Cashier workspace
        </h1>
        <p className="text-sm text-muted-foreground">
          Search a student, record a payment, print the receipt — keyboard
          friendly. Today&apos;s totals refresh after each save.
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono">
          <kbd className="text-[10px] font-bold">↑↓</kbd> navigate
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono">
          <kbd className="text-[10px] font-bold">Enter</kbd> select
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search panel (left column)
// ---------------------------------------------------------------------------

function SearchPanel({
  recents,
  onSelect,
  autoFocus,
}: {
  recents: StudentDto[];
  onSelect: (s: StudentDto) => void;
  autoFocus: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold text-foreground">
        Find a student
      </h2>
      <StudentSearchPicker
        autoFocus={autoFocus}
        onSelect={onSelect}
        recents={recents}
      />
      <p className="mt-3 text-[11px] text-muted-foreground">
        Match by name, symbol number, parent phone, or parent name.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent activity panel — a session-local feed of payments the cashier
// has taken in this browser. Persists only in component state, not
// across reloads — that's intentional, since the canonical "what
// happened today" view is the Payment History page.
// ---------------------------------------------------------------------------

function RecentActivityPanel({ activity }: { activity: RecentActivity[] }) {
  if (activity.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-center text-xs text-muted-foreground">
        Recent activity in this session will appear here.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        This session
      </h2>
      <ul className="mt-2 space-y-2">
        {activity.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <Link
              href={`/receipts/${a.id}`}
              target="_blank"
              className="min-w-0 flex-1 hover:text-primary transition-colors"
            >
              <div className="truncate font-medium text-foreground">
                {a.studentName}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {a.receiptNumber ?? "no receipt"} · {timeAgo(a.at)}
              </div>
            </Link>
            <span className="tabular-nums text-foreground">
              {formatCurrency(a.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

// ---------------------------------------------------------------------------
// Empty workspace (right column when no student selected)
// ---------------------------------------------------------------------------

function EmptyWorkspace() {
  return (
    <div className="flex h-[420px] items-center justify-center rounded-xl border border-dashed border-border bg-surface/50 p-6 text-center">
      <div>
        <Wallet
          className="mx-auto h-10 w-10 text-muted-foreground/50"
          strokeWidth={1.5}
        />
        <h3 className="mt-3 text-base font-semibold text-foreground">
          Search a student to begin
        </h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          Type a name, symbol number, or phone in the search panel — the
          student card appears here with their outstanding fees.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selected student panel (right column when student is picked)
// ---------------------------------------------------------------------------

interface SelectedStudentPanelProps {
  student: StudentDto;
  report: StudentFeesReport | null;
  reportLoading: boolean;
  reportError: string | null;
  /** When true, the form is hidden — used after a successful save. */
  readOnly: boolean;
  onPaymentRecorded: (p: RecordedPayment) => void;
  onReportRefresh: () => void;
}

function SelectedStudentPanel({
  student,
  report,
  reportLoading,
  reportError,
  readOnly,
  onPaymentRecorded,
  onReportRefresh,
}: SelectedStudentPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 sm:p-6 space-y-5">
      {/* Student header — name + class + phone, with an overdue chip
          right-aligned when the student has any past-due balance. */}
      <StudentHeader student={student} report={report} />

      {/* Outstanding fees table */}
      {reportLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : reportError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <div className="flex items-center gap-2 text-destructive font-medium">
            <AlertTriangle className="h-4 w-4" />
            {reportError}
          </div>
          <button
            type="button"
            onClick={onReportRefresh}
            className="mt-2 text-xs font-medium text-destructive underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      ) : report ? (
        <>
          <OutstandingFees report={report} />
          {!readOnly && (
            <PaymentForm
              student={student}
              report={report}
              onRecorded={onPaymentRecorded}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function StudentHeader({
  student,
  report,
}: {
  student: StudentDto;
  report: StudentFeesReport | null;
}) {
  const hasOverdue =
    report?.assignments.some((a) => a.status === "OVERDUE") ?? false;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary"
          aria-hidden
        >
          {(student.firstName[0] ?? "?").toUpperCase()}
          {(student.lastName[0] ?? "").toUpperCase()}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground truncate">
            {student.firstName} {student.lastName}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {student.symbolNumber && (
              <span className="font-mono">{student.symbolNumber}</span>
            )}
            {student.section ? (
              <span>
                {student.section.class.name} · {student.section.name}
              </span>
            ) : student.class ? (
              <span>{student.class.name}</span>
            ) : (
              <span className="italic">Unassigned</span>
            )}
            {student.contactNumber && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" /> {student.contactNumber}
              </span>
            )}
            {student.parentName && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" /> {student.parentName}
              </span>
            )}
          </div>
        </div>
      </div>
      {hasOverdue && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          Has overdue
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outstanding fees table — only the rows with remaining > 0 OR overdue
// status. Cleared rows are hidden because they're noise during
// collection ("which fee am I paying?").
// ---------------------------------------------------------------------------

function OutstandingFees({ report }: { report: StudentFeesReport }) {
  const open = report.assignments.filter((a) => a.remaining > 0);

  if (open.length === 0) {
    return (
      <div className="rounded-md border border-emerald-300/60 bg-emerald-50/40 p-3 text-sm">
        <span className="font-semibold text-emerald-700">All paid up.</span>
        <span className="ml-2 text-muted-foreground tabular-nums">
          {report.totalCredit > 0 && (
            <>+ {formatCurrency(report.totalCredit)} credit on file</>
          )}
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Outstanding fees
        </h3>
        <div className="text-xs tabular-nums text-muted-foreground">
          Due:{" "}
          <span className="font-semibold text-foreground">
            {formatCurrency(report.totalDue)}
          </span>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Fee</th>
              <th className="px-3 py-2 text-right">Final</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Remaining</th>
              <th className="px-3 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {open.map((a) => (
              <tr
                key={a.id}
                className={cn(a.status === "OVERDUE" && "bg-destructive/[0.04]")}
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-foreground">
                    {a.feeStructureName}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Due {a.dueDate}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatCurrency(a.finalAmount)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {formatCurrency(a.paid)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums font-semibold",
                    a.status === "OVERDUE"
                      ? "text-destructive"
                      : "text-foreground",
                  )}
                >
                  {formatCurrency(a.remaining)}
                </td>
                <td className="px-3 py-2 text-center">
                  <AssignmentStatusChip
                    status={a.status}
                    daysOverdue={a.daysOverdue}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssignmentStatusChip({
  status,
  daysOverdue,
}: {
  status: import("@/lib/fees").AssignmentStatus;
  daysOverdue: number;
}) {
  switch (status) {
    case "PAID":
      return (
        <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          Paid
        </span>
      );
    case "OVERDUE":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
          <AlertTriangle className="h-2.5 w-2.5" />
          {daysOverdue}d late
        </span>
      );
    case "DUE_SOON":
      return (
        <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          Due in {-daysOverdue}d
        </span>
      );
    case "PARTIAL":
      return (
        <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
          Partial
        </span>
      );
    case "UNPAID":
    default:
      return (
        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          Unpaid
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Payment form — the keyboard-first entry surface.
//
// Live balance preview: as the cashier types `amount`, we compute and
// surface "remaining after payment" + "excess credit generated" + a
// success/error chip. Pure client-side math against the loaded report,
// no extra fetches.
//
// Idempotency: a UUID is generated on mount and reused for every
// submit attempt against this student. Resets when the student changes
// (we live in a different effect scope) so the next student gets a
// fresh key.
// ---------------------------------------------------------------------------

function PaymentForm({
  student,
  report,
  onRecorded,
}: {
  student: StudentDto;
  report: StudentFeesReport;
  onRecorded: (p: RecordedPayment) => void;
}) {
  const [feeAssignmentId, setFeeAssignmentId] = React.useState<string>(() => {
    // Default to the oldest unpaid (or overdue) fee — that's the
    // "smart" default for FIFO collection.
    const oldest = [...report.assignments]
      .filter((a) => a.remaining > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return oldest?.id ?? "";
  });
  const [amount, setAmount] = React.useState<string>(() => {
    const oldest = [...report.assignments]
      .filter((a) => a.remaining > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    return oldest ? oldest.remaining.toString() : "";
  });
  const [date, setDate] = React.useState<string>(todayISO());
  const [method, setMethod] = React.useState<PaymentMethod | "">("CASH");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Idempotency UUID — stable across this dialog's lifetime. Resets if
  // the student id changes (different mount).
  const idempotencyKeyRef = React.useRef<string>(crypto.randomUUID());
  React.useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [student.id]);

  const selectedAssignment = React.useMemo(() => {
    if (!feeAssignmentId) return null;
    return report.assignments.find((a) => a.id === feeAssignmentId) ?? null;
  }, [report, feeAssignmentId]);

  const numericAmount = Number(amount);
  const validAmount =
    Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0;

  // Live preview math: where will this payment land the student?
  const preview = React.useMemo(() => {
    const remainingBefore = report.totalDue;
    const remainingAfter = Math.max(0, remainingBefore - validAmount);
    const excessCredit = Math.max(0, validAmount - remainingBefore);
    return { remainingBefore, remainingAfter, excessCredit };
  }, [report.totalDue, validAmount]);

  const overflowsAssignment =
    selectedAssignment !== null &&
    validAmount > selectedAssignment.remaining + 0.0001;

  const overflowsTotal =
    !selectedAssignment && validAmount > report.totalDue + 0.0001;

  const submit = async (andPrint: boolean) => {
    if (submitting) return;
    if (!validAmount) {
      toast.error("Enter a positive amount.");
      return;
    }
    if (overflowsAssignment) {
      toast.error(
        `Amount exceeds remaining due (${formatCurrency(selectedAssignment!.remaining)}) on this fee.`,
      );
      return;
    }
    if (overflowsTotal) {
      toast.error(
        `Amount exceeds total outstanding due (${formatCurrency(report.totalDue)}).`,
      );
      return;
    }
    // Defensive 2dp normalisation — server rounds to 2dp anyway, but
    // doing it here keeps the "amount in words" on the receipt
    // consistent with the figure the cashier saw on screen.
    const normalised = Math.round(validAmount * 100) / 100;
    setSubmitting(true);
    try {
      const created = await feesApi.recordPayment({
        studentId: student.id,
        amount: normalised,
        date,
        feeAssignmentId: feeAssignmentId || undefined,
        method: method || undefined,
        notes: notes.trim() || undefined,
        clientRequestId: idempotencyKeyRef.current,
      });
      if (andPrint && created.receiptNumber) {
        window.open(`/receipts/${created.id}?print=1`, "_blank");
      }
      onRecorded({
        id: created.id,
        receiptNumber: created.receiptNumber,
        amount: normalised,
        date,
        student,
        remainingAfterPayment: preview.remainingAfter,
      });
      toast.success(
        `Recorded ${formatCurrency(normalised)} from ${student.firstName} ${student.lastName}`,
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Failed to record payment.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnter = (e: React.KeyboardEvent) => {
    // Enter on the amount field commits the primary action — Save & Print.
    // We exclude textarea (notes) so multi-line notes still work.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      (e.target as HTMLElement).tagName !== "TEXTAREA"
    ) {
      e.preventDefault();
      void submit(true);
    }
  };

  return (
    <form
      onKeyDown={handleEnter}
      onSubmit={(e) => e.preventDefault()}
      className="space-y-4 border-t border-border pt-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Record payment
        </h3>
      </div>

      <QuickActions
        report={report}
        selectedAssignment={selectedAssignment}
        disabled={submitting}
        onApply={(value, assignmentId) => {
          if (assignmentId !== undefined) {
            setFeeAssignmentId(assignmentId);
          }
          setAmount(value > 0 ? value.toFixed(2) : "");
        }}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Apply to fee
          </label>
          <select
            value={feeAssignmentId}
            onChange={(e) => {
              setFeeAssignmentId(e.target.value);
              const a = report.assignments.find(
                (x) => x.id === e.target.value,
              );
              if (a) setAmount(a.remaining.toString());
            }}
            disabled={submitting}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          >
            <option value="">General Credit (auto-apply oldest first)</option>
            {report.assignments
              .filter((a) => a.remaining > 0)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.feeStructureName} · due {a.dueDate} ·{" "}
                  {formatCurrency(a.remaining)} remaining
                </option>
              ))}
          </select>
        </div>
        <Input
          label="Amount"
          type="number"
          min={0.01}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={submitting}
          autoFocus
          error={
            overflowsAssignment
              ? `Exceeds remaining ${formatCurrency(selectedAssignment!.remaining)} on this fee`
              : overflowsTotal
                ? `Exceeds total due ${formatCurrency(report.totalDue)}`
                : undefined
          }
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={todayISO()}
            disabled={submitting}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">Method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}
            disabled={submitting}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          >
            <option value="">(unspecified)</option>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank transfer</option>
            <option value="ESEWA">eSewa</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-sm font-medium text-foreground">
            Notes{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (optional, printed on receipt)
            </span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            disabled={submitting}
            placeholder="e.g. Paid by parent at front desk"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary resize-none"
          />
        </div>
      </div>

      <LivePreview
        amount={validAmount}
        report={report}
        selectedAssignment={selectedAssignment}
        preview={preview}
      />

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => submit(false)}
          disabled={submitting || !validAmount}
          className={cn(
            "inline-flex items-center justify-center h-10 rounded-md border border-border bg-surface px-4 text-sm font-medium",
            "hover:border-primary/40 hover:text-primary active:scale-[0.98] transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={submitting || !validAmount}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground",
            "shadow-sm hover:bg-primary/90 active:scale-[0.98] transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Printing…
            </>
          ) : (
            "Save & Print"
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// QuickActions — keyboard-friendly preset chips.
//
// Layout: horizontal row of chips. Click sets the amount (and possibly
// the assignment) so the cashier can complete the most common
// scenarios in 1-2 keys. Every chip has a tabindex so they're
// reachable via tab — important for the keyboard-only workflow.
// ---------------------------------------------------------------------------

function QuickActions({
  report,
  selectedAssignment,
  disabled,
  onApply,
}: {
  report: StudentFeesReport;
  selectedAssignment: StudentFeesReport["assignments"][number] | null;
  disabled: boolean;
  onApply: (value: number, assignmentId?: string) => void;
}) {
  const overdue = report.assignments.find((a) => a.status === "OVERDUE");

  // "Apply Credit" — covers the due using existing General Credit, then
  // suggests the residual as the amount. Suppressed when there's no
  // due (nothing to cover) or no credit (nothing to apply).
  const creditResidual = Math.max(0, report.totalDue - report.totalCredit);
  const showCredit =
    report.totalCredit > 0 &&
    report.totalDue > 0 &&
    creditResidual < report.totalDue;

  if (
    !overdue &&
    report.totalDue === 0 &&
    !selectedAssignment &&
    !showCredit
  ) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Quick actions
      </span>
      {selectedAssignment && selectedAssignment.remaining > 0 && (
        <Chip
          label={`Pay remaining · ${formatCurrency(selectedAssignment.remaining)}`}
          onClick={() => onApply(selectedAssignment.remaining)}
          disabled={disabled}
        />
      )}
      {overdue && overdue.id !== selectedAssignment?.id && (
        <Chip
          label={`Clear overdue · ${formatCurrency(overdue.remaining)}`}
          onClick={() => onApply(overdue.remaining, overdue.id)}
          disabled={disabled}
          tone="destructive"
          title={`Apply to "${overdue.feeStructureName}" (oldest unpaid past due-date)`}
        />
      )}
      {report.totalDue > 0 && (
        <Chip
          label={`Pay full due · ${formatCurrency(report.totalDue)}`}
          onClick={() => onApply(report.totalDue, "")}
          disabled={disabled}
          tone="primary"
          title="Apply to General Credit (auto-allocates oldest first)"
        />
      )}
      {showCredit && (
        <Chip
          label={`After credit · ${formatCurrency(creditResidual)}`}
          onClick={() => onApply(creditResidual)}
          disabled={disabled}
          title={`Use ${formatCurrency(report.totalCredit)} credit on file; collect the residual`}
        />
      )}
    </div>
  );
}

function Chip({
  label,
  onClick,
  disabled,
  tone = "muted",
  title,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  tone?: "primary" | "muted" | "destructive";
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        tone === "primary"
          ? "border-primary/30 bg-primary/5 text-primary hover:border-primary/60 hover:bg-primary/10"
          : tone === "destructive"
            ? "border-destructive/30 bg-destructive/5 text-destructive hover:border-destructive/60 hover:bg-destructive/10"
            : "border-border bg-surface text-foreground hover:border-primary/40 hover:text-primary",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// LivePreview — running breakdown that updates as the cashier types.
//
// Shows three numbers:
//   • Remaining BEFORE this payment (just for grounding)
//   • Remaining AFTER this payment (the headline number — biggest)
//   • Excess credit generated, if any (when amount > totalDue)
//
// Plus a one-liner about which assignment will absorb the payment if
// "General Credit" is selected — the cashier sees "this will land on
// X first" without having to dig.
// ---------------------------------------------------------------------------

function LivePreview({
  amount,
  report,
  selectedAssignment,
  preview,
}: {
  amount: number;
  report: StudentFeesReport;
  selectedAssignment: StudentFeesReport["assignments"][number] | null;
  preview: { remainingBefore: number; remainingAfter: number; excessCredit: number };
}) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="grid grid-cols-3 gap-3 text-xs">
        <PreviewStat
          label="Current due"
          value={formatCurrency(preview.remainingBefore)}
        />
        <PreviewStat
          label="Paying now"
          value={amount > 0 ? formatCurrency(amount) : "—"}
          emphasised={amount > 0}
        />
        <PreviewStat
          label="After payment"
          value={formatCurrency(preview.remainingAfter)}
          tone={preview.remainingAfter === 0 ? "success" : "default"}
        />
      </div>
      {preview.excessCredit > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Excess of {formatCurrency(preview.excessCredit)} will be added as
          General Credit.
        </p>
      )}
      {!selectedAssignment && amount > 0 && report.totalDue > 0 && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          General Credit auto-applies to oldest unpaid fee
          {(() => {
            const oldest = [...report.assignments]
              .filter((a) => a.remaining > 0)
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
            return oldest ? ` (${oldest.feeStructureName})` : "";
          })()}
          .
        </p>
      )}
    </div>
  );
}

function PreviewStat({
  label,
  value,
  emphasised,
  tone = "default",
}: {
  label: string;
  value: string;
  emphasised?: boolean;
  tone?: "default" | "success";
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 tabular-nums",
          emphasised ? "text-base font-bold" : "text-sm font-semibold",
          tone === "success" ? "text-emerald-700" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

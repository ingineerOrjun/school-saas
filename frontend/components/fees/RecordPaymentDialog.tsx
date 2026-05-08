"use client";

import * as React from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import {
  feesApi,
  todayISO,
  type PaymentMethod,
  type StudentFeesReport,
} from "@/lib/fees";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export interface RecordPaymentDialogProps {
  /** Student to record a payment for. Null closes the dialog. */
  student: { id: string; name: string } | null;
  onClose: () => void;
  onRecorded?: () => void;
}

export function RecordPaymentDialog({
  student,
  onClose,
  onRecorded,
}: RecordPaymentDialogProps) {
  const [report, setReport] = React.useState<StudentFeesReport | null>(null);
  const [amount, setAmount] = React.useState<string>("");
  const [date, setDate] = React.useState<string>(todayISO());
  const [feeAssignmentId, setFeeAssignmentId] = React.useState<string>("");
  const [method, setMethod] = React.useState<PaymentMethod | "">("CASH");
  const [notes, setNotes] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  // ------------------------------------------------------------------
  // Idempotency key. Generated once per dialog-open and reused on every
  // submit attempt — so a double-click, a network retry, or even a
  // bounced retry from the offline queue all resolve to ONE payment row
  // on the server. The key resets on dialog close so the next student
  // gets a fresh key (the server would otherwise return the previous
  // student's payment if the keys collided).
  //
  // We use crypto.randomUUID() (browsers 92+, all evergreen) — no need
  // for the `uuid` package. The ref keeps the value stable across
  // renders without forcing a re-render on regeneration.
  // ------------------------------------------------------------------
  const idempotencyKeyRef = React.useRef<string | null>(null);
  if (idempotencyKeyRef.current === null && student !== null) {
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  React.useEffect(() => {
    if (!student) {
      // Dialog closed → forget the previous student's idempotency key.
      // The next open generates a fresh one.
      idempotencyKeyRef.current = null;
      return;
    }
    setAmount("");
    setDate(todayISO());
    setFeeAssignmentId("");
    setMethod("CASH");
    setNotes("");
    (async () => {
      try {
        const r = await feesApi.getStudentFees(student.id);
        setReport(r);
        // Pre-select the oldest unpaid assignment + pre-fill its remaining.
        const oldest = r.assignments
          .filter((a) => a.remaining > 0)
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
        if (oldest) {
          setFeeAssignmentId(oldest.id);
          setAmount(oldest.remaining.toString());
        }
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Failed to load fees.",
        );
      }
    })();
  }, [student]);

  const selectedAssignment = React.useMemo(() => {
    if (!feeAssignmentId) return null;
    return report?.assignments.find((a) => a.id === feeAssignmentId) ?? null;
  }, [report, feeAssignmentId]);

  /**
   * Single submit path. Both the "Save" and "Save & Print" buttons go
   * through here — `andPrint` decides whether to navigate to the
   * print-mode receipt URL after recording.
   *
   * We block re-entry via the `submitting` flag, but the real safety
   * net is the idempotency key on the request: even if a stray click
   * sneaks through (e.g. via Enter-key handling), the server returns
   * the same payment.
   */
  const handleSubmit = async (andPrint: boolean) => {
    if (!student) return;
    if (submitting) return; // belt-and-braces with the disabled state
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a positive amount.");
      return;
    }
    // Defensive 2dp normalisation — the user might paste "100.005" and
    // the server rounds to 2dp anyway, so we round here too. Keeps the
    // amount-in-words on the receipt consistent with the figure typed.
    const normalisedAmount = Math.round(n * 100) / 100;

    setSubmitting(true);
    try {
      const created = await feesApi.recordPayment({
        studentId: student.id,
        amount: normalisedAmount,
        date,
        feeAssignmentId: feeAssignmentId || undefined,
        method: method || undefined,
        notes: notes.trim() || undefined,
        clientRequestId: idempotencyKeyRef.current ?? undefined,
      });

      // "Save & Print" → jump straight to the receipt with ?print=1 so
      // the print dialog opens automatically. The receipt page tab also
      // doubles as a confirmation receipt, so the dialog can close
      // immediately without leaving the user wondering what happened.
      if (andPrint && created.receiptNumber) {
        window.open(`/receipts/${created.id}?print=1`, "_blank");
      }

      toast.success(
        `Payment recorded · ${created.receiptNumber ?? "no receipt"}`,
        created.receiptNumber && !andPrint
          ? {
              action: {
                label: "View receipt",
                onClick: () =>
                  window.open(`/receipts/${created.id}`, "_blank"),
              },
              duration: 8000,
            }
          : undefined,
      );
      onRecorded?.();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to record payment.",
      );
      // On error: KEEP the idempotency key. A retry through the same
      // form should still dedupe — what we want to dedupe is the
      // operator's intent, not the request envelope.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={student !== null}
      onClose={submitting ? () => {} : onClose}
      title={`Record payment${student ? ` — ${student.name}` : ""}`}
      description="Payments can apply to a specific fee or count as General Credit (auto-applied to the oldest unpaid fee)."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            type="button"
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSubmit(false)}
            loading={submitting}
            disabled={submitting}
            type="button"
          >
            {submitting ? "Saving…" : "Save"}
          </Button>
          {/* "Save & Print" — the primary action. The disabled-while-
              submitting state plus the server-side idempotency key
              means double-clicks can't create duplicate receipts. */}
          <Button
            onClick={() => handleSubmit(true)}
            loading={submitting}
            disabled={submitting}
            leftIcon={<Printer className="h-4 w-4" />}
            type="button"
          >
            {submitting ? "Printing…" : "Save & Print"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {report && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
            Assigned {formatMoney(report.totalAssigned)} · Paid{" "}
            {formatMoney(report.totalPaid)} ·{" "}
            <span className="font-semibold text-foreground">
              Due {formatMoney(report.totalDue)}
            </span>
            {report.totalCredit > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-primary">
                  General Credit {formatMoney(report.totalCredit)}
                </span>
              </>
            )}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Apply to fee (optional)
          </label>
          <select
            value={feeAssignmentId}
            onChange={(e) => {
              setFeeAssignmentId(e.target.value);
              const a = report?.assignments.find(
                (x) => x.id === e.target.value,
              );
              if (a) setAmount(a.remaining.toString());
            }}
            disabled={submitting}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          >
            <option value="">General Credit (auto-apply to oldest unpaid)</option>
            {report?.assignments
              .filter((a) => a.remaining > 0)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.feeStructureName} · due {a.dueDate} · {formatMoney(a.remaining)} remaining
                </option>
              ))}
          </select>
          {selectedAssignment && (
            <p className="text-xs text-muted-foreground">
              Remaining: {formatMoney(selectedAssignment.remaining)}
            </p>
          )}
        </div>
        {/* Smart fill helpers — render only once we have the report
            loaded so the action buttons can show meaningful numbers.
            Each button sets `amount` to a sensible target the cashier
            otherwise has to compute and type by hand. */}
        {report && (
          <SmartFillRow
            report={report}
            selectedAssignment={selectedAssignment}
            disabled={submitting}
            onFill={(value) =>
              setAmount(value > 0 ? value.toFixed(2) : "")
            }
          />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Amount"
            type="number"
            min={0.01}
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={submitting}
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
              <option value="">(not specified)</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank transfer</option>
              <option value="ESEWA">eSewa</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="text-sm font-medium text-foreground">
              Notes <span className="text-xs font-normal text-muted-foreground">(optional, printed on receipt)</span>
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
      </div>
    </Modal>
  );
}

// Centralized via `lib/currency.formatCurrency`.
const formatMoney = formatCurrency;

// ---------------------------------------------------------------------------
// SmartFillRow — quick-fill chips that pre-populate the Amount field.
//
// The cashier's most common workflow is "type the same number that's
// already on screen as 'remaining'." These chips do that with one click
// and remove a class of typo errors (off-by-one paisa, transposed
// digits) that would otherwise need a refund to fix.
//
// Buttons surface conditionally:
//   • "Pay Remaining"  — only when an assignment is selected. Fills the
//                        assignment's remaining balance.
//   • "Pay Full Due"   — only when there's a school-wide outstanding
//                        balance. Fills the student's total due (across
//                        ALL assignments). Useful when the parent walks
//                        in to clear the books.
//   • "Apply Credit"   — only when the student has unused General Credit.
//                        Fills `max(0, due − credit)` so the cashier
//                        only collects the residual after credit covers
//                        the rest. Helpful for "we have ₹500 sitting on
//                        their account, what's actually due?"
// ---------------------------------------------------------------------------

function SmartFillRow({
  report,
  selectedAssignment,
  disabled,
  onFill,
}: {
  report: StudentFeesReport;
  selectedAssignment: StudentFeesReport["assignments"][number] | null;
  disabled: boolean;
  onFill: (value: number) => void;
}) {
  const hasDue = report.totalDue > 0;
  const hasCredit = report.totalCredit > 0;
  const hasAssignment =
    selectedAssignment !== null && selectedAssignment.remaining > 0;

  // Nothing to suggest? Don't render the row at all — empty rails look
  // broken, and a fully-paid student doesn't need quick-fill chips.
  if (!hasDue && !hasCredit && !hasAssignment) return null;

  // "Apply Credit" target: due minus available credit, floored at 0.
  // The result is what the cashier still needs to collect; if credit
  // already exceeds the due, we suggest 0 — and the empty Amount field
  // is the natural surface for "no payment needed beyond credit."
  const creditAdjusted = Math.max(0, report.totalDue - report.totalCredit);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Quick fill
      </span>
      {hasAssignment && selectedAssignment && (
        <QuickFillChip
          label={`Pay remaining · ${formatMoney(selectedAssignment.remaining)}`}
          disabled={disabled}
          onClick={() => onFill(selectedAssignment.remaining)}
        />
      )}
      {hasDue && (
        <QuickFillChip
          label={`Pay full due · ${formatMoney(report.totalDue)}`}
          disabled={disabled}
          onClick={() => onFill(report.totalDue)}
          tone="primary"
        />
      )}
      {hasCredit && hasDue && creditAdjusted < report.totalDue && (
        <QuickFillChip
          label={`After credit · ${formatMoney(creditAdjusted)}`}
          disabled={disabled}
          onClick={() => onFill(creditAdjusted)}
          tone="muted"
          title={`Use ${formatMoney(report.totalCredit)} of credit on file; collect the residual.`}
        />
      )}
    </div>
  );
}

function QuickFillChip({
  label,
  onClick,
  disabled,
  tone = "muted",
  title,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  tone?: "primary" | "muted";
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
          : "border-border bg-surface text-foreground hover:border-primary/40 hover:text-primary",
      )}
    >
      {label}
    </button>
  );
}

"use client";

import * as React from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
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

  React.useEffect(() => {
    if (!student) return;
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

  const handleSubmit = async () => {
    if (!student) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a positive amount.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await feesApi.recordPayment({
        studentId: student.id,
        amount: n,
        date,
        feeAssignmentId: feeAssignmentId || undefined,
        method: method || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(
        `Payment recorded · ${created.receiptNumber ?? "no receipt"}`,
        created.receiptNumber
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
          <Button onClick={handleSubmit} loading={submitting} type="button">
            Record payment
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

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

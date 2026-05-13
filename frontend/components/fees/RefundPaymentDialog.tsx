"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { feesApi, type PaymentMethod } from "@/lib/fees";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

// ---------------------------------------------------------------------------
// RefundPaymentDialog — admin-only reversal flow.
//
// Why the UI carries the weight of the safety guards:
//
//   • The backend already enforces the financial invariants — refund
//     amount can't exceed the source, you can't refund a refund, you
//     can't refund the same payment twice. Those are hard rejections
//     that produce ugly toasts. The UI surfaces the same constraints
//     up-front so the cashier never *tries* an invalid refund and
//     hits a server-side 400.
//
//   • Refunds are audit-trail events. The required `reason` field +
//     destructive-toned button + warning banner together make it
//     impossible to refund accidentally without seeing the impact.
//     "Are you sure?" prompts are easy to dismiss; making the button
//     explicit ("Refund Rs 5,000.00") forces the operator to read the
//     amount before clicking.
//
//   • The original receipt is NEVER touched. We surface that prominently
//     in the warning banner — auditors will look for the original; it
//     stays valid forever. The refund slip is its own row, linked back
//     to the source via `refundOfPaymentId`.
//
// What happens after success:
//   • Toast with "View refund receipt" action — opens the new R-suffixed
//     receipt URL in a new tab, ready to print.
//   • Source row's status flips to REFUNDED on the backend; caller
//     refreshes its list to surface that.
//
// What this dialog DOESN'T do:
//   • Partial-refund-of-partial-refund: backend rejects refunds of
//     refunded payments, so it's not a UI surface here either.
//   • Multi-step "review" page: we use a single modal with a destructive
//     button + warning banner, which is the lighter-weight pattern that
//     still satisfies the spec's "require confirmation" requirement.
//     A two-step review screen would add clicks without adding safety
//     beyond what the explicit-amount button already provides.
// ---------------------------------------------------------------------------

export interface RefundPaymentDialogProps {
  /**
   * The payment to refund. `null` closes the dialog. The shape matches
   * what's available on both the Payment History row and the Receipt
   * page, so callers can wire either entry point without normalising.
   */
  payment: {
    id: string;
    receiptNumber: string | null;
    amount: number;
    date: string;
    method: PaymentMethod | null;
    feeName: string | null;
    studentName: string;
  } | null;
  onClose: () => void;
  /**
   * Called after a successful refund. Receives the new refund row's
   * ID + receipt number so the caller can navigate to the slip.
   */
  onRefunded?: (refund: {
    id: string;
    receiptNumber: string | null;
  }) => void;
}

const REASON_MIN_LENGTH = 5;

export function RefundPaymentDialog({
  payment,
  onClose,
  onRefunded,
}: RefundPaymentDialogProps) {
  // Form state. Reset whenever the modal opens against a different
  // payment so a previous attempt's data doesn't leak across.
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  // Phase FINAL-HARDENING Part 3: typed-confirmation. The cashier
  // must re-type the receipt number (or 'REFUND' if there's none)
  // BEFORE the destructive button enables. Prevents fast-click
  // mistakes where two refund dialogs are open in quick succession.
  const [typedConfirm, setTypedConfirm] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (payment) {
      // Default to a full refund — the most common case. Cashier can
      // edit down to a partial.
      setAmount(payment.amount.toFixed(2));
      setReason("");
      setNotes("");
      setTypedConfirm("");
    }
  }, [payment]);

  // The exact string the cashier must type. Receipt number is the
  // strongest identifier; fall back to a literal 'REFUND' for the
  // rare legacy row that lacks one. Compared case-sensitively
  // after trimming.
  const expectedConfirm = (payment?.receiptNumber ?? "REFUND").trim();
  const typedConfirmMatches =
    typedConfirm.trim() === expectedConfirm && expectedConfirm.length > 0;

  // Live validation. Pulled into a memo so the render path doesn't
  // recompute on every keystroke when only one field changed.
  const validation = React.useMemo(() => {
    if (!payment)
      return { valid: false, amountValid: true, reasonValid: true };
    const n = Number(amount);
    const numeric = Number.isFinite(n) && n > 0;
    const withinCap = numeric && n <= payment.amount + 0.0001;
    const reasonLong = reason.trim().length >= REASON_MIN_LENGTH;
    return {
      // Note: typed-confirm match is checked at the submit boundary,
      // NOT here — adding it to `valid` would re-run this memo on
      // every keystroke in the confirm field. The button's disabled
      // state ANDs them together at render time below.
      valid: numeric && withinCap && reasonLong,
      amountValid: numeric && withinCap,
      reasonValid: reasonLong,
      // The *displayable* error states only fire after the user has
      // touched the field — pure-validity flags above drive the
      // submit-button enable; these drive inline error copy.
      numeric,
      withinCap,
    };
  }, [amount, reason, payment]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment || submitting) return;
    // Phase FINAL-HARDENING Part 3: defence-in-depth — the button
    // is also disabled when the typed confirm doesn't match, but
    // a stray Enter on the reason textarea could still try to
    // submit. Block here too.
    if (!typedConfirmMatches) {
      toast.error(
        `Type the receipt number "${expectedConfirm}" to confirm the refund.`,
      );
      return;
    }
    if (!validation.valid) {
      // Defensive — the button is disabled when invalid, but a stray
      // Enter-press could still submit. Surface the first failing
      // condition so the cashier knows what's wrong.
      if (!validation.amountValid) {
        toast.error(
          `Refund amount must be between ${formatCurrency(0.01)} and ${formatCurrency(payment.amount)}.`,
        );
      } else if (!validation.reasonValid) {
        toast.error(`Reason must be at least ${REASON_MIN_LENGTH} characters.`);
      }
      return;
    }
    const refundAmount = Math.round(Number(amount) * 100) / 100;

    setSubmitting(true);
    try {
      const created = await feesApi.refundPayment(payment.id, {
        amount: refundAmount,
        reason: reason.trim(),
        notes: notes.trim() || undefined,
      });
      toast.success(
        `Refunded ${formatCurrency(refundAmount)} · ${created.receiptNumber ?? "no receipt"}`,
        created.receiptNumber
          ? {
              action: {
                label: "View refund slip",
                onClick: () =>
                  window.open(`/receipts/${created.id}`, "_blank"),
              },
              duration: 8000,
            }
          : undefined,
      );
      onRefunded?.({
        id: created.id,
        receiptNumber: created.receiptNumber,
      });
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to record refund.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const open = payment !== null;

  return (
    <Modal
      open={open}
      // Block close while a refund is mid-flight — losing the modal
      // mid-submit would leave the cashier wondering whether the refund
      // committed (it might have, or it might not).
      onClose={submitting ? () => {} : onClose}
      title="Refund payment"
      description="Creates a refund slip linked to the original receipt. The original stays valid for the audit trail."
      size="lg"
      footer={
        payment && (
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
              type="submit"
              form="refund-form"
              loading={submitting}
              // Phase FINAL-HARDENING Part 3: AND in the typed-
              // confirm match so the destructive button stays
              // disabled until the cashier proves intent by typing
              // the receipt number.
              disabled={
                submitting || !validation.valid || !typedConfirmMatches
              }
              variant="destructive"
              leftIcon={<RotateCcw className="h-4 w-4" />}
            >
              {submitting
                ? "Refunding…"
                : `Refund ${formatCurrency(Number(amount) || 0)}`}
            </Button>
          </>
        )
      }
    >
      {payment && (
        <form id="refund-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Original payment summary — read-only context block.
              Helps the cashier verify they're refunding the right
              transaction before they fill in the form. */}
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Original payment
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
              <span className="font-mono font-semibold text-foreground">
                {payment.receiptNumber ?? "(no receipt)"}
              </span>
              <span className="tabular-nums font-semibold text-foreground">
                {formatCurrency(payment.amount)}
              </span>
              <span className="text-muted-foreground">
                {payment.method ? methodLabel(payment.method) : "Method —"}
              </span>
              <span className="text-muted-foreground">{payment.date}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {payment.studentName}
              {payment.feeName ? (
                <>
                  {" · "}
                  {payment.feeName}
                </>
              ) : (
                <span className="italic"> · General Credit</span>
              )}
            </div>
          </div>

          {/* Form fields — amount first (cashier wants to see "what am
              I refunding?" before they justify it). */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Refund amount"
              type="number"
              min={0.01}
              max={payment.amount}
              step={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
              hint={`Cap: ${formatCurrency(payment.amount)} (full refund)`}
              error={
                amount && !validation.numeric
                  ? "Amount must be a positive number."
                  : amount && !validation.withinCap
                    ? `Cannot exceed the original payment (${formatCurrency(payment.amount)}).`
                    : undefined
              }
            />
            <button
              type="button"
              onClick={() => setAmount(payment.amount.toFixed(2))}
              disabled={submitting}
              className={cn(
                "self-end inline-flex items-center justify-center h-10 rounded-md border border-border bg-surface px-3 text-xs font-medium",
                "hover:border-primary/40 hover:text-primary transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              Reset to full refund
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="refund-reason"
              className="text-sm font-medium text-foreground"
            >
              Reason for refund{" "}
              <span className="text-destructive" aria-label="required">
                *
              </span>
            </label>
            <textarea
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              disabled={submitting}
              required
              minLength={REASON_MIN_LENGTH}
              placeholder="e.g. Parent overpaid by Rs 500 · Wrong fee assigned · Cheque bounced"
              className={cn(
                "w-full rounded-md border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary resize-none",
                reason.length > 0 && !validation.reasonValid
                  ? "border-destructive focus:border-destructive focus:ring-destructive/25"
                  : "border-border",
              )}
            />
            <p
              className={cn(
                "text-xs",
                reason.length > 0 && !validation.reasonValid
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {reason.length > 0 && !validation.reasonValid
                ? `Reason must be at least ${REASON_MIN_LENGTH} characters.`
                : "Recorded on the refund row for the audit trail. Auditors and parents will read this — be specific."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="refund-notes"
              className="text-sm font-medium text-foreground"
            >
              Internal notes{" "}
              <span className="text-xs font-normal text-muted-foreground">
                (optional, not printed on the slip)
              </span>
            </label>
            <textarea
              id="refund-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              disabled={submitting}
              placeholder="e.g. Parent prefers credit on next month · Refund handed over in cash"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary resize-none"
            />
          </div>

          {/* Phase FINAL-HARDENING Part 3 — typed-confirm.
              Required FINAL field. Forces the cashier to type the
              receipt number before the destructive button enables.
              Prevents fast-click mistakes (two refund dialogs open
              in quick succession; muscle memory clicks both). */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="refund-typed-confirm"
              className="text-sm font-medium text-foreground"
            >
              Type{" "}
              <span className="font-mono text-foreground">
                {expectedConfirm}
              </span>{" "}
              to confirm refund{" "}
              <span className="text-destructive" aria-label="required">
                *
              </span>
            </label>
            <input
              id="refund-typed-confirm"
              type="text"
              value={typedConfirm}
              onChange={(e) => setTypedConfirm(e.target.value)}
              disabled={submitting}
              placeholder={expectedConfirm}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "h-10 w-full rounded-md border bg-surface px-3 text-sm font-mono",
                "focus:outline-none focus:ring-2 focus:ring-destructive/25",
                typedConfirm.length > 0 && !typedConfirmMatches
                  ? "border-destructive focus:border-destructive"
                  : typedConfirmMatches
                    ? "border-destructive/50"
                    : "border-border",
              )}
            />
            <p className="text-xs text-muted-foreground">
              {typedConfirmMatches
                ? "Match confirmed — refund button is now enabled."
                : "The destructive button stays disabled until this matches."}
            </p>
          </div>

          {/* Warning banner — explicit about the audit-trail behaviour.
              Two key messages:
                1. The original receipt is NOT deleted (auditors expect this)
                2. A NEW refund slip is created (with its own receipt #)
              Bottom line: refunds are reversals, not erasures. */}
          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/50 p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
            <div className="text-xs text-amber-900 leading-relaxed">
              <span className="font-semibold">This action cannot be undone.</span>{" "}
              The original receipt {payment.receiptNumber ?? ""} stays valid
              for the audit trail. A new refund slip will be created with its
              own number, linked back to the original.
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function methodLabel(m: PaymentMethod): string {
  switch (m) {
    case "CASH":
      return "Cash";
    case "BANK":
      return "Bank transfer";
    case "ESEWA":
      return "eSewa";
    case "OTHER":
      return "Other";
  }
}

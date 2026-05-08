"use client";

import * as React from "react";
import {
  CheckCircle2,
  Printer,
  ExternalLink,
  MessageCircle,
  Smartphone,
  ArrowRight,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import type { StudentDto } from "@/lib/students";

// ---------------------------------------------------------------------------
// PaymentSuccessPanel — the calm "you're done, what's next?" surface.
//
// Renders after a payment commits. Critical UX rules:
//   • DOES NOT navigate the cashier away. The previous workflow (toast
//     + close modal) lost context after a save — the next student
//     started from a blank workspace. This panel keeps the receipt
//     summary visible and gives explicit "next step" buttons.
//   • Continue-to-next-student is the primary action (right-most,
//     primary-tone) because that's the most common follow-up during a
//     fee-collection rush.
//   • Print + Reprint are visually distinct: Print is the receipt's
//     direct-print URL; Reprint is the ?print=1 auto-print URL —
//     identical from the user's POV but the latter signals "for the
//     parent who walked off without a copy."
//   • WhatsApp share + SMS-ready fallback target the same use case
//     ("send the parent a confirmation"); we offer both because not
//     every Nepal school admin has WhatsApp available on their device.
//
// State lives entirely in the parent — this component is a presentational
// surface that fires callbacks for each action.
// ---------------------------------------------------------------------------

export interface PaymentSuccessPanelProps {
  /** The just-recorded payment we'll show + offer follow-up actions for. */
  payment: {
    id: string;
    receiptNumber: string | null;
    amount: number;
    date: string;
  };
  student: StudentDto;
  /** Total due AFTER this payment. Surfaces in the SMS-ready text. */
  remainingAfterPayment: number;
  /** Continue → reset and start a fresh search. */
  onContinue: () => void;
  /** Optional class name passthrough. */
  className?: string;
}

export function PaymentSuccessPanel({
  payment,
  student,
  remainingAfterPayment,
  onContinue,
  className,
}: PaymentSuccessPanelProps) {
  const receiptUrl = `/receipts/${payment.id}`;
  const printUrl = `/receipts/${payment.id}?print=1`;

  const studentName = `${student.firstName} ${student.lastName}`;
  const summaryText = buildSummaryText({
    studentName,
    receiptNumber: payment.receiptNumber,
    amount: payment.amount,
    remaining: remainingAfterPayment,
  });

  return (
    <div
      className={cn(
        "rounded-xl border border-emerald-300/70 bg-emerald-50/50 p-5 sm:p-6",
        "shadow-sm animate-fade-in-up",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-foreground">
            Payment recorded
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {payment.receiptNumber ? (
              <>
                Receipt{" "}
                <span className="font-mono font-semibold text-foreground">
                  {payment.receiptNumber}
                </span>{" "}
                · {formatCurrency(payment.amount)} from {studentName}
              </>
            ) : (
              <>
                {formatCurrency(payment.amount)} from {studentName}
              </>
            )}
          </p>
          {remainingAfterPayment > 0 ? (
            <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
              Balance now: {formatCurrency(remainingAfterPayment)}
            </p>
          ) : (
            <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Account cleared
            </p>
          )}
        </div>
      </div>

      {/* Action grid. Two rows on mobile, one row on desktop. The
          primary "Continue" button ends the row so it gets the
          rightmost natural focus on tab order. */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <ActionButton
          href={printUrl}
          icon={<Printer className="h-4 w-4" />}
          label="Print"
          tone="solid"
          // Open in new tab so the workspace state is preserved if the
          // print dialog blocks the underlying tab.
          newTab
        />
        <ActionButton
          href={receiptUrl}
          icon={<ExternalLink className="h-4 w-4" />}
          label="View receipt"
          tone="outline"
          newTab
        />
        <WhatsAppButton phone={student.contactNumber} text={summaryText} />
        <CopySmsButton text={summaryText} />
        <button
          type="button"
          onClick={onContinue}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-10 rounded-md text-sm font-semibold",
            "bg-foreground text-background shadow-sm",
            "hover:bg-foreground/90 active:scale-[0.98] transition-all",
            // Spans both columns on mobile for a fat "Next" button.
            "col-span-2 sm:col-span-1",
          )}
        >
          Next student
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action buttons. Two flavors: link-based (Print, View) and JS-based
// (WhatsApp, SMS). All are visually consistent — same height, same
// icon + label pattern.
// ---------------------------------------------------------------------------

function ActionButton({
  href,
  icon,
  label,
  tone,
  newTab,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  tone: "solid" | "outline";
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noopener noreferrer" : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-10 rounded-md text-sm font-semibold transition-all",
        "active:scale-[0.98]",
        tone === "solid"
          ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-600/90"
          : "border border-border bg-surface text-foreground hover:border-primary/40 hover:text-primary",
      )}
    >
      {icon}
      {label}
    </a>
  );
}

/**
 * WhatsApp deep-link. Falls back to wa.me with no recipient if the
 * student has no phone on file — the cashier can pick the recipient
 * inside WhatsApp.
 *
 * Phone normalisation: WhatsApp's wa.me requires E.164 without the
 * leading "+" (e.g. 9779801234567). Nepal numbers commonly come in
 * without a country code in the school DB; we prefix `977` only when
 * the number doesn't already start with one. Imperfect but handles
 * the 95% case.
 */
function WhatsAppButton({
  phone,
  text,
}: {
  phone: string | null;
  text: string;
}) {
  const number = phone ? normalisePhoneForWhatsapp(phone) : "";
  const url = number
    ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={
        number
          ? `Send via WhatsApp to ${phone}`
          : "Open WhatsApp — no phone on file"
      }
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-10 rounded-md text-sm font-semibold transition-all",
        "border border-border bg-surface text-foreground hover:border-primary/40 hover:text-primary active:scale-[0.98]",
      )}
    >
      <MessageCircle className="h-4 w-4" />
      WhatsApp
    </a>
  );
}

/**
 * Copies the SMS-ready summary text to the clipboard. We don't open
 * the OS SMS app directly because:
 *   • `sms:?body=…` doesn't work consistently on desktop browsers.
 *   • Cashiers commonly prefer to paste into whatever messaging
 *     surface they're already using (Viber, school SMS gateway, etc.).
 * Copy-to-clipboard is universal and lets the cashier paste anywhere.
 */
function CopySmsButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied SMS-ready summary");
      // Reset the icon after a moment so a second copy doesn't look
      // stuck in the "copied" state.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the text manually.");
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy SMS-ready summary text"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-10 rounded-md text-sm font-semibold transition-all",
        "border border-border bg-surface text-foreground hover:border-primary/40 hover:text-primary active:scale-[0.98]",
      )}
    >
      {copied ? <Check className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
      {copied ? "Copied" : "SMS text"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the parent-facing confirmation text used by both WhatsApp and
 * SMS-copy actions. Kept short — most SMS gateways limit to ~160 chars
 * before splitting; we aim for a single segment.
 */
function buildSummaryText(input: {
  studentName: string;
  receiptNumber: string | null;
  amount: number;
  remaining: number;
}): string {
  const lines = [
    `Payment received for ${input.studentName}.`,
    `Amount: ${formatCurrency(input.amount)}.`,
    input.receiptNumber ? `Receipt: ${input.receiptNumber}.` : null,
    input.remaining > 0
      ? `Balance: ${formatCurrency(input.remaining)}.`
      : `Account cleared. Thank you.`,
  ];
  return lines.filter(Boolean).join(" ");
}

/**
 * Normalise a phone number for wa.me. Strips spaces / dashes / parens,
 * drops the leading "+" if present, and prepends "977" (Nepal country
 * code) when the number looks like a 10-digit local number.
 *
 * Doesn't validate — wa.me is forgiving and an invalid number just
 * opens WhatsApp without a recipient prefilled.
 */
function normalisePhoneForWhatsapp(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  // Already has a country code (≥ 11 digits and doesn't look like a
  // domestic-only Nepali number) — pass through.
  if (digits.length >= 11) return digits;
  // Looks like a 10-digit Nepali mobile (98XXXXXXXX). Prepend 977.
  if (digits.length === 10 && digits.startsWith("9")) return `977${digits}`;
  return digits;
}

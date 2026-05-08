"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Printer,
  Download,
  ArrowLeft,
  AlertTriangle,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { getStoredUser, getToken } from "@/lib/auth";
import {
  feesApi,
  type Receipt,
  type PaymentMethod,
  type ReceiptStatus,
} from "@/lib/fees";
import { DocumentLogo } from "@/components/documents/DocumentLogo";
import { formatDual } from "@/lib/date";
import { amountInWords } from "@/lib/amount-in-words";
import { formatCurrency } from "@/lib/currency";
import { RefundPaymentDialog } from "@/components/fees/RefundPaymentDialog";

// ---------------------------------------------------------------------------
// Production fee receipt
//
// Goals
// ─────
//   • Print-perfect on A4 — receipt stays on a single page when there are
//     ≤ 6 line items, gracefully wraps to a second page beyond that.
//   • Audit-safe — every field that signals "this is the real document"
//     (receipt #, date, status, amount in words, signatures, verification
//     URL) is rendered the same on screen as on paper.
//   • Grayscale-only — schools print on cheap inkjets and laser printers
//     that mangle color. No color carries meaning. Borders, weight, and
//     spacing carry the hierarchy.
//
// Layout (top to bottom)
// ──────────────────────
//   <Header>           Logo · school identity · receipt meta · status badge
//   <StudentSection>   Name / Class / Roll
//   <ChargesTable>     Multi-line fees with paid-this-receipt + remaining
//   <BalanceSummary>   Previous due / paid now / remaining
//   <FooterMeta>       Amount in words · note · 3-block signature/stamp
//   <Verification>     Receipt # echo + verification URL (audit trail)
// ---------------------------------------------------------------------------

export default function ReceiptPage() {
  const params = useParams<{ paymentId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const [data, setData] = React.useState<Receipt | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Refund dialog state. Open against the current receipt; backend
  // role-gates the actual write but the toolbar button is hidden for
  // non-admins so they don't see a state they can't act on.
  const [refundOpen, setRefundOpen] = React.useState(false);
  const isAdmin = React.useMemo(
    () => getStoredUser()?.role === "ADMIN",
    [],
  );
  // Eligible for refund: positive-amount, non-refund-slip rows shown
  // to an admin. The Receipt response doesn't carry the row's
  // lifecycle status (ACTIVE/REFUNDED/VOID) — `ReceiptStatus` is a
  // fee-balance derivative, not a row state — so we don't try to
  // pre-empt the "already refunded" case here. The backend returns a
  // clean 409 ("This payment has already been refunded.") which the
  // global error toast surfaces unchanged. Better to show the button
  // and let a rare race-loser see a toast than to add a separate
  // lifecycle field to the Receipt response just for this gate.
  const eligibleForRefund =
    isAdmin && !!data && data.amount > 0 && !data.isRefund;

  // `?print=1` triggers the print dialog as soon as the receipt finishes
  // loading. Used by the "Save & Print" affordance on the payment form
  // so the cashier doesn't have to click again. Only fires once per
  // visit — the data dependency guards against double-firing on rerender.
  const autoPrint = search?.get("print") === "1";

  // Track whether this receipt has been printed before. The first load
  // (right after Save & Print) is the original; any subsequent load
  // gets a "DUPLICATE COPY" watermark so a parent can't be tricked into
  // thinking a reprint is the original. Storage is per-browser; a fresh
  // device shows no watermark, but the receipt number itself is still
  // unique and verifiable via the QR-equivalent URL on the slip.
  const [isDuplicate, setIsDuplicate] = React.useState(false);
  const printedKey = React.useMemo(
    () => (params?.paymentId ? `scholaris:printed:${params.paymentId}` : null),
    [params?.paymentId],
  );
  React.useEffect(() => {
    if (!printedKey) return;
    try {
      if (window.localStorage.getItem(printedKey)) setIsDuplicate(true);
    } catch {
      /* storage unavailable — original-vs-duplicate just won't be tracked */
    }
  }, [printedKey]);

  React.useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!params?.paymentId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await feesApi.getReceipt(params.paymentId);
        if (!cancelled) setData(r);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Failed to load receipt.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.paymentId, router]);

  // Auto-print fires once after data lands. We can't print before then —
  // the dialog would capture an empty skeleton. Microtask delay lets the
  // browser paint the receipt at least once before opening the dialog.
  React.useEffect(() => {
    if (!autoPrint || !data) return;
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, [autoPrint, data]);

  // Mark this receipt as "printed" the first time the user actually
  // prints it. Listening to `afterprint` is more accurate than firing
  // on the toolbar click — a user who hits Print then cancels the
  // dialog hasn't actually produced a slip and shouldn't trigger the
  // duplicate flag on the next visit.
  React.useEffect(() => {
    if (!printedKey) return;
    const handler = () => {
      try {
        window.localStorage.setItem(printedKey, "1");
      } catch {
        /* storage unavailable — fail silently */
      }
    };
    window.addEventListener("afterprint", handler);
    return () => window.removeEventListener("afterprint", handler);
  }, [printedKey]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Preparing receipt…</span>
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
            Couldn&apos;t load receipt
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
      {/*
        Print stylesheet. A few non-obvious choices:
          • `print-color-adjust: exact` keeps the dark "Total Paid" footer
            row solid black on print — Chrome/Edge default to "economy"
            which strips backgrounds, breaking the contrast we rely on.
          • `page-break-inside: avoid` is set on every receipt section so
            the printer never splits a sub-block (e.g. signatures cut in
            half across pages).
          • The receipt is laid out in three "logical pages" of ~A4 height;
            anything beyond that lets the printer wrap naturally rather
            than fight it.
      */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          html, body { background: white !important; }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .receipt {
            box-shadow: none !important;
            margin: 0 !important;
            border: none !important;
            page-break-after: avoid;
          }
          .receipt > section,
          .receipt > header {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          tr, td, th {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      <div className="min-h-screen bg-muted/40 py-8 print:bg-white print:py-0">
        {/* Toolbar — hidden on print */}
        <div className="no-print mx-auto mb-4 flex max-w-[780px] items-center justify-between px-6">
          <Link
            href={`/fees/${data.student.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to student fees
          </Link>
          <div className="flex items-center gap-2">
            {/* Refund button — admin-only. Outline tone with destructive
                hover-color so it sits visually below Download/Print but
                signals "irreversible" on hover. Backend rejects with a
                clean 409 if the row was already refunded, so a stale
                tab won't corrupt anything. */}
            {eligibleForRefund && (
              <button
                type="button"
                onClick={() => setRefundOpen(true)}
                title="Refund this payment"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-medium text-foreground shadow-xs hover:border-destructive/60 hover:text-destructive active:scale-[0.98] transition-all"
              >
                <RotateCcw className="h-4 w-4" />
                Refund
              </button>
            )}
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

        <article className="receipt relative mx-auto max-w-[780px] bg-white shadow-sm print:shadow-none border border-slate-300 text-slate-900 overflow-hidden">
          {/* Duplicate watermark — diagonal, low-opacity, behind the
              content. Only renders on a re-load AFTER the receipt has
              been printed at least once on this browser. The afterprint
              listener flips the storage flag so the watermark appears
              from the SECOND visit onward. Pointer-events disabled so
              it can't intercept clicks on the toolbar. */}
          {isDuplicate && <DuplicateWatermark />}

          {/* Refund banner — sits ABOVE the header so it can't be missed
              when the cashier hands the slip across. Only renders for
              negative-amount payments. */}
          {data.isRefund && (
            <div className="relative z-10 border-b-2 border-slate-900 bg-slate-900 px-10 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.3em] text-white">
              Refund · Original payment reversed
            </div>
          )}

          <div className="relative z-10">
            <Header data={data} />
            <StudentSection data={data} />
            <ChargesTable data={data} />
            <BalanceSummary data={data} />
            <FooterMeta data={data} />
            <Verification data={data} />
          </div>
        </article>
      </div>

      {/* Refund dialog — admin-only entry from the toolbar above.
          After a successful refund we navigate to the new refund slip
          (in a new tab) so the cashier can immediately print it for
          the parent. The current tab stays on the source receipt so
          the audit trail (original + refund) is visible side-by-side. */}
      <RefundPaymentDialog
        payment={
          refundOpen && data
            ? {
                id: data.paymentId,
                receiptNumber: data.receiptNumber,
                amount: data.amount,
                date: data.date,
                method: data.method,
                feeName: data.feeStructure?.name ?? null,
                studentName: `${data.student.firstName} ${data.student.lastName}`,
              }
            : null
        }
        onClose={() => setRefundOpen(false)}
        onRefunded={(refund) => {
          // Open the refund slip so the cashier can hand the parent
          // a printable reversal. Source tab stays put — refreshing
          // it would be ideal to surface the REFUNDED state, but the
          // receipt page doesn't currently re-fetch on action. Adding
          // that would require lifting the loader; deferred.
          window.open(`/receipts/${refund.id}?print=1`, "_blank");
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Duplicate watermark — large diagonal text behind the receipt body.
//
// Renders only on a reprint (afterprint flag has been set previously
// on this browser). Designed to survive black-and-white printing — the
// fill is a low-opacity gray so it photocopies as a faint imprint, not
// invisible and not so dark it eats the readable text.
// ---------------------------------------------------------------------------

function DuplicateWatermark() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden select-none"
    >
      <span className="rotate-[-22deg] whitespace-nowrap text-[80px] font-extrabold uppercase tracking-[0.18em] text-slate-900/[0.06]">
        Duplicate Copy
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({ data }: { data: Receipt }) {
  const { school } = data;
  return (
    <header className="border-b border-slate-300 px-10 py-6">
      <div className="grid grid-cols-[auto_1fr] items-start gap-6">
        {/* Identity block — logo + school name + address + phone. */}
        <div className="flex items-start gap-5">
          <DocumentLogo logoUrl={school.logoUrl} />
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-slate-900 uppercase leading-tight">
              {school.name}
            </h1>
            {school.address && (
              <p className="mt-1 text-[12px] text-slate-700 leading-snug max-w-[42ch]">
                {school.address}
              </p>
            )}
            {school.phone && (
              <p className="mt-0.5 text-[12px] text-slate-700">
                <span className="text-slate-500">Phone:</span> {school.phone}
              </p>
            )}
          </div>
        </div>

        {/* Receipt meta block — # / date / method, with status badge
            anchored above. The badge uses border + weight rather than fill
            color so it survives grayscale printing. */}
        <aside className="justify-self-end text-right">
          <StatusBadge status={data.status} isRefund={data.isRefund} />
          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Receipt
          </p>
          <dl className="mt-2 inline-grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-[12px]">
            <MetaRow
              label="Receipt No."
              value={
                <span className="font-mono font-semibold text-slate-900">
                  {data.receiptNumber}
                </span>
              }
            />
            <MetaRow label="Date" value={formatDual(data.date)} />
            <MetaRow
              label="Method"
              value={data.method ? formatMethod(data.method) : "—"}
            />
          </dl>
        </aside>
      </div>
    </header>
  );
}

function StatusBadge({
  status,
  isRefund,
}: {
  status: ReceiptStatus;
  isRefund: boolean;
}) {
  if (isRefund) {
    return (
      <span className="inline-flex items-center rounded-sm border-2 border-slate-900 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-900">
        Refund
      </span>
    );
  }
  const labels: Record<ReceiptStatus, string> = {
    PAID_IN_FULL: "Paid in Full",
    PARTIAL: "Partial Payment",
    BALANCE_DUE: "Balance Due",
  };
  // PAID_IN_FULL gets the inverted treatment to read as "settled" at
  // a glance. The other two stay outlined — no fill, no color.
  const filled = status === "PAID_IN_FULL";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border-2 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.2em]",
        filled
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-900 bg-white text-slate-900",
      )}
    >
      {labels[status]}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500 text-left">{label}</dt>
      <dd className="text-slate-900 font-medium tabular-nums">{value}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// Student section
// ---------------------------------------------------------------------------

function StudentSection({ data }: { data: Receipt }) {
  const { student } = data;
  const className = student.section
    ? `${student.section.className} · ${student.section.name}`
    : "—";

  return (
    <section className="grid grid-cols-3 gap-6 border-b border-slate-300 px-10 py-5">
      <Field label="Student Name">
        {student.firstName} {student.lastName}
      </Field>
      <Field label="Class / Section">{className}</Field>
      <Field label="Roll No.">
        {student.symbolNumber ? (
          <span className="font-mono">{student.symbolNumber}</span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </Field>
    </section>
  );
}

function Field({
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
      <p className="mt-1 text-[14px] font-medium text-slate-900">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charges table — multi-line fee support
//
// Three columns: Description / Status / Amount. The Status column carries
// "Paid" / "Partial" / "Due" labels for non-focal lines, which lets the
// receipt double as a mini ledger. The line that THIS payment landed on
// is marked with a left-edge bar so it stands out without color.
//
// When there's no fee assignment (general credit), we render a single
// "General Credit Payment" line so the table never collapses to empty.
// ---------------------------------------------------------------------------

function ChargesTable({ data }: { data: Receipt }) {
  const lines = data.lineItems;
  const hasLines = lines.length > 0;

  return (
    <section className="px-10 py-6 border-b border-slate-300">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b-2 border-slate-900">
            <th className="py-2 pr-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
              Description
            </th>
            <th className="py-2 px-4 text-center text-[11px] font-bold uppercase tracking-wider text-slate-700 w-[110px]">
              Status
            </th>
            <th className="py-2 pl-4 text-right text-[11px] font-bold uppercase tracking-wider text-slate-700 w-[140px]">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {hasLines ? (
            lines.map((li) => <FeeLineRow key={li.feeAssignmentId} line={li} />)
          ) : (
            <tr className="border-b border-slate-200">
              <td className="py-2.5 pr-4 text-slate-900">
                General Credit Payment
                {data.notes && (
                  <span className="block text-[11px] italic text-slate-500 mt-0.5">
                    Note: {data.notes}
                  </span>
                )}
              </td>
              <td className="py-2.5 px-4 text-center">
                <LineStatusChip status="PARTIAL" />
              </td>
              <td className="py-2.5 pl-4 text-right tabular-nums text-slate-900">
                {formatMoney(data.amount)}
              </td>
            </tr>
          )}

          {/* Receipt-level note when there's a multi-line table — kept
              inside the table so it prints with the rows. */}
          {hasLines && data.notes && (
            <tr className="border-b border-slate-200">
              <td colSpan={3} className="py-2 pr-4 text-slate-500 text-[11px] italic">
                Note: {data.notes}
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-900 bg-slate-900 text-white">
            <th
              colSpan={2}
              className="py-3 pr-4 pl-3 text-left text-[12px] font-bold uppercase tracking-wider"
            >
              Total Paid (this receipt)
            </th>
            <td className="py-3 pr-3 pl-4 text-right text-[16px] font-bold tabular-nums">
              {formatMoney(data.amount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function FeeLineRow({ line }: { line: import("@/lib/fees").ReceiptLineItem }) {
  const showsDiscount = line.discountAmount > 0;
  return (
    <>
      <tr
        className={cn(
          "border-b border-slate-200",
          // Focal line = the assignment this payment was applied to.
          // A solid left edge (no color, just weight) flags it without
          // breaking grayscale.
          line.isFocal && "bg-slate-50",
        )}
      >
        <td
          className={cn(
            "py-2.5 pr-4 text-slate-900",
            line.isFocal && "border-l-[3px] border-slate-900 pl-3",
          )}
        >
          <div className="font-medium">{line.feeName}</div>
          <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
            Base {formatMoney(line.baseAmount)}
            {showsDiscount && (
              <>
                {" "}
                · Discount −{formatMoney(line.discountAmount)}
              </>
            )}
            {line.paidThisReceipt > 0 && (
              <>
                {" "}
                · <span className="font-semibold text-slate-900">
                  This receipt {formatMoney(line.paidThisReceipt)}
                </span>
              </>
            )}
          </div>
        </td>
        <td className="py-2.5 px-4 text-center">
          <LineStatusChip status={line.status} />
        </td>
        <td className="py-2.5 pl-4 text-right tabular-nums">
          <div className="font-semibold text-slate-900">
            {formatMoney(line.finalAmount)}
          </div>
          {line.remaining > 0 ? (
            <div className="text-[11px] text-slate-500 mt-0.5">
              Remaining {formatMoney(line.remaining)}
            </div>
          ) : (
            <div className="text-[11px] text-slate-700 font-medium mt-0.5">
              Fully paid
            </div>
          )}
        </td>
      </tr>
    </>
  );
}

function LineStatusChip({
  status,
}: {
  // Receipt-line statuses are a snapshot in time, not "as of now". The
  // backend collapses DUE_SOON and OVERDUE into PARTIAL/UNPAID for the
  // line-item view because urgency-flavoured chips (red/amber) on a
  // historical slip would mislead — a fee that was DUE_SOON when the
  // receipt issued is just "PARTIAL or UNPAID at receipt time" forever.
  status: import("@/lib/fees").AssignmentStatus;
}) {
  // PARTIAL covers anything that has at least one payment but isn't
  // fully cleared. DUE_SOON / OVERDUE are urgency hints relative to
  // today — irrelevant on a historical slip, so we collapse to the
  // closest snapshot-time state for chip display.
  const collapsed: "PAID" | "PARTIAL" | "UNPAID" =
    status === "PAID"
      ? "PAID"
      : status === "PARTIAL" || status === "OVERDUE"
        ? "PARTIAL"
        : "UNPAID";
  const map = {
    PAID: { label: "Paid", style: "border-slate-900 bg-slate-900 text-white" },
    PARTIAL: {
      label: "Partial",
      style: "border-slate-900 bg-white text-slate-900",
    },
    UNPAID: {
      label: "Due",
      style:
        "border-slate-400 bg-white text-slate-600 border-dashed",
    },
  } as const;
  const { label, style } = map[collapsed];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        style,
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Balance summary
// ---------------------------------------------------------------------------

function BalanceSummary({ data }: { data: Receipt }) {
  const { previousDue, paidNow, remainingBalance } = data.ledger;
  const expectedRemaining = Math.max(0, previousDue - paidNow);
  const reconciles = Math.abs(expectedRemaining - remainingBalance) < 0.01;

  return (
    <section className="px-10 py-5 border-b border-slate-300">
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
        Account Summary
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-4">
        <SummaryStat label="Previous Due" value={previousDue} />
        <SummaryStat label="Paid Now" value={paidNow} emphasised />
        <SummaryStat
          label="Remaining Balance"
          value={remainingBalance}
          emphasised={remainingBalance === 0}
          trailing={
            remainingBalance === 0 ? (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-slate-900 border border-slate-900 px-1.5 py-0.5 rounded-sm">
                Cleared
              </span>
            ) : null
          }
        />
      </dl>
      {!reconciles && (
        <p className="mt-3 text-[10px] text-slate-500 italic">
          Note: balance reflects assignments active at the time of payment.
        </p>
      )}
      {data.ledger.creditBalance > 0 && (
        <p className="mt-2 text-[10px] text-slate-500">
          Unallocated credit on file: {formatMoney(data.ledger.creditBalance)}
        </p>
      )}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  emphasised,
  trailing,
}: {
  label: string;
  value: number;
  emphasised?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 tabular-nums text-slate-900",
          emphasised
            ? "text-[18px] font-bold"
            : "text-[15px] font-semibold",
        )}
      >
        {formatMoney(value)}
        {trailing}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer — amount in words + 3-block signature/stamp + boilerplate
// ---------------------------------------------------------------------------

function FooterMeta({ data }: { data: Receipt }) {
  const inWords = amountInWords(Math.abs(data.amount));

  return (
    <section className="px-10 py-6 border-b border-slate-300">
      {/* Amount in words — the tamper-defeating attestation */}
      <div className="border-y border-dashed border-slate-300 py-3">
        <div className="flex items-baseline gap-2 text-[12px]">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
            In Words
          </span>
          <span className="text-slate-900 font-medium italic">
            {data.isRefund && "Refund of "}{inWords}
          </span>
        </div>
      </div>

      {/* Footer note */}
      <p className="mt-5 text-[11px] text-slate-600 leading-relaxed text-center max-w-[520px] mx-auto">
        This is a computer-generated receipt. Please retain it for your
        records. Subject to clearance of any cheque or online transfer.
      </p>

      {/* Three-block signature/stamp layout. Center column is the stamp
          target — bigger square outline so a wet stamp doesn't crowd
          the signature lines. Equal column widths via grid-cols-3 so
          the layout stays balanced regardless of label length. */}
      <div className="mt-10 grid grid-cols-3 gap-8">
        <SignatureLine label="Received by (Accountant)" />
        <StampBox label="School Stamp" />
        <SignatureLine label="Authorized Signatory" />
      </div>
    </section>
  );
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div className="text-center self-end">
      <div className="h-12 border-b border-slate-500" />
      <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </p>
    </div>
  );
}

function StampBox({ label }: { label: string }) {
  return (
    <div className="text-center">
      {/* A square dashed box, sized to fit a typical wet stamp (~3cm).
          Dashed so it's clearly a placeholder; nobody mistakes it for
          a legitimate stamp impression. */}
      <div className="mx-auto h-[68px] w-[68px] rounded-full border border-dashed border-slate-400" />
      <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification strip — receipt # echo + verification URL.
//
// Lives at the very bottom of the slip so a photocopy that crops the
// header still surfaces the canonical identifier. The verification URL
// (when configured) lets recipients confirm the slip on the school's
// public site without needing a QR scanner.
// ---------------------------------------------------------------------------

function Verification({ data }: { data: Receipt }) {
  return (
    <section className="px-10 py-3 text-[9px] uppercase tracking-[0.25em] text-slate-400 text-center">
      <div>
        {data.school.name} · Receipt {data.receiptNumber}
        {/* Cashier audit echo. Lives at the bottom of the slip alongside
            the receipt # so a paper trail can answer "who took this in?"
            even when the top half is cropped or photocopied separately.
            Email is the recognisable identifier — admins know each other
            by it. Suppressed for legacy rows that pre-date audit fields. */}
        {data.cashier && (
          <>
            {" · "}Received by {data.cashier.email}
          </>
        )}
      </div>
      {data.verificationUrl && (
        <div className="mt-1 normal-case tracking-normal text-[10px] text-slate-500">
          Verify at{" "}
          <span className="font-mono">{data.verificationUrl}</span>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMethod(method: PaymentMethod): string {
  switch (method) {
    case "CASH":
      return "Cash";
    case "BANK":
      return "Bank Transfer";
    case "ESEWA":
      return "eSewa";
    case "OTHER":
      return "Other";
  }
}

// Centralized via `lib/currency.formatCurrency` — prepends the `रु.`
// symbol and applies South-Asian digit grouping. Receipt-critical: the
// figure on the slip and the amount-in-words must agree to the paisa,
// which the `formatCurrency` 2dp rounding guarantees.
const formatMoney = formatCurrency;

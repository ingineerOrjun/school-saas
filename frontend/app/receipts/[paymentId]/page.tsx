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
  BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { feesApi, type Receipt, type PaymentMethod } from "@/lib/fees";
import { DocumentLogo } from "@/components/documents/DocumentLogo";

export default function ReceiptPage() {
  const params = useParams<{ paymentId: string }>();
  const router = useRouter();
  const [data, setData] = React.useState<Receipt | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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
          setError(err instanceof ApiError ? err.message : "Failed to load receipt.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.paymentId, router]);

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
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .receipt { box-shadow: none !important; margin: 0 !important; border: 1px solid #111 !important; }
          tr, td { page-break-inside: avoid; break-inside: avoid; }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      <div className="min-h-screen bg-muted/40 py-8">
        <div className="no-print mx-auto mb-4 flex max-w-[780px] items-center justify-between px-6">
          <Link
            href={`/fees/${data.student.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to student fees
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

        <article className="receipt relative mx-auto max-w-[780px] bg-white shadow-sm print:shadow-none border border-slate-300 text-slate-900 overflow-hidden">
          <Watermark schoolName={data.school.name} />

          <Header data={data} />
          <StudentSection data={data} />
          <PaymentSection data={data} />
          <Footer data={data} />
        </article>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Header({ data }: { data: Receipt }) {
  return (
    <header className="relative border-b-2 border-slate-900 px-10 py-7">
      {/* Stabilized 3-col grid identical to the marksheet/ledger
          header: fixed 64px logo, centered title capped at 60% width
          with line-clamp, fixed 64px spacer on the right to keep the
          title optically centered. */}
      <div className="grid grid-cols-[64px_1fr_64px] items-center gap-6">
        <DocumentLogo logoUrl={data.school.logoUrl} />
        <div className="min-w-0 mx-auto max-w-[60%] text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
            Payment Receipt
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 uppercase line-clamp-2 text-balance break-words">
            {data.school.name}
          </h1>
        </div>
        {/* Spacer matches the logo's footprint so the title block stays
            optically centered on the page. */}
        <div className="h-16 w-16 shrink-0" aria-hidden />
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Receipt no.
          </p>
          <p className="mt-0.5 font-mono text-base font-semibold tracking-wider text-slate-900">
            {data.receiptNumber}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Date
          </p>
          <p className="mt-0.5 font-mono text-sm text-slate-900">
            {formatDate(data.date)}
          </p>
        </div>
      </div>
    </header>
  );
}

function StudentSection({ data }: { data: Receipt }) {
  return (
    <section className="relative px-10 py-5 border-b border-slate-200">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Received from
      </p>
      <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <InfoField label="Student">
          {data.student.firstName} {data.student.lastName}
        </InfoField>
        <InfoField label="Symbol no.">
          {data.student.symbolNumber ? (
            <span className="rounded border border-slate-400 bg-slate-50 px-1.5 py-0.5 font-mono text-sm text-slate-900">
              {data.student.symbolNumber}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </InfoField>
        <InfoField label="Class / Section">
          {data.student.section
            ? `${data.student.section.className} · ${data.student.section.name}`
            : "—"}
        </InfoField>
      </div>
    </section>
  );
}

function PaymentSection({ data }: { data: Receipt }) {
  const fd = data.feeDetail;
  const hasDiscount = !!fd && fd.discountAmount > 0;

  return (
    <section className="relative px-10 py-5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Payment details
      </p>

      <div className="mt-3 rounded-sm border-2 border-slate-900 overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-slate-300">
              <th className="bg-slate-50 px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
                Fee type
              </th>
              <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                {data.feeStructure?.name ?? "General Credit"}
              </td>
            </tr>

            {/* Per-fee breakdown — reads as a vertical math layout:
                  Base
                − Discount        (only when a scholarship applies)
                = Final
                  Paid (this receipt)
                  Remaining (after this payment)
                Only shown for linked payments; unlinked "general credit"
                skips it entirely since there's no single fee to break down. */}
            {fd && (
              <>
                <BreakdownRow
                  label="Base"
                  operator=" "
                  value={formatMoney(fd.baseAmount)}
                  valueClass={cn(
                    "text-slate-900",
                    hasDiscount && "line-through decoration-slate-400",
                  )}
                />
                {hasDiscount && (
                  <BreakdownRow
                    label="Discount"
                    operator="−"
                    value={`${formatMoney(fd.discountAmount)}${
                      fd.discountType === "PERCENT" && fd.discountValue != null
                        ? ` (${fd.discountValue}%)`
                        : ""
                    }`}
                    valueClass="text-emerald-700 font-medium"
                    labelNote={
                      fd.discountType === "FIXED" ? "Flat amount" : undefined
                    }
                  />
                )}
                <BreakdownRow
                  label="Final"
                  operator="="
                  value={formatMoney(fd.finalAmount)}
                  valueClass="font-semibold text-slate-900"
                  emphasis
                />
              </>
            )}

            <tr className="border-b border-slate-300">
              <th className="bg-slate-50 px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
                Payment method
              </th>
              <td className="px-4 py-2.5 text-right">
                {data.method ? (
                  <MethodBadge method={data.method} />
                ) : (
                  <span className="text-slate-400">Not specified</span>
                )}
              </td>
            </tr>
            {data.notes && (
              <tr className="border-b border-slate-300">
                <th className="bg-slate-50 px-4 py-2.5 text-left align-top text-[11px] font-bold uppercase tracking-wider text-slate-700">
                  Notes
                </th>
                <td className="px-4 py-2.5 text-right text-slate-700 italic">
                  {data.notes}
                </td>
              </tr>
            )}

            {/* Paid (this receipt) — the hero row of the whole table. */}
            <tr className="bg-slate-900 text-white">
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider">
                Paid (this receipt)
              </th>
              <td className="px-4 py-3 text-right text-lg font-bold tabular-nums">
                {formatMoney(data.amount)}
              </td>
            </tr>

            {/* How the fee has been settled so far: direct payments vs.
                notional allocations from General Credit. Shown only when
                credit contributed — for plain direct-payment receipts
                this split would be redundant (100% direct). */}
            {fd && fd.paidFromCreditOnFee > 0 && (
              <>
                <tr className="border-b border-slate-300">
                  <th className="bg-slate-50 px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
                    <span className="inline-flex items-baseline gap-2">
                      <span
                        aria-hidden
                        className="inline-block w-3 text-center font-mono text-slate-500"
                      >
                        {" "}
                      </span>
                      <span>Paid directly</span>
                    </span>
                  </th>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                    {formatMoney(fd.paidDirectOnFee)}
                  </td>
                </tr>
                <tr className="border-b border-slate-300">
                  <th className="bg-slate-50 px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
                    <span className="inline-flex items-baseline gap-2">
                      <span
                        aria-hidden
                        className="inline-block w-3 text-center font-mono text-slate-500"
                      >
                        +
                      </span>
                      <span>From General Credit</span>
                    </span>
                  </th>
                  <td className="px-4 py-2.5 text-right tabular-nums text-violet-700 font-medium">
                    {formatMoney(fd.paidFromCreditOnFee)}
                  </td>
                </tr>
              </>
            )}

            {/* Remaining (after this payment) — only meaningful for linked
                payments; unlinked credits can't be anchored to a single fee. */}
            {fd && (
              <tr className="bg-slate-50">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
                  Remaining (after this payment)
                </th>
                <td
                  className={cn(
                    "px-4 py-2.5 text-right tabular-nums font-semibold",
                    fd.remainingOnFee > 0 ? "text-slate-900" : "text-emerald-700",
                  )}
                >
                  {formatMoney(fd.remainingOnFee)}
                  {fd.remainingOnFee === 0 && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      Paid in full
                    </span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One row of the Base / − Discount / = Final math ladder. The leading
 * operator column is what makes the three rows scan as arithmetic at a
 * glance.
 */
function BreakdownRow({
  label,
  operator,
  value,
  valueClass,
  emphasis,
  labelNote,
}: {
  label: string;
  operator: string;
  value: string;
  valueClass?: string;
  emphasis?: boolean;
  labelNote?: string;
}) {
  return (
    <tr
      className={cn(
        "border-b border-slate-300",
        emphasis && "bg-slate-100/60",
      )}
    >
      <th className="bg-slate-50 px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-700">
        <span className="inline-flex items-baseline gap-2">
          <span
            aria-hidden
            className="inline-block w-3 text-center font-mono text-slate-500"
          >
            {operator}
          </span>
          <span>{label}</span>
          {labelNote && (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
              {labelNote}
            </span>
          )}
        </span>
      </th>
      <td className={cn("px-4 py-2.5 text-right tabular-nums", valueClass)}>
        {value}
      </td>
    </tr>
  );
}

function Footer({ data }: { data: Receipt }) {
  return (
    <section className="relative px-10 py-6 border-t border-slate-300">
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <BadgeCheck className="h-4 w-4 text-slate-500" />
        <span className="italic">Received with thanks.</span>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-8">
        <SignatureLine label="Accountant" />
        <SignatureLine label="School stamp / Signature" />
      </div>

      <p className="mt-6 text-center text-[10px] uppercase tracking-widest text-slate-400">
        {data.school.name} &middot; Receipt &middot; Computer-generated
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

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

function MethodBadge({ method }: { method: PaymentMethod }) {
  const labels: Record<PaymentMethod, string> = {
    CASH: "Cash",
    BANK: "Bank transfer",
    ESEWA: "eSewa",
    OTHER: "Other",
  };
  return (
    <span className="inline-flex items-center rounded-sm border border-slate-400 bg-slate-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-slate-900">
      {labels[method]}
    </span>
  );
}

function Watermark({ schoolName }: { schoolName: string }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      <span className="select-none rotate-[-20deg] whitespace-nowrap text-[72px] font-extrabold uppercase tracking-[0.3em] text-slate-900/[0.03]">
        {schoolName} · RECEIPT
      </span>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

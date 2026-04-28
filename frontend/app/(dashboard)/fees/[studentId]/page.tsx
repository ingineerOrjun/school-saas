"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Wallet,
  AlertTriangle,
  Loader2,
  Plus,
  AlertCircle,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import {
  feesApi,
  type StudentFeesReport,
  type AssignmentStatus,
} from "@/lib/fees";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { RecordPaymentDialog } from "@/components/fees/RecordPaymentDialog";

export default function StudentFeesPage() {
  const params = useParams<{ studentId: string }>();
  const router = useRouter();
  const [report, setReport] = React.useState<StudentFeesReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [payOpen, setPayOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    if (!params?.studentId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await feesApi.getStudentFees(params.studentId);
      setReport(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to load fees.");
    } finally {
      setLoading(false);
    }
  }, [params?.studentId, router]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <Link
          href="/fees"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dues
        </Link>
        {report && (
          <Button
            onClick={() => setPayOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Record payment
          </Button>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : error ? (
        <div className="glass rounded-xl p-6 flex items-start gap-4 border-destructive/20">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-md font-semibold tracking-tight text-foreground">
              Couldn&apos;t load this student&apos;s fees
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : report ? (
        <>
          <Header report={report} />
          <AssignmentsCard report={report} />
          <PaymentsCard report={report} />
        </>
      ) : null}

      <RecordPaymentDialog
        student={
          report
            ? { id: report.studentId, name: `${report.firstName} ${report.lastName}` }
            : null
        }
        onClose={() => setPayOpen(false)}
        onRecorded={() => {
          setPayOpen(false);
          refresh();
        }}
      />
      {/* Also triggered by the button above — reset when dialog closes */}
      {!payOpen && (
        <button type="button" className="hidden" aria-hidden>
          noop
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({ report }: { report: StudentFeesReport }) {
  return (
    <div className="glass rounded-xl p-6 animate-fade-in-up">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Student fee record
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        {report.firstName} {report.lastName}
      </h1>

      {(() => {
        const showDiscount = report.totalDiscount > 0;
        const showCredit = report.totalCredit > 0;
        const cols = 3 + (showDiscount ? 1 : 0) + (showCredit ? 1 : 0);
        return (
          <div
            className={cn(
              "mt-5 grid grid-cols-1 gap-4",
              cols === 5 && "sm:grid-cols-5",
              cols === 4 && "sm:grid-cols-4",
              cols === 3 && "sm:grid-cols-3",
            )}
          >
            <SummaryStat
              label="Total assigned"
              value={formatMoney(report.totalAssigned)}
              hint={
                showDiscount ? `Base ${formatMoney(report.totalBase)}` : undefined
              }
            />
            {showDiscount && (
              <SummaryStat
                label="Scholarship"
                value={`− ${formatMoney(report.totalDiscount)}`}
                tone="success"
              />
            )}
            <SummaryStat
              label="Total paid"
              value={formatMoney(report.totalPaid)}
              tone="success"
            />
            <SummaryStat
              label="Outstanding"
              value={formatMoney(report.totalDue)}
              tone={report.totalDue > 0 ? "destructive" : "muted"}
            />
            {showCredit && (
              <SummaryStat
                label="General Credit"
                value={formatMoney(report.totalCredit)}
                tone="success"
                hint="Unallocated — auto-applied to oldest unpaid fee"
              />
            )}
          </div>
        );
      })()}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "destructive" | "muted";
  hint?: string;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          toneClass,
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {hint}
        </p>
      )}
    </div>
  );
}

function AssignmentsCard({ report }: { report: StudentFeesReport }) {
  return (
    <div className="glass rounded-xl overflow-hidden animate-fade-in-up">
      <div className="p-5 pb-3">
        <h2 className="text-md font-semibold tracking-tight text-foreground">
          Assigned fees
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Each fee shows its amount, what&apos;s been paid, and what remains.
        </p>
      </div>
      {report.assignments.length === 0 ? (
        <p className="p-6 text-center text-sm italic text-muted-foreground">
          No fees have been assigned to this student yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-muted/30">
                <Th>Fee</Th>
                <Th>Due</Th>
                <Th className="text-right">Original</Th>
                <Th className="text-right">Discount</Th>
                <Th className="text-right">Final</Th>
                <Th className="text-right">Paid</Th>
                <Th className="text-right">Remaining</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {report.assignments.map((a) => (
                <tr key={a.id} className="border-t border-border/50">
                  <Td className="font-medium">
                    {a.feeStructureName}
                    {a.discountType && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                        Scholarship
                      </span>
                    )}
                  </Td>
                  <Td
                    className={cn(
                      "tabular-nums",
                      a.overdue ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {a.dueDate}
                  </Td>
                  <Td
                    className={cn(
                      "text-right tabular-nums",
                      // When there's a discount, strike through the base
                      // so it's instantly clear it's not what they owe.
                      a.discountAmount > 0
                        ? "text-muted-foreground line-through"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatMoney(a.baseAmount)}
                  </Td>
                  <Td
                    className={cn(
                      "text-right tabular-nums",
                      a.discountAmount > 0 ? "text-success" : "text-muted-foreground/60",
                    )}
                  >
                    {a.discountAmount > 0
                      ? `− ${formatMoney(a.discountAmount)}${
                          a.discountType === "PERCENT"
                            ? ` (${a.discountValue ?? 0}%)`
                            : ""
                        }`
                      : "—"}
                  </Td>
                  <Td className="text-right tabular-nums font-semibold text-foreground">
                    {formatMoney(a.finalAmount)}
                  </Td>
                  <Td className="text-right tabular-nums text-muted-foreground">
                    <div className="flex flex-col items-end leading-tight">
                      <span>{formatMoney(a.paid)}</span>
                      {a.paidFromCredit > 0 && (
                        <span className="text-[11px] text-primary/80">
                          incl. {formatMoney(a.paidFromCredit)} credit
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td
                    className={cn(
                      "text-right tabular-nums font-semibold",
                      a.remaining > 0
                        ? a.overdue
                          ? "text-destructive"
                          : "text-foreground"
                        : "text-success",
                    )}
                  >
                    {formatMoney(a.remaining)}
                  </Td>
                  <Td>
                    <AssignmentStatusPill
                      status={a.status}
                      overdue={a.overdue}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PaymentsCard({ report }: { report: StudentFeesReport }) {
  return (
    <div className="glass rounded-xl overflow-hidden animate-fade-in-up">
      <div className="p-5 pb-3">
        <h2 className="text-md font-semibold tracking-tight text-foreground">
          Payment history
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          All payments recorded for this student, most recent first.
        </p>
      </div>
      {report.payments.length === 0 ? (
        <p className="p-6 text-center text-sm italic text-muted-foreground">
          No payments recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {report.payments.map((p) => {
            const linked = report.assignments.find(
              (a) => a.id === p.feeAssignmentId,
            );
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                    <Wallet className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground">
                        {formatMoney(p.amount)}
                      </p>
                      {p.method && <MethodBadge method={p.method} />}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.date}
                      {linked ? ` · ${linked.feeStructureName}` : " · General Credit"}
                      {p.receiptNumber && ` · #${p.receiptNumber}`}
                    </p>
                  </div>
                </div>
                {p.receiptNumber && (
                  <Link
                    href={`/receipts/${p.id}`}
                    target="_blank"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/40 hover:text-primary transition-colors shadow-xs"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    View receipt
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const tones: Record<string, string> = {
    CASH: "bg-emerald-500/10 text-emerald-700",
    BANK: "bg-sky-500/10 text-sky-700",
    ESEWA: "bg-violet-500/10 text-violet-700",
    OTHER: "bg-muted text-muted-foreground",
  };
  const label =
    method === "CASH"
      ? "Cash"
      : method === "BANK"
        ? "Bank"
        : method === "ESEWA"
          ? "eSewa"
          : "Other";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        tones[method] ?? tones.OTHER,
      )}
    >
      {label}
    </span>
  );
}

function AssignmentStatusPill({
  status,
  overdue,
}: {
  status: AssignmentStatus;
  overdue: boolean;
}) {
  if (status === "PAID") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
        Paid
      </span>
    );
  }
  if (overdue) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
        Overdue
      </span>
    );
  }
  if (status === "PARTIAL") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">
        Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Unpaid
    </span>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      className={cn(
        "h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

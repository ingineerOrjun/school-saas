"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  Download,
  Printer,
  RotateCw,
  RotateCcw,
  AlertTriangle,
  RefreshCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import {
  feesApi,
  type PaymentHistoryRow,
  type PaymentHistoryResponse,
  type PaymentMethod,
} from "@/lib/fees";
import { useClasses, type ClassWithSections } from "@/lib/classes";
import { formatCurrency } from "@/lib/currency";
import { formatByMode } from "@/lib/date";
import { getStoredUser } from "@/lib/auth";
import { useCalendarMode } from "@/components/calendar/CalendarProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/Table";
import { RefundPaymentDialog } from "@/components/fees/RefundPaymentDialog";

// ---------------------------------------------------------------------------
// Payment History
//
// Global, filterable, paginated view of every payment recorded in the
// school. The dues page answers "who owes money?" — this page answers
// "what came in, when, and from whom?"
//
// Filters are URL-driven via a single `query` state object (debounced
// for the free-text search, immediate for the dropdowns) so a reload
// preserves the operator's view. CSV export downloads the CURRENT
// filtered set so a finance officer can reconcile against the bank
// statement without leaving the page.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type Filters = {
  q: string;
  fromDate: string;
  toDate: string;
  method: PaymentMethod | "";
  classId: string;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  fromDate: "",
  toDate: "",
  method: "",
  classId: "",
};

export default function PaymentsHistoryPage() {
  const calendarMode = useCalendarMode();
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<PaymentHistoryResponse | null>(null);
  // Classes via the shared React Query hook (10m staleTime). Same
  // soft-fail semantics as the previous inline classesApi.list() —
  // on error, surface as `[]` so the dropdown disappears but the
  // rest of the payments page keeps working.
  const classesQuery = useClasses();
  const classes: ClassWithSections[] = classesQuery.isError
    ? []
    : classesQuery.data ?? [];
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Refund dialog target. The dialog is admin-only — non-admin viewers
  // never see the action button, but we don't need separate state to
  // enforce that since `setRefundTarget` is only ever called from a
  // button that itself renders only when the user is an admin.
  const [refundTarget, setRefundTarget] =
    React.useState<PaymentHistoryRow | null>(null);

  // Read the cached user once on mount. Role-gated affordances need
  // this to decide whether to render the Refund button. We could
  // re-read on each render but the role doesn't change without a
  // re-login (which clears localStorage), so once is enough.
  const isAdmin = React.useMemo(
    () => getStoredUser()?.role === "ADMIN",
    [],
  );

  // Debounce the free-text query so we don't fire a request on every
  // keystroke. Other filter changes are immediate — they're discrete
  // dropdown selections, not stream-of-typed-letters.
  React.useEffect(() => {
    const t = window.setTimeout(
      () => setDebouncedQ(filters.q.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(t);
  }, [filters.q]);

  // Reset to page 1 whenever filter values change. The user expects
  // "filter narrows from the start of results", not "filter applies
  // to whatever page I happened to be on."
  React.useEffect(() => {
    setPage(1);
  }, [debouncedQ, filters.fromDate, filters.toDate, filters.method, filters.classId]);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await feesApi.listPayments({
        q: debouncedQ || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
        method: filters.method || undefined,
        classId: filters.classId || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load payments.");
    } finally {
      setLoading(false);
    }
  }, [
    debouncedQ,
    filters.fromDate,
    filters.toDate,
    filters.method,
    filters.classId,
    page,
  ]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // (Classes loaded via `useClasses()` above — the previous
  // useEffect → classesApi.list() pattern was removed and is now
  // a shared React Query cache hit. Soft-fail semantics preserved
  // by the `isError ? [] : data ?? []` shape on the `classes`
  // value above.)

  const handleExport = () => {
    if (!data || data.rows.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    exportPaymentsCsv(data.rows, calendarMode);
    toast.success(`Exported ${data.rows.length} row(s).`);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const hasFilters =
    !!debouncedQ ||
    !!filters.fromDate ||
    !!filters.toDate ||
    !!filters.method ||
    !!filters.classId;

  return (
    <div className="space-y-6">
      {/* Header strip */}
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
            Payment History
          </h1>
          <p className="text-sm text-muted-foreground">
            Every payment recorded in this school. Filter, search, print, or
            export.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={fetchData}
            leftIcon={<RotateCw className="h-4 w-4" />}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            onClick={handleExport}
            leftIcon={<Download className="h-4 w-4" />}
            disabled={!data || data.rows.length === 0}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filter strip — sticky at the top of the table area on long
          result sets. Layout: search takes most width, filters in a
          row beneath on narrow screens. */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
          <Input
            placeholder="Search receipt #, student name, symbol no…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            leftIcon={<Search className="h-4 w-4" />}
          />
          <Input
            type="date"
            value={filters.fromDate}
            onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
            placeholder="From"
            aria-label="From date"
          />
          <Input
            type="date"
            value={filters.toDate}
            onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
            placeholder="To"
            aria-label="To date"
          />
          <select
            value={filters.method}
            onChange={(e) =>
              setFilters({
                ...filters,
                method: e.target.value as PaymentMethod | "",
              })
            }
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
            aria-label="Payment method"
          >
            <option value="">All methods</option>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank transfer</option>
            <option value="ESEWA">eSewa</option>
            <option value="OTHER">Other</option>
          </select>
          <select
            value={filters.classId}
            onChange={(e) =>
              setFilters({ ...filters, classId: e.target.value })
            }
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
            aria-label="Class"
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </button>
        )}
      </div>

      {/* Result count + pagination summary */}
      {data && !loading && (
        <p className="text-xs text-muted-foreground">
          Showing {data.rows.length} of {data.total.toLocaleString("en-IN")}{" "}
          payment{data.total === 1 ? "" : "s"}
          {hasFilters ? " (filtered)" : ""}
        </p>
      )}

      {/* Table OR loading skeleton OR empty state */}
      {loading ? (
        <PaymentHistorySkeleton />
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8 text-destructive" />}
          title="Couldn't load payments"
          description={error}
          action={{
            label: "Retry",
            onClick: fetchData,
            icon: <RotateCw className="h-4 w-4" />,
          }}
        />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8 text-muted-foreground" />}
          title="No payments found"
          description={
            hasFilters
              ? "No payments match these filters. Try widening the date range or clearing search."
              : "No payments have been recorded yet."
          }
          action={
            hasFilters
              ? {
                  label: "Clear filters",
                  onClick: () => setFilters(EMPTY_FILTERS),
                }
              : undefined
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <Tr>
                <Th>Receipt #</Th>
                <Th>Date</Th>
                <Th>Student</Th>
                <Th>Class</Th>
                <Th>Linked Fee</Th>
                <Th>Method</Th>
                <Th className="text-right">Amount</Th>
                <Th>Cashier</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {data.rows.map((row) => (
                <PaymentRow
                  key={row.id}
                  row={row}
                  calendarMode={calendarMode}
                  canRefund={isAdmin}
                  onRefund={() => setRefundTarget(row)}
                />
              ))}
            </TBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-muted-foreground tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {/* Refund dialog — single-instance, lives at the page level so it
          renders above the table. `payment` doubles as the open flag:
          null = closed, set = open against this row. After a successful
          refund we refresh the list so the source row's status flips
          to REFUNDED in-place. */}
      <RefundPaymentDialog
        payment={
          refundTarget
            ? {
                id: refundTarget.id,
                receiptNumber: refundTarget.receiptNumber,
                amount: refundTarget.amount,
                date: refundTarget.date,
                method: refundTarget.method,
                feeName: refundTarget.feeStructureName,
                studentName: `${refundTarget.student.firstName} ${refundTarget.student.lastName}`,
              }
            : null
        }
        onClose={() => setRefundTarget(null)}
        onRefunded={() => {
          // Refresh so the source row picks up its new REFUNDED status
          // and the new refund slip surfaces at the top of the list.
          fetchData();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function PaymentRow({
  row,
  calendarMode,
  canRefund,
  onRefund,
}: {
  row: PaymentHistoryRow;
  calendarMode: ReturnType<typeof useCalendarMode>;
  /** Admin role gate. Non-admins never see the refund button. */
  canRefund: boolean;
  onRefund: () => void;
}) {
  // Refund eligibility: only ACTIVE non-refund rows. Backend will
  // reject any other shape (P2002 on the unique refund back-link, or
  // the explicit "cannot refund a refund" guard) but we hide the
  // button so the cashier never sees a state they can't act on.
  const eligibleForRefund =
    canRefund && row.status === "ACTIVE" && !row.isRefund && row.amount > 0;
  const isRefunded = row.status === "REFUNDED";
  return (
    <Tr className={cn(isRefunded && "opacity-60")}>
      <Td className="font-mono text-xs">
        {row.receiptNumber ?? "—"}
        {row.isRefund && (
          <span className="ml-1.5 inline-flex items-center rounded-sm border border-foreground px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
            Refund
          </span>
        )}
        {isRefunded && (
          <span className="ml-1.5 inline-flex items-center rounded-sm border border-muted-foreground/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Refunded
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap text-xs">
        {formatByMode(row.date, calendarMode)}
      </Td>
      <Td>
        <Link
          href={`/fees/${row.student.id}`}
          className="font-medium text-foreground hover:text-primary hover:underline"
        >
          {row.student.firstName} {row.student.lastName}
        </Link>
        {row.student.symbolNumber && (
          <div className="text-[11px] text-muted-foreground font-mono">
            {row.student.symbolNumber}
          </div>
        )}
      </Td>
      <Td className="text-xs text-muted-foreground">
        {row.student.className ?? "—"}
        {row.student.sectionName && (
          <span className="text-muted-foreground/70">
            {" · "}
            {row.student.sectionName}
          </span>
        )}
      </Td>
      <Td className="text-xs text-muted-foreground">
        {row.feeStructureName ?? (
          <span className="italic">General Credit</span>
        )}
      </Td>
      <Td className="text-xs">
        {row.method ? methodLabel(row.method) : "—"}
      </Td>
      <Td
        className={cn(
          "text-right tabular-nums font-semibold",
          row.isRefund ? "text-foreground" : "text-foreground",
        )}
      >
        {row.isRefund ? "−" : ""}
        {formatCurrency(Math.abs(row.amount))}
      </Td>
      <Td className="text-xs text-muted-foreground">
        {row.cashier ? row.cashier.email : "—"}
      </Td>
      <Td>
        <div className="flex items-center justify-end gap-1">
          {row.receiptNumber && (
            <>
              <Link
                href={`/receipts/${row.id}`}
                target="_blank"
                title="View receipt"
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border hover:border-primary hover:text-primary transition-colors"
              >
                <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">View</span>
              </Link>
              <Link
                href={`/receipts/${row.id}?print=1`}
                target="_blank"
                title="Reprint receipt"
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border hover:border-primary hover:text-primary transition-colors"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">Reprint</span>
              </Link>
            </>
          )}
          {/* Refund button — admin-only, ACTIVE non-refund rows only.
              Visually distinct (destructive border on hover) so it
              isn't mistaken for the View/Reprint affordances next to
              it. The backend has independent guards; this is just the
              UX gate. */}
          {eligibleForRefund && (
            <button
              type="button"
              onClick={onRefund}
              title="Refund this payment"
              className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:border-destructive/60 hover:text-destructive transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Refund</span>
            </button>
          )}
        </div>
      </Td>
    </Tr>
  );
}

function PaymentHistorySkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function methodLabel(m: PaymentMethod): string {
  switch (m) {
    case "CASH":
      return "Cash";
    case "BANK":
      return "Bank";
    case "ESEWA":
      return "eSewa";
    case "OTHER":
      return "Other";
  }
}

// ---------------------------------------------------------------------------
// CSV export
//
// Exports the CURRENTLY-VISIBLE PAGE only — server pagination means we
// don't have all rows in memory. For a full export we'd need to either
// stream from the backend or paginate-and-concatenate in a loop; not
// worth the complexity for a v1 that already covers the 90% reconcile
// workflow (filter to a date range, export, paste into bank statement).
//
// CSV format: BOM + comma-separated, RFC 4180 quoting. Excel opens it
// cleanly without "data appears truncated" complaints.
// ---------------------------------------------------------------------------
function exportPaymentsCsv(
  rows: PaymentHistoryRow[],
  calendarMode: ReturnType<typeof useCalendarMode>,
): void {
  const header = [
    "Receipt #",
    "Date",
    "Student",
    "Symbol No.",
    "Class",
    "Section",
    "Linked Fee",
    "Method",
    "Amount",
    "Status",
    "Cashier",
    "Notes",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.receiptNumber ?? "",
        formatByMode(r.date, calendarMode),
        `${r.student.firstName} ${r.student.lastName}`,
        r.student.symbolNumber ?? "",
        r.student.className ?? "",
        r.student.sectionName ?? "",
        r.feeStructureName ?? (r.isRefund ? "Refund" : "General Credit"),
        r.method ?? "",
        // Amount as a plain number — Excel reads it as currency-ready.
        // No symbol so the column stays sortable as numeric.
        r.amount.toFixed(2),
        r.status,
        r.cashier?.email ?? "",
        r.notes ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  // Prepend BOM so Excel detects UTF-8 (otherwise Devanagari names
  // come out as mojibake on Windows Excel).
  const body = "﻿" + lines.join("\r\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `payments-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** RFC 4180-style CSV cell: quote if contains delim/quote/newline. */
function csvCell(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

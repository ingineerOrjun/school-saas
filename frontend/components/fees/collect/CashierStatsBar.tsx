"use client";

import * as React from "react";
import {
  CheckCircle2,
  Receipt,
  RotateCcw,
  Banknote,
  Smartphone,
  Building2,
  CircleDashed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import type { CashierSummary, PaymentMethod } from "@/lib/fees";

// ---------------------------------------------------------------------------
// CashierStatsBar — today's-collection overview at the top of the workspace.
//
// Two-row layout:
//   Row 1 — top-line totals (net collected, transactions, refunds)
//   Row 2 — by-method split (cash vs digital), shown as a tightly
//           packed stacked bar so the cashier can see at a glance
//           "what proportion of today is digital?"
//
// Numbers come from the centralized GET /fees/cashier-summary so the
// values match what an admin sees on the broader fees dashboard.
// ---------------------------------------------------------------------------

export interface CashierStatsBarProps {
  summary: CashierSummary | null;
  loading?: boolean;
}

export function CashierStatsBar({ summary, loading }: CashierStatsBarProps) {
  if (loading || !summary) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-7 w-32 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      {/* Row 1 — top-line stats. Net collected leads (largest tile)
          since that's the headline number a cashier looks at to feel
          progress through the day. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          label="Collected today"
          value={formatCurrency(summary.collectedToday)}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="primary"
          emphasised
        />
        <StatTile
          label="Transactions"
          value={summary.transactionsToday.toLocaleString("en-IN")}
          icon={<Receipt className="h-5 w-5" />}
          tone="muted"
          subtitle={
            summary.transactionsToday === 0
              ? "None yet"
              : `${summary.transactionsToday} payment${summary.transactionsToday === 1 ? "" : "s"} taken`
          }
        />
        <StatTile
          label="Refunds"
          value={
            summary.refundsToday === 0
              ? "0"
              : `${summary.refundsToday}`
          }
          icon={<RotateCcw className="h-5 w-5" />}
          tone={summary.refundsToday > 0 ? "destructive" : "muted"}
          subtitle={
            summary.refundsToday > 0
              ? `−${formatCurrency(summary.refundsAmountToday)}`
              : "None today"
          }
        />
        <StatTile
          label="Receipts issued"
          value={(
            summary.transactionsToday + summary.refundsToday
          ).toLocaleString("en-IN")}
          icon={<Receipt className="h-5 w-5" />}
          tone="muted"
        />
      </div>

      {/* Row 2 — method split. Hidden when there's no activity (a blank
          stacked bar is just visual noise). */}
      {summary.byMethod.length > 0 && (
        <MethodSplit byMethod={summary.byMethod} total={summary.collectedToday} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  icon,
  tone,
  subtitle,
  emphasised,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "primary" | "muted" | "destructive";
  subtitle?: string;
  emphasised?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md",
            tone === "primary" && "bg-primary/10 text-primary",
            tone === "muted" && "bg-muted text-muted-foreground",
            tone === "destructive" && "bg-destructive/10 text-destructive",
          )}
        >
          {icon}
        </span>
      </div>
      <p
        className={cn(
          "mt-2 tabular-nums tracking-tight",
          emphasised
            ? "text-2xl sm:text-3xl font-bold"
            : "text-xl font-semibold",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MethodSplit — one-line stacked bar + chips for cash/bank/eSewa breakdown.
//
// The bar is purely a visual ratio, not the source of truth — the
// numbers next to each chip carry the actual amount. We render it
// because cashiers reconcile the cash drawer against "what % was cash
// today" all the time, and a horizontal bar is faster to read than a
// grid of percentages.
// ---------------------------------------------------------------------------

function MethodSplit({
  byMethod,
  total,
}: {
  byMethod: CashierSummary["byMethod"];
  total: number;
}) {
  // Only positive contributions land in the bar — refunds leave the
  // method totals smaller, but a negative segment in a stacked bar is
  // visually meaningless. We compute "share of net positive" from the
  // sum of positive entries; refunds are still reflected in the chip
  // numbers next to each method.
  const positives = byMethod.filter((m) => m.amount > 0);
  const positiveTotal = positives.reduce((s, m) => s + m.amount, 0);

  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>By method</span>
        <span className="tabular-nums">
          Total {formatCurrency(total)}
        </span>
      </div>
      {positiveTotal > 0 && (
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
          {positives.map((m) => (
            <div
              key={m.method}
              className={cn("h-full", methodBarColor(m.method))}
              style={{
                width: `${(m.amount / positiveTotal) * 100}%`,
              }}
              title={`${methodLabel(m.method)} · ${formatCurrency(m.amount)}`}
            />
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {byMethod.map((m) => (
          <div key={m.method} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded text-muted-foreground",
                methodChipBg(m.method),
              )}
              aria-hidden
            >
              {methodIcon(m.method)}
            </span>
            <span className="font-medium text-foreground">
              {methodLabel(m.method)}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatCurrency(m.amount)} · {m.count}{" "}
              <span className="text-[10px] uppercase tracking-wider">
                txn{m.count === 1 ? "" : "s"}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Method styling. Chip background + icon + bar segment color. Kept all
// in one block so adding a future method (UPI, eSewa Khalti split,
// etc.) only touches one place.
// ---------------------------------------------------------------------------

function methodLabel(m: PaymentMethod | "UNKNOWN"): string {
  switch (m) {
    case "CASH":
      return "Cash";
    case "BANK":
      return "Bank";
    case "ESEWA":
      return "eSewa";
    case "OTHER":
      return "Other";
    case "UNKNOWN":
      return "Unspecified";
  }
}

function methodIcon(m: PaymentMethod | "UNKNOWN"): React.ReactNode {
  switch (m) {
    case "CASH":
      return <Banknote className="h-3 w-3" />;
    case "BANK":
      return <Building2 className="h-3 w-3" />;
    case "ESEWA":
      return <Smartphone className="h-3 w-3" />;
    case "OTHER":
    case "UNKNOWN":
      return <CircleDashed className="h-3 w-3" />;
  }
}

/** Background colors used in the stacked bar and the chip squares. */
function methodBarColor(m: PaymentMethod | "UNKNOWN"): string {
  // Tones chosen to be distinguishable in print/grayscale: cash (light),
  // bank (medium), eSewa (medium-dark), other (dark). Same hierarchy
  // even when color is stripped.
  switch (m) {
    case "CASH":
      return "bg-emerald-500";
    case "BANK":
      return "bg-sky-500";
    case "ESEWA":
      return "bg-violet-500";
    case "OTHER":
    case "UNKNOWN":
      return "bg-slate-400";
  }
}

function methodChipBg(m: PaymentMethod | "UNKNOWN"): string {
  switch (m) {
    case "CASH":
      return "bg-emerald-500/15 text-emerald-700";
    case "BANK":
      return "bg-sky-500/15 text-sky-700";
    case "ESEWA":
      return "bg-violet-500/15 text-violet-700";
    case "OTHER":
    case "UNKNOWN":
      return "bg-slate-500/15 text-slate-700";
  }
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  GraduationCap,
  Wallet,
  CheckCircle2,
  AlertTriangle,
  Pause,
  Clock,
  ArrowRight,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { platformApi, type PlatformOverview } from "@/lib/platform";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";
import { Sparkline } from "@/components/charts/Sparkline";

// ---------------------------------------------------------------------------
// /platform — overview page.
//
// Composition:
//   • Two KPI rows.
//       Row 1: schools by status (total, active, trial, suspended, expired)
//       Row 2: aggregate usage (students, teachers, payments amount + count)
//   • School growth trend (last 12 months sparkline + bar grid)
//
// Data: a single GET /platform/overview round-trip. Same shape as
// the analytics tabs; visual treatment intentionally separates this
// from the school dashboard (slate base, no school accent).
// ---------------------------------------------------------------------------

export default function PlatformOverviewPage() {
  const [data, setData] = React.useState<PlatformOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    platformApi
      .getOverview()
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load overview.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Overview
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Cross-tenant snapshot of every school on the platform.
          </p>
        </div>
        {data && (
          <Link
            href="/platform/schools"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
          >
            Manage schools
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </header>

      {error ? (
        <ErrorBanner message={error} />
      ) : (
        <>
          <SchoolsByStatus data={data} loading={loading} />
          <UsageRow data={data} loading={loading} />
          <SchoolGrowthCard data={data} loading={loading} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchoolsByStatus — five-tile row keyed off the status enum. Drives
// the platform owner's first read: "are any schools in trouble?"
// ---------------------------------------------------------------------------

function SchoolsByStatus({
  data,
  loading,
}: {
  data: PlatformOverview | null;
  loading: boolean;
}) {
  return (
    <div>
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
        Schools by status
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <PlatformKpi
          label="Total"
          value={loading ? null : data?.schoolsTotal}
          icon={<Building2 className="h-4 w-4" />}
          tone="muted"
          href="/platform/schools"
        />
        <PlatformKpi
          label="Active"
          value={loading ? null : data?.schoolsActive}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
          href="/platform/schools?status=ACTIVE"
        />
        <PlatformKpi
          label="Trial"
          value={loading ? null : data?.schoolsTrial}
          icon={<Clock className="h-4 w-4" />}
          tone="muted"
          href="/platform/schools?status=TRIAL"
        />
        <PlatformKpi
          label="Suspended"
          value={loading ? null : data?.schoolsSuspended}
          icon={<Pause className="h-4 w-4" />}
          tone={
            data && data.schoolsSuspended > 0 ? "destructive" : "muted"
          }
          href="/platform/schools?status=SUSPENDED"
        />
        <PlatformKpi
          label="Expired"
          value={loading ? null : data?.schoolsExpired}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={data && data.schoolsExpired > 0 ? "destructive" : "muted"}
          href="/platform/schools?status=EXPIRED"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UsageRow — aggregate counts that scale with platform success.
// ---------------------------------------------------------------------------

function UsageRow({
  data,
  loading,
}: {
  data: PlatformOverview | null;
  loading: boolean;
}) {
  return (
    <div>
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
        Aggregate usage
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PlatformKpi
          label="Students"
          value={loading ? null : data?.studentsTotal}
          icon={<Users className="h-4 w-4" />}
          tone="muted"
          formatAs="count"
        />
        <PlatformKpi
          label="Teachers"
          value={loading ? null : data?.teachersTotal}
          icon={<GraduationCap className="h-4 w-4" />}
          tone="muted"
          formatAs="count"
        />
        <PlatformKpi
          label="Payments processed"
          value={loading ? null : data?.paymentsTotalCount}
          icon={<Wallet className="h-4 w-4" />}
          tone="muted"
          formatAs="count"
        />
        <PlatformKpi
          label="Total amount"
          value={loading ? null : data?.paymentsTotalAmount}
          icon={<Wallet className="h-4 w-4" />}
          tone="muted"
          formatAs="currency"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchoolGrowthCard — Sparkline + 12-bar grid. Same visual vocabulary
// as the analytics tabs' monthly trends so the platform owner reads
// it instantly.
// ---------------------------------------------------------------------------

function SchoolGrowthCard({
  data,
  loading,
}: {
  data: PlatformOverview | null;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
        <div className="mt-4 h-24 animate-pulse rounded bg-slate-50" />
      </section>
    );
  }
  const trend = data.schoolGrowthTrend;
  const total = trend.reduce((s, m) => s + m.count, 0);
  const max = Math.max(...trend.map((t) => t.count), 1);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            School growth · last 12 months
          </h3>
          <p className="text-[11px] text-slate-500">
            Tenants joined per month.
          </p>
        </div>
        <span className="text-[11px] tabular-nums text-slate-500">
          {total} tenant{total === 1 ? "" : "s"} added
        </span>
      </header>
      <Sparkline
        values={trend.map((t) => t.count)}
        height={48}
        filled
        strokeClassName="text-slate-700"
      />
      <div className="mt-3 grid grid-cols-6 gap-1 sm:grid-cols-12">
        {trend.map((m) => {
          const heightPct = max > 0 ? (m.count / max) * 100 : 0;
          const ym = m.month.slice(5);
          return (
            <div
              key={m.month}
              className="flex flex-col items-center gap-1"
              title={`${m.month}: ${m.count} school${m.count === 1 ? "" : "s"}`}
            >
              <div className="flex h-12 w-full items-end">
                <div
                  className="w-full rounded-sm bg-slate-300"
                  style={{ height: `${Math.max(heightPct, 2)}%` }}
                />
              </div>
              <span className="text-[9px] tabular-nums text-slate-500">
                {ym}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PlatformKpi — same shape as the analytics KpiCard but with the
// platform's slate palette baked in. We don't reuse the analytics
// primitive directly because the platform's visual vocabulary
// deliberately diverges (slate base, no primary accent).
// ---------------------------------------------------------------------------

function PlatformKpi({
  label,
  value,
  icon,
  tone,
  href,
  formatAs = "count",
}: {
  label: string;
  value: number | null | undefined;
  icon: React.ReactNode;
  tone: "muted" | "success" | "destructive";
  href?: string;
  formatAs?: "count" | "currency";
}) {
  const formatted =
    value === null || value === undefined
      ? null
      : formatAs === "currency"
        ? formatCurrencyShort(value)
        : value.toLocaleString("en-IN");

  const body = (
    <div
      className={`rounded-xl border bg-white p-4 transition-shadow ${
        href ? "hover:shadow-sm hover:border-slate-300 cursor-pointer" : ""
      } ${
        tone === "destructive"
          ? "border-red-200 bg-red-50/40"
          : tone === "success"
            ? "border-emerald-200 bg-emerald-50/30"
            : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-md ${
            tone === "destructive"
              ? "bg-red-500/15 text-red-700"
              : tone === "success"
                ? "bg-emerald-500/15 text-emerald-700"
                : "bg-slate-100 text-slate-600"
          }`}
        >
          {icon}
        </span>
      </div>
      <p
        className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${
          tone === "destructive" ? "text-red-700" : "text-slate-900"
        }`}
      >
        {formatted ??
          (formatAs === "currency" ? formatCurrency(0).replace(/.+/, "—") : "—")}
      </p>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" />
        {message}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  GraduationCap,
  Pause,
  Users,
  Wallet,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type HealthPayload,
  type PlatformOverview,
} from "@/lib/platform";
import { formatCurrencyShort } from "@/lib/currency";
import { Sparkline } from "@/components/charts/Sparkline";
import {
  PageHeader,
  PanelErrorState,
  SectionCard,
  StatCard,
  StatsGrid,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform — overview page (refactored onto the design primitives).
//
// Composition unchanged from before:
//   • Schools-by-status row
//   • Aggregate-usage row
//   • Optional health summary card (links to /platform/health)
//   • School growth trend (last 12 months)
//
// What changed: every inline KpiCard/SectionCard/HeaderHeader pattern
// is now the corresponding `platform-ui` primitive. ~120 fewer lines,
// guaranteed visual consistency with every other platform page that
// uses the same primitives.
// ---------------------------------------------------------------------------

export default function PlatformOverviewPage() {
  const [data, setData] = React.useState<PlatformOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Health roll-up — loaded in parallel with the overview. Failure is
  // non-fatal: when /platform/health errors we just hide the card.
  const [health, setHealth] = React.useState<HealthPayload | null>(null);

  const reload = React.useCallback(async () => {
    setError(null);
    try {
      const [overview, healthResult] = await Promise.all([
        platformApi.getOverview(),
        platformApi.getHealth().catch(() => null),
      ]);
      setData(overview);
      setHealth(healthResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Overview"
        description="Cross-tenant snapshot of every school on the platform."
        icon={<Building2 className="h-4 w-4" />}
        actions={
          <Link
            href="/platform/schools"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Manage schools
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {error ? (
        <PanelErrorState message={error} onRetry={() => void reload()} />
      ) : (
        <>
          <SchoolsByStatusRow data={data} loading={loading} />
          <UsageRow data={data} loading={loading} />
          {health && <HealthSummaryCard health={health} />}
          <SchoolGrowthCard data={data} loading={loading} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schools by status — keyed off the status enum.
// ---------------------------------------------------------------------------

function SchoolsByStatusRow({
  data,
  loading,
}: {
  data: PlatformOverview | null;
  loading: boolean;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        Schools by status
      </h2>
      <StatsGrid cols={5}>
        <StatCard
          label="Total"
          value={loading ? null : (data?.schoolsTotal.toLocaleString("en-IN") ?? null)}
          icon={<Building2 className="h-3 w-3" />}
          loading={loading}
          href="/platform/schools"
        />
        <StatCard
          label="Active"
          value={loading ? null : (data?.schoolsActive.toLocaleString("en-IN") ?? null)}
          icon={<CheckCircle2 className="h-3 w-3" />}
          tone="success"
          loading={loading}
          href="/platform/schools?status=ACTIVE"
        />
        <StatCard
          label="Trial"
          value={loading ? null : (data?.schoolsTrial.toLocaleString("en-IN") ?? null)}
          icon={<Clock className="h-3 w-3" />}
          loading={loading}
          href="/platform/schools?status=TRIAL"
        />
        <StatCard
          label="Suspended"
          value={loading ? null : (data?.schoolsSuspended.toLocaleString("en-IN") ?? null)}
          icon={<Pause className="h-3 w-3" />}
          tone={data && data.schoolsSuspended > 0 ? "danger" : "default"}
          loading={loading}
          href="/platform/schools?status=SUSPENDED"
        />
        <StatCard
          label="Expired"
          value={loading ? null : (data?.schoolsExpired.toLocaleString("en-IN") ?? null)}
          icon={<AlertTriangle className="h-3 w-3" />}
          tone={data && data.schoolsExpired > 0 ? "warning" : "default"}
          loading={loading}
          href="/platform/schools?status=EXPIRED"
        />
      </StatsGrid>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregate usage — total students/teachers/payments across all tenants.
// ---------------------------------------------------------------------------

function UsageRow({
  data,
  loading,
}: {
  data: PlatformOverview | null;
  loading: boolean;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        Aggregate usage
      </h2>
      <StatsGrid cols={4}>
        <StatCard
          label="Students"
          value={loading ? null : (data?.studentsTotal.toLocaleString("en-IN") ?? null)}
          icon={<Users className="h-3 w-3" />}
          loading={loading}
        />
        <StatCard
          label="Teachers"
          value={loading ? null : (data?.teachersTotal.toLocaleString("en-IN") ?? null)}
          icon={<GraduationCap className="h-3 w-3" />}
          loading={loading}
        />
        <StatCard
          label="Payments processed"
          value={loading ? null : (data?.paymentsTotalCount.toLocaleString("en-IN") ?? null)}
          icon={<Wallet className="h-3 w-3" />}
          loading={loading}
        />
        <StatCard
          label="Total amount"
          value={loading ? null : (data ? formatCurrencyShort(data.paymentsTotalAmount) : null)}
          icon={<Wallet className="h-3 w-3" />}
          loading={loading}
        />
      </StatsGrid>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HealthSummary — compact "everything fine?" card on overview. Detailed
// breakdown lives at /platform/health.
// ---------------------------------------------------------------------------

function HealthSummaryCard({ health }: { health: HealthPayload }) {
  const { status } = health;
  const tone =
    status === "green"
      ? "border-emerald-200 bg-emerald-50/50"
      : status === "yellow"
        ? "border-amber-200 bg-amber-50/50"
        : "border-red-200 bg-red-50/50";
  const dotTone =
    status === "green"
      ? "bg-emerald-500"
      : status === "yellow"
        ? "bg-amber-500"
        : "bg-red-500";
  const label =
    status === "green"
      ? "All systems operational"
      : status === "yellow"
        ? "Elevated activity"
        : "Degraded";

  return (
    <Link
      href="/platform/health"
      className={`flex items-center gap-3 rounded-xl border ${tone} px-4 py-3 transition-colors hover:brightness-95`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-slate-600">
        <Activity className="h-4 w-4" />
      </span>
      <div className="flex flex-1 items-center gap-3">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${dotTone} ${
            status !== "green" ? "animate-pulse" : ""
          }`}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="text-[11px] text-slate-600">
            Uptime {health.uptime.pretty} · DB{" "}
            {health.database.healthy
              ? `${health.database.latencyMs ?? "?"}ms`
              : "down"}{" "}
            · {health.errors.last60min} errors / hr ·{" "}
            {health.loginFailures.last60min} login failures / hr
          </p>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// School growth — Sparkline + 12-bar grid. Same visual vocabulary as
// the analytics tabs' monthly trends.
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
      <SectionCard
        title="School growth"
        description="Last 12 months · tenants joined per month"
      >
        <div className="h-24 animate-pulse rounded bg-slate-50" />
      </SectionCard>
    );
  }
  const trend = data.schoolGrowthTrend;
  const total = trend.reduce((s, m) => s + m.count, 0);
  const max = Math.max(...trend.map((t) => t.count), 1);

  return (
    <SectionCard
      title="School growth"
      description="Last 12 months · tenants joined per month"
      actions={
        <span className="text-[11px] tabular-nums text-slate-500">
          {total} tenant{total === 1 ? "" : "s"} added
        </span>
      }
    >
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
    </SectionCard>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  Cog,
  CreditCard,
  Database,
  ExternalLink,
  Layers,
  Loader2,
  Pause,
  RotateCw,
  ShieldAlert,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type HealthPayload,
  type PlatformAnalyticsPayload,
} from "@/lib/platform";
import { formatCurrencyShort } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  PageHeader,
  PanelEmptyState,
  PanelErrorState,
  PanelLoadingState,
  SectionCard,
  StatCard,
  StatsGrid,
  StatusPill,
  type PillTone,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform/operations — Phase 18 ops cockpit.
//
// Single page, dense, fast-scanning. Composes the analytics
// payload + the live health probe into a glance dashboard. No
// drilldown views here — every widget links out to the dedicated
// page (audit, schools, notifications, health) for detail.
//
// Layout:
//
//   [ Status banner ]
//   [ Revenue ][ Growth ][ Risk ][ System ]   — KPI grid
//   [ Plan distribution      ][ Health card     ]
//   [ Risk panel             ][ Queue panel     ]
//   [ Recent failed jobs                        ]
//   [ Feature adoption                          ]
//
// Refresh: 60s poll. Operators usually have this open during
// incident triage, so a refresh slow enough not to interfere with
// reading and fast enough to stay useful.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 60_000;

export default function PlatformOperationsPage() {
  const [analytics, setAnalytics] =
    React.useState<PlatformAnalyticsPayload | null>(null);
  const [health, setHealth] = React.useState<HealthPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (initial: boolean) => {
      if (initial) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const [a, h] = await Promise.all([
          platformApi.getAnalytics(),
          platformApi.getHealth().catch(() => null),
        ]);
        setAnalytics(a);
        setHealth(h);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Failed to load operations.",
        );
      } finally {
        if (initial) setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    void load(true);
    const id = window.setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading) return <PanelLoadingState />;
  if (error || !analytics) {
    return (
      <PanelErrorState
        message={error ?? "Could not load operations."}
        onRetry={() => void load(true)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operations"
        description="Cross-platform health, revenue, queue, and risk at a glance."
        icon={<Cog className="h-4 w-4" />}
        actions={
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            Refresh
          </button>
        }
      />

      {health && <HealthBanner health={health} />}

      <KpiRow analytics={analytics} health={health} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PlanDistributionCard analytics={analytics} />
        <NotificationsCard analytics={analytics} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RiskPanel analytics={analytics} />
        <QueuePanel analytics={analytics} />
      </div>

      <FailedJobsCard analytics={analytics} />
      <FeatureAdoptionCard analytics={analytics} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status banner (top-of-page health rollup).
// ---------------------------------------------------------------------------

function HealthBanner({ health }: { health: HealthPayload }) {
  const map: Record<
    HealthPayload["status"],
    { label: string; tone: string; dot: string }
  > = {
    green: {
      label: "All systems operational",
      tone: "border-emerald-200 bg-emerald-50/40",
      dot: "bg-emerald-500",
    },
    yellow: {
      label: "Elevated activity",
      tone: "border-amber-200 bg-amber-50/40",
      dot: "bg-amber-500",
    },
    red: {
      label: "Degraded — DB probe failed",
      tone: "border-red-200 bg-red-50/40",
      dot: "bg-red-500",
    },
  };
  const m = map[health.status];
  return (
    <Link
      href="/platform/health"
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors hover:brightness-95",
        m.tone,
      )}
    >
      <span
        className={cn(
          "inline-block h-2.5 w-2.5 rounded-full",
          m.dot,
          health.status !== "green" && "animate-pulse",
        )}
        aria-hidden
      />
      <p className="text-sm font-semibold text-slate-900">{m.label}</p>
      <span className="ml-auto text-[11px] text-slate-500">
        Uptime {health.uptime.pretty} ·{" "}
        {health.database.healthy
          ? `DB ${health.database.latencyMs ?? "?"}ms`
          : "DB down"}{" "}
        · {health.errors.last60min} errors / hr ·{" "}
        {health.loginFailures.last60min} login failures / hr
      </span>
      <ExternalLink className="h-3.5 w-3.5 text-slate-400" aria-hidden />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// KPI row.
// ---------------------------------------------------------------------------

function KpiRow({
  analytics,
  health,
}: {
  analytics: PlatformAnalyticsPayload;
  health: HealthPayload | null;
}) {
  const growth = analytics.growth;
  const growthDelta = growth.newSchools30d - growth.newSchoolsPrior30d;
  const growthDeltaTone: "positive" | "neutral" | "negative" =
    growthDelta > 0 ? "positive" : growthDelta < 0 ? "negative" : "neutral";

  const queueDepth =
    (analytics.system.jobQueue.PENDING ?? 0) +
    (analytics.system.jobQueue.RUNNING ?? 0);

  return (
    <StatsGrid cols={4}>
      <StatCard
        label="MRR"
        value={formatCurrencyShort(analytics.revenue.mrrNpr)}
        delta={`${analytics.revenue.activePaidSubscriptions} paid · ${analytics.revenue.activeTrials} trials`}
        icon={<Wallet className="h-3 w-3" />}
      />
      <StatCard
        label="Schools · 30d"
        value={growth.newSchools30d.toLocaleString("en-IN")}
        delta={`${growthDelta >= 0 ? "+" : ""}${growthDelta} vs prior 30d`}
        deltaTone={growthDeltaTone}
        icon={<TrendingUp className="h-3 w-3" />}
      />
      <StatCard
        label="At-risk schools"
        value={(
          analytics.risk.suspendedSchools +
          analytics.risk.expiredSchools +
          analytics.risk.expiringSoon
        ).toLocaleString("en-IN")}
        delta={`${analytics.risk.expiringSoon} expiring · ${analytics.risk.suspendedSchools} suspended`}
        icon={<AlertTriangle className="h-3 w-3" />}
        tone={
          analytics.risk.suspendedSchools + analytics.risk.expiredSchools > 0
            ? "warning"
            : "default"
        }
      />
      <StatCard
        label="Queue depth"
        value={queueDepth.toLocaleString("en-IN")}
        delta={`${analytics.system.jobQueue.FAILED ?? 0} failed · ${analytics.system.jobQueue.SUCCEEDED ?? 0} done`}
        icon={<Zap className="h-3 w-3" />}
        tone={
          (analytics.system.jobQueue.FAILED ?? 0) > 0 ? "warning" : "default"
        }
      />
      {/* Health card on a second row when available */}
      {health && (
        <StatCard
          label="ARR projection"
          value={formatCurrencyShort(analytics.revenue.arrNpr)}
          delta="MRR × 12 — does not include UNLIMITED"
          icon={<CreditCard className="h-3 w-3" />}
        />
      )}
    </StatsGrid>
  );
}

// ---------------------------------------------------------------------------
// Plan distribution
// ---------------------------------------------------------------------------

function PlanDistributionCard({
  analytics,
}: {
  analytics: PlatformAnalyticsPayload;
}) {
  const total = analytics.revenue.planDistribution.reduce(
    (s, p) => s + p.count,
    0,
  );
  return (
    <SectionCard
      title="Plan distribution"
      description={`${total} active subscription${total === 1 ? "" : "s"}`}
      icon={<Layers className="h-3.5 w-3.5" />}
    >
      {analytics.revenue.planDistribution.length === 0 ? (
        <PanelEmptyState
          icon={<Layers className="h-4 w-4" />}
          title="No active subscriptions"
          description="Plan distribution will appear once tenants subscribe."
        />
      ) : (
        <ul className="space-y-2">
          {analytics.revenue.planDistribution.map((p) => {
            const pct = total > 0 ? (p.count / total) * 100 : 0;
            return (
              <li key={p.plan} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <StatusPill tone="default" size="xs" uppercase>
                    {p.plan}
                  </StatusPill>
                  <span className="tabular-nums text-slate-700">
                    <strong>{p.count}</strong>{" "}
                    <span className="text-slate-400">
                      · {pct.toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-700 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Notifications volume
// ---------------------------------------------------------------------------

function NotificationsCard({
  analytics,
}: {
  analytics: PlatformAnalyticsPayload;
}) {
  const n = analytics.system.notifications24h;
  return (
    <SectionCard
      title="Notifications · 24h"
      description={`${n.total} produced, ${n.failedDeliveries} failed deliveries`}
      icon={<Bell className="h-3.5 w-3.5" />}
      tone={n.failedDeliveries > 0 ? "warning" : "default"}
      actions={
        <Link
          href="/platform/notifications"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Open inbox
          <ExternalLink className="h-3 w-3" />
        </Link>
      }
    >
      {n.total === 0 ? (
        <PanelEmptyState
          icon={<Bell className="h-4 w-4" />}
          title="No notifications today"
          description="Platform events will appear here as they're produced."
        />
      ) : (
        <ul className="space-y-1.5">
          {n.bySeverity.map((s) => (
            <li
              key={s.severity}
              className="flex items-center justify-between text-xs"
            >
              <StatusPill
                tone={severityTone(s.severity)}
                size="xs"
                uppercase
              >
                {s.severity}
              </StatusPill>
              <span className="font-semibold tabular-nums text-slate-700">
                {s.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Risk panel
// ---------------------------------------------------------------------------

function RiskPanel({ analytics }: { analytics: PlatformAnalyticsPayload }) {
  const r = analytics.risk;
  const items = [
    {
      label: "Expiring soon (14d)",
      value: r.expiringSoon,
      href: "/platform/subscriptions",
      tone: r.expiringSoon > 0 ? ("warning" as const) : ("default" as const),
      icon: <CreditCard className="h-3 w-3" />,
    },
    {
      label: "Suspended",
      value: r.suspendedSchools,
      href: "/platform/schools?status=SUSPENDED",
      tone: r.suspendedSchools > 0 ? ("danger" as const) : ("default" as const),
      icon: <Pause className="h-3 w-3" />,
    },
    {
      label: "Expired",
      value: r.expiredSchools,
      href: "/platform/schools?status=EXPIRED",
      tone: r.expiredSchools > 0 ? ("warning" as const) : ("default" as const),
      icon: <AlertTriangle className="h-3 w-3" />,
    },
    {
      label: "Inactive (30d+)",
      value: r.inactiveSchools,
      href: "/platform/schools",
      tone: "default" as const,
      icon: <ShieldAlert className="h-3 w-3" />,
    },
  ];
  return (
    <SectionCard
      title="At-risk schools"
      description="Operator-attention buckets"
      icon={<AlertTriangle className="h-3.5 w-3.5" />}
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md",
                    item.tone === "warning"
                      ? "bg-amber-100 text-amber-700"
                      : item.tone === "danger"
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-100 text-slate-600",
                  )}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    item.tone === "danger"
                      ? "text-red-700"
                      : item.tone === "warning"
                        ? "text-amber-700"
                        : "text-slate-700",
                  )}
                >
                  {item.value.toLocaleString("en-IN")}
                </span>
                <ExternalLink className="h-3 w-3 text-slate-400" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Queue panel
// ---------------------------------------------------------------------------

function QueuePanel({ analytics }: { analytics: PlatformAnalyticsPayload }) {
  const q = analytics.system.jobQueue;
  const buckets = [
    { key: "PENDING", value: q.PENDING ?? 0, tone: "info" as PillTone },
    { key: "RUNNING", value: q.RUNNING ?? 0, tone: "info" as PillTone },
    { key: "SUCCEEDED", value: q.SUCCEEDED ?? 0, tone: "success" as PillTone },
    { key: "FAILED", value: q.FAILED ?? 0, tone: "danger" as PillTone },
    { key: "DEAD", value: q.DEAD ?? 0, tone: "muted" as PillTone },
  ];
  return (
    <SectionCard
      title="Background queue"
      description="Job state breakdown"
      icon={<Database className="h-3.5 w-3.5" />}
    >
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {buckets.map((b) => (
          <li
            key={b.key}
            className="rounded-md border border-slate-100 bg-slate-50/40 p-2.5"
          >
            <StatusPill tone={b.tone} size="xs" uppercase>
              {b.key}
            </StatusPill>
            <p className="mt-1.5 text-lg font-semibold tabular-nums text-slate-900">
              {b.value.toLocaleString("en-IN")}
            </p>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Failed jobs panel
// ---------------------------------------------------------------------------

function FailedJobsCard({
  analytics,
}: {
  analytics: PlatformAnalyticsPayload;
}) {
  const jobs = analytics.system.recentFailedJobs;
  return (
    <SectionCard
      title="Recent failed jobs"
      description="Last 24h, retries exhausted"
      icon={<AlertTriangle className="h-3.5 w-3.5" />}
      tone={jobs.length > 0 ? "danger" : "default"}
      bodyClassName="p-0"
    >
      {jobs.length === 0 ? (
        <PanelEmptyState
          icon={<AlertTriangle className="h-4 w-4 text-emerald-500" />}
          title="No failed jobs in the last 24 hours"
          description="The queue is healthy."
        />
      ) : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {jobs.map((j) => (
            <li
              key={j.id}
              className="flex items-start justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <code className="font-mono text-[11px] text-slate-700">
                    {j.name}
                  </code>
                  <span className="text-[10px] text-slate-400">
                    {j.attempts} attempt{j.attempts === 1 ? "" : "s"}
                  </span>
                </div>
                {j.lastError && (
                  <p className="mt-0.5 truncate text-[11px] text-red-700 font-mono">
                    {j.lastError}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                {timeAgo(j.completedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Feature adoption
// ---------------------------------------------------------------------------

function FeatureAdoptionCard({
  analytics,
}: {
  analytics: PlatformAnalyticsPayload;
}) {
  const adoption = analytics.growth.featureAdoption;
  return (
    <SectionCard
      title="Feature adoption (overrides)"
      description="Operator-tier opt-ins per flag"
      icon={<Layers className="h-3.5 w-3.5" />}
      actions={
        <Link
          href="/platform/features"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Open matrix
          <ExternalLink className="h-3 w-3" />
        </Link>
      }
    >
      {adoption.length === 0 ? (
        <PanelEmptyState
          icon={<Layers className="h-4 w-4" />}
          title="No overrides set yet"
          description="Schools currently inherit their plan / catalog defaults."
        />
      ) : (
        <ul className="space-y-2">
          {adoption.map((a) => (
            <li key={a.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <code className="font-mono text-slate-700">{a.key}</code>
                <span className="tabular-nums text-slate-700">
                  <strong>{a.enabledCount}</strong>{" "}
                  <span className="text-slate-400">
                    · {(a.ratio * 100).toFixed(0)}%
                  </span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-700 transition-all"
                  style={{ width: `${(a.ratio * 100).toFixed(1)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityTone(s: string): PillTone {
  switch (s) {
    case "INFO":
      return "default";
    case "SUCCESS":
      return "success";
    case "WARNING":
      return "warning";
    case "ERROR":
    case "CRITICAL":
      return "danger";
    default:
      return "default";
  }
}

function timeAgo(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

// Unused-import quieting — kept for potential up-arrow / down-arrow
// indicators on KPI deltas in a future iteration.
void ArrowDown;
void ArrowUp;
void Activity;
void Loader2;

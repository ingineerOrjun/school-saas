"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Cog,
  Database,
  ExternalLink,
  Eye,
  Gauge,
  Globe2,
  Layers,
  RefreshCw,
  RotateCw,
  Send,
  Server,
  ShieldAlert,
  Timer,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import {
  operationsApi,
  type Incident,
  type IncidentSeverity,
  type JobInspectRow,
  type JobRow,
  type OpsEvent,
  type OpsHealth,
  type OpsJobMonitor,
  type OpsOverview,
  type OpsRequestMonitoring,
  type OpsSchoolHealth,
  type OpsSecurityFeed,
  type OpsSessionMonitor,
  type OpsWindow,
  type SeverityTone,
  type SubsystemHealth,
} from "@/lib/operations";
import { qk } from "@/lib/query-keys";
import { STALE } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import {
  PageHeader,
  PanelEmptyState,
  PanelErrorState,
  SectionCard,
  StatCard,
  StatsGrid,
  StatusPill,
  type PillTone,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform/operations — Phase 21 Operations Center.
//
// Single-page command center. The cockpit is structured as nine
// sections; the KPI row is sticky-visible at the top, the rest scroll.
// Each section is its own React Query (different polling cadence so
// fast-changing data refreshes more often than slow data):
//
//   • overview      — 15s (LIVE_HEALTH tier)
//   • health        — 15s
//   • events        — 15s
//   • requests      — 30s (window switch toggles the key)
//   • jobs          — 20s
//   • security      — 30s
//   • sessions      — 30s
//   • schools       — 60s (heaviest scan)
//   • incidents     — 30s
//
// Manual refresh (Refresh button) hits every query in parallel.
// All polling honours `refetchIntervalInBackground: false` so an idle
// tab doesn't burn the operator's quota.
// ---------------------------------------------------------------------------

export default function PlatformOperationsPage() {
  const qc = useQueryClient();

  // Phase performance governance — bumped from 15s → 30s. The
  // operations cockpit doesn't need sub-30s data freshness; the
  // pull on the throttler from 4 panels each polling at 15s
  // (16/min/panel × 4 = 64 reqs/min just for one open tab) wasn't
  // worth the marginal latency improvement. Operator can hit the
  // Refresh button when they want a fresher snapshot.
  const overview = useQuery<OpsOverview, ApiError>({
    queryKey: qk.platform.operations.overview,
    queryFn: () => operationsApi.getOverview(),
    staleTime: STALE.LIVE_HEALTH,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const health = useQuery<OpsHealth, ApiError>({
    queryKey: qk.platform.operations.health,
    queryFn: () => operationsApi.getHealth(),
    staleTime: STALE.LIVE_HEALTH,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const events = useQuery({
    queryKey: qk.platform.operations.events(40),
    queryFn: () => operationsApi.getEvents(40),
    staleTime: STALE.LIVE_HEALTH,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const incidents = useQuery({
    queryKey: qk.platform.operations.incidents(false),
    queryFn: () => operationsApi.listIncidents(),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const refreshAll = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["platform", "operations"] });
  }, [qc]);

  const refreshing =
    overview.isFetching || health.isFetching || events.isFetching;

  const activeIncidents = (incidents.data ?? []).filter(
    (i) => i.status === "ACTIVE",
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operations Center"
        description="Live platform pulse — load, failures, abuse, unhealthy tenants, stuck jobs, broadcast incidents."
        icon={<Cog className="h-4 w-4" />}
        actions={
          <div className="flex items-center gap-2">
            <BroadcastButton onBroadcast={refreshAll} />
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCw
                className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
              />
              Refresh
            </button>
          </div>
        }
      />

      {/* Active incident banners — sticky for CRITICAL */}
      {activeIncidents.length > 0 && (
        <div className="space-y-2">
          {activeIncidents.map((inc) => (
            <ActiveIncidentBanner
              key={inc.id}
              incident={inc}
              onResolve={() => {
                void operationsApi.resolveIncident(inc.id).then(refreshAll);
              }}
            />
          ))}
        </div>
      )}

      {/* Section 1 — Live KPI overview */}
      <Section1Overview overview={overview.data ?? null} />

      {/* Section 4 (lifted next to the KPIs because operators look at them together) */}
      <Section4Health
        data={health.data ?? null}
        loading={health.isLoading}
        error={health.error?.message ?? null}
      />

      {/* Section 2 — Request monitoring */}
      <Section2Requests />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">
          {/* Section 3 — Job queue */}
          <Section3Jobs onRefresh={refreshAll} />
          {/* Section 5 — Security feed */}
          <Section5Security />
        </div>
        <div className="space-y-4">
          {/* Section 8 — Event stream right rail */}
          <Section8EventStream
            data={events.data ?? null}
            loading={events.isLoading}
          />
          {/* Section 9 — Incidents history */}
          <Section9IncidentsHistory
            incidents={incidents.data ?? []}
            onResolve={(id) => {
              void operationsApi.resolveIncident(id).then(refreshAll);
            }}
          />
        </div>
      </div>

      {/* Section 6 — Sessions */}
      <Section6Sessions onRefresh={refreshAll} />

      {/* Section 7 — School health grid */}
      <Section7Schools />

      {/* Phase 22 — Resilience panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PhaseAbusePanel />
        <PhaseBreakersPanel />
      </div>
      <PhaseDeadLetterPanel onRetry={refreshAll} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PhaseBackupsPanel />
        <PhaseCorrelationPanel />
      </div>
    </div>
  );
}

// ===========================================================================
// Section 1 — Live system overview (KPI row)
// ===========================================================================

function Section1Overview({ overview }: { overview: OpsOverview | null }) {
  if (!overview) {
    return (
      <StatsGrid cols={4}>
        {Array.from({ length: 8 }).map((_, i) => (
          <StatCard key={i} label="—" value={null} loading />
        ))}
      </StatsGrid>
    );
  }
  const t = overview.severityTones;
  return (
    <div className="space-y-3">
      <SubsystemBanner
        status={overview.subsystemStatus}
        activeIncidents={overview.activeIncidents}
      />
      <StatsGrid cols={4}>
        <StatCard
          label="Active schools"
          value={overview.activeSchools.toLocaleString("en-IN")}
          icon={<Globe2 className="h-3 w-3" />}
        />
        <StatCard
          label="Online users · 15m"
          value={overview.onlineUsers.toLocaleString("en-IN")}
          delta={`${overview.activeSessions.toLocaleString("en-IN")} active sessions`}
          icon={<Users className="h-3 w-3" />}
        />
        <StatCard
          label="Requests / min"
          value={overview.requestsPerMin.toLocaleString("en-IN")}
          delta={`avg ${Math.round(overview.avgLatencyMs5m)}ms (5m)`}
          icon={<Activity className="h-3 w-3" />}
          tone={toneFor(t.requests)}
        />
        <StatCard
          label="Queue depth"
          value={overview.queueDepth.toLocaleString("en-IN")}
          delta={`${overview.failedJobsLastHour} failed (1h)`}
          icon={<Zap className="h-3 w-3" />}
          tone={toneFor(t.queue)}
        />
        <StatCard
          label="Errors · 1h"
          value={overview.errorsLastHour.toLocaleString("en-IN")}
          delta={`${overview.errorRatePct5m.toFixed(2)}% rate (5m)`}
          icon={<AlertTriangle className="h-3 w-3" />}
          tone={toneFor(t.errors)}
        />
        <StatCard
          label="Avg latency"
          value={Math.round(overview.avgLatencyMs5m).toLocaleString("en-IN")}
          valueSuffix="ms"
          delta="rolling 5 minutes"
          icon={<Timer className="h-3 w-3" />}
        />
        <StatCard
          label="Active impersonations"
          value={overview.activeImpersonations.toLocaleString("en-IN")}
          delta="in the last 12h"
          icon={<Eye className="h-3 w-3" />}
          tone={
            overview.activeImpersonations > 0 ? "warning" : "default"
          }
        />
        <StatCard
          label="Active incidents"
          value={overview.activeIncidents.toLocaleString("en-IN")}
          delta="broadcast & unresolved"
          icon={<AlertOctagon className="h-3 w-3" />}
          tone={toneFor(t.incidents)}
        />
      </StatsGrid>
    </div>
  );
}

function SubsystemBanner({
  status,
  activeIncidents,
}: {
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  activeIncidents: number;
}) {
  const map = {
    HEALTHY: {
      label: "All systems operational",
      tone: "border-emerald-200 bg-emerald-50/40",
      dot: "bg-emerald-500",
    },
    DEGRADED: {
      label: "One or more subsystems degraded",
      tone: "border-amber-200 bg-amber-50/40",
      dot: "bg-amber-500",
    },
    DOWN: {
      label: "Critical subsystem down",
      tone: "border-red-200 bg-red-50/40",
      dot: "bg-red-500",
    },
  } as const;
  const m = map[status];
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-2.5",
        m.tone,
      )}
    >
      <span
        className={cn(
          "inline-block h-2.5 w-2.5 rounded-full",
          m.dot,
          status !== "HEALTHY" && "animate-pulse",
        )}
        aria-hidden
      />
      <p className="text-sm font-semibold text-slate-900">{m.label}</p>
      {activeIncidents > 0 && (
        <span className="ml-auto text-[11px] text-slate-600">
          {activeIncidents} active incident{activeIncidents === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

// ===========================================================================
// Section 2 — Request monitoring
// ===========================================================================

function Section2Requests() {
  const [window, setWindow] = React.useState<OpsWindow>("15m");
  const requests = useQuery<OpsRequestMonitoring, ApiError>({
    queryKey: qk.platform.operations.requests(window),
    queryFn: () => operationsApi.getRequests(window),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const data = requests.data;

  return (
    <SectionCard
      title="Request monitoring"
      description="Endpoints by volume, latency, throttling, and errors"
      icon={<Gauge className="h-3.5 w-3.5" />}
      actions={
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5">
          {(["15m", "1h", "24h"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindow(w)}
              className={cn(
                "px-2 h-6 text-[11px] rounded font-medium",
                window === w
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {w}
            </button>
          ))}
        </div>
      }
    >
      {data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            <KvTile
              label="Requests"
              value={data.totals.requests.toLocaleString("en-IN")}
            />
            <KvTile
              label="Errors"
              value={data.totals.errors.toLocaleString("en-IN")}
              tone={data.totals.errors > 0 ? "warning" : "default"}
            />
            <KvTile
              label="Throttled"
              value={data.totals.throttled.toLocaleString("en-IN")}
              tone={data.totals.throttled > 0 ? "warning" : "default"}
            />
            <KvTile
              label="Avg ms"
              value={data.totals.avgDurationMs.toFixed(1)}
            />
            <KvTile
              label="Error rate"
              value={`${data.totals.errorRatePct.toFixed(2)}%`}
              tone={data.totals.errorRatePct > 1 ? "warning" : "default"}
            />
          </div>

          <RpmChart series={data.rpmSeries} />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <EndpointTable title="Top by volume" rows={data.topByVolume} sortKey="count" />
            <EndpointTable title="Slowest (p95)" rows={data.slowest} sortKey="p95DurationMs" />
            <EndpointTable
              title="Most throttled"
              rows={data.mostThrottled}
              sortKey="throttled"
              tone="warning"
            />
            <EndpointTable
              title="Error-heavy"
              rows={data.errorHeavy}
              sortKey="errors5xx"
              tone="danger"
            />
          </div>
        </div>
      ) : (
        <PanelEmptyState
          icon={<Activity className="h-4 w-4" />}
          title="Collecting metrics…"
          description="Request samples are gathered in-memory. The first window may be empty after a fresh restart."
        />
      )}
    </SectionCard>
  );
}

function RpmChart({ series }: { series: OpsRequestMonitoring["rpmSeries"] }) {
  const max = Math.max(1, ...series.map((b) => b.count));
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
          Requests over time
        </p>
        <p className="text-[10px] text-slate-500">
          peak {max.toLocaleString("en-IN")} / bucket
        </p>
      </div>
      <div className="flex h-20 items-end gap-[2px]">
        {series.map((b) => {
          const h = max > 0 ? (b.count / max) * 100 : 0;
          const errH = b.count > 0 ? (b.errors / b.count) * h : 0;
          const thrH = b.count > 0 ? (b.throttled / b.count) * h : 0;
          return (
            <div
              key={b.at}
              className="flex-1 relative flex flex-col-reverse"
              title={`${new Date(b.at).toLocaleTimeString()} — ${b.count} req · ${b.errors} err · ${b.throttled} 429`}
            >
              <div
                className="w-full bg-slate-300"
                style={{ height: `${Math.max(1, h)}%` }}
              />
              {errH > 0 && (
                <div
                  className="absolute bottom-0 w-full bg-red-500"
                  style={{ height: `${errH}%` }}
                />
              )}
              {thrH > 0 && (
                <div
                  className="absolute bottom-0 w-full bg-amber-500"
                  style={{ height: `${thrH}%`, marginBottom: `${errH}%` }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EndpointTable({
  title,
  rows,
  sortKey,
  tone = "default",
}: {
  title: string;
  rows: OpsRequestMonitoring["topByVolume"];
  sortKey: "count" | "p95DurationMs" | "throttled" | "errors5xx";
  tone?: "default" | "warning" | "danger";
}) {
  const headerTone =
    tone === "warning"
      ? "text-amber-700"
      : tone === "danger"
        ? "text-red-700"
        : "text-slate-700";
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className={cn("px-3 py-2 border-b border-slate-100", headerTone)}>
        <p className="text-[11px] font-semibold uppercase tracking-wide">
          {title}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-[11px] text-slate-400">No data in window.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 6).map((r) => (
            <li
              key={r.routeKey}
              className="px-3 py-2 flex items-center justify-between gap-3"
            >
              <code className="font-mono text-[11px] text-slate-700 truncate">
                {r.routeKey}
              </code>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-700">
                {sortKey === "p95DurationMs"
                  ? `${r.p95DurationMs.toFixed(0)}ms`
                  : sortKey === "throttled"
                    ? `${r.throttled} 429`
                    : sortKey === "errors5xx"
                      ? `${r.errors5xx} 5xx`
                      : `${r.count} req · ${r.avgDurationMs.toFixed(0)}ms`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ===========================================================================
// Section 3 — Job queue monitor
// ===========================================================================

function Section3Jobs({ onRefresh }: { onRefresh: () => void }) {
  const jobs = useQuery<OpsJobMonitor, ApiError>({
    queryKey: qk.platform.operations.jobs,
    queryFn: () => operationsApi.getJobs(),
    staleTime: 15_000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
  const data = jobs.data;
  const [inspecting, setInspecting] = React.useState<string | null>(null);

  const retry = useMutation({
    mutationFn: (id: string) => operationsApi.retryJob(id),
    onSuccess: onRefresh,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => operationsApi.cancelJob(id),
    onSuccess: onRefresh,
  });

  return (
    <SectionCard
      title="Job queue monitor"
      description="Live queue state, per-handler breakdown, retry / cancel"
      icon={<Database className="h-3.5 w-3.5" />}
    >
      {data ? (
        <div className="space-y-3">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {(
              ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "DEAD", "SCHEDULED"] as const
            ).map((s) => (
              <li
                key={s}
                className="rounded-md border border-slate-100 bg-slate-50/40 p-2.5"
              >
                <StatusPill tone={statusTone(s)} size="xs" uppercase>
                  {s}
                </StatusPill>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">
                  {(data.queue[s] ?? 0).toLocaleString("en-IN")}
                </p>
              </li>
            ))}
          </ul>

          {data.perHandler.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  Per-handler · 24h
                </p>
              </div>
              <table className="w-full text-[11px]">
                <thead className="text-slate-500 uppercase">
                  <tr>
                    <th className="text-left px-3 py-1 font-semibold">Handler</th>
                    <th className="text-right px-3 py-1 font-semibold">Total</th>
                    <th className="text-right px-3 py-1 font-semibold">Pending</th>
                    <th className="text-right px-3 py-1 font-semibold">Running</th>
                    <th className="text-right px-3 py-1 font-semibold">Done</th>
                    <th className="text-right px-3 py-1 font-semibold">Failed</th>
                    <th className="text-right px-3 py-1 font-semibold">Dead</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.perHandler.map((h) => (
                    <tr key={h.name}>
                      <td className="px-3 py-1.5 font-mono text-slate-700">
                        {h.name}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                        {h.total}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                        {h.pending}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                        {h.running}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">
                        {h.succeeded}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-red-700">
                        {h.failed}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                        {h.dead}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <JobList
            title="Recent failures"
            tone="danger"
            rows={data.recentFailed}
            onInspect={setInspecting}
            onRetry={(id) => retry.mutate(id)}
            onCancel={(id) => cancel.mutate(id)}
          />
          <JobList
            title="Pending"
            tone="default"
            rows={data.recentPending}
            onInspect={setInspecting}
            onRetry={(id) => retry.mutate(id)}
            onCancel={(id) => cancel.mutate(id)}
          />
        </div>
      ) : (
        <PanelEmptyState
          icon={<Database className="h-4 w-4" />}
          title="Loading queue…"
          description="One moment."
        />
      )}

      {inspecting && (
        <JobInspectModal
          jobId={inspecting}
          onClose={() => setInspecting(null)}
        />
      )}
    </SectionCard>
  );
}

function JobList({
  title,
  tone,
  rows,
  onInspect,
  onRetry,
  onCancel,
}: {
  title: string;
  tone: "default" | "danger";
  rows: JobRow[];
  onInspect: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="px-3 py-2 border-b border-slate-100">
        <p
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wide",
            tone === "danger" ? "text-red-700" : "text-slate-700",
          )}
        >
          {title} ({rows.length})
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[11px] text-slate-400">No rows.</p>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {rows.map((j) => (
            <li
              key={j.id}
              className="px-3 py-2 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <code className="font-mono text-slate-700">{j.name}</code>
                  <StatusPill tone={statusTone(j.status)} size="xs" uppercase>
                    {j.status}
                  </StatusPill>
                  <span className="text-[10px] text-slate-400">
                    {j.attempts}/{j.maxAttempts}
                  </span>
                </div>
                {j.lastError && (
                  <p className="mt-0.5 truncate text-[11px] text-red-700 font-mono">
                    {j.lastError}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-slate-400 tabular-nums">
                  {timeAgo(j.completedAt ?? j.runAt)} · runAt {timeAgo(j.runAt)}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onInspect(j.id)}
                  className="text-[10px] px-2 h-6 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                >
                  Inspect
                </button>
                {(j.status === "FAILED" || j.status === "DEAD") && (
                  <button
                    type="button"
                    onClick={() => onRetry(j.id)}
                    className="text-[10px] px-2 h-6 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  >
                    Retry
                  </button>
                )}
                {(j.status === "PENDING" || j.status === "SCHEDULED") && (
                  <button
                    type="button"
                    onClick={() => onCancel(j.id)}
                    className="text-[10px] px-2 h-6 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JobInspectModal({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const detail = useQuery<JobInspectRow, ApiError>({
    queryKey: qk.platform.operations.jobDetail(jobId),
    queryFn: () => operationsApi.inspectJob(jobId),
  });
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">
            Job <code className="font-mono text-xs">{jobId.slice(0, 8)}</code>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-auto p-4 text-xs">
          {detail.data ? (
            <pre className="font-mono whitespace-pre-wrap text-slate-700">
              {JSON.stringify(detail.data, null, 2)}
            </pre>
          ) : (
            <p className="text-slate-500">Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Section 4 — Subsystem health grid
// ===========================================================================

function Section4Health({
  data,
  loading,
  error,
}: {
  data: OpsHealth | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return <PanelErrorState message={error} />;
  }
  return (
    <SectionCard
      title="Platform health"
      description="DB, queue, dispatcher, scheduler, email, cache"
      icon={<Server className="h-3.5 w-3.5" />}
      tone={
        data?.worstStatus === "DOWN"
          ? "danger"
          : data?.worstStatus === "DEGRADED"
            ? "warning"
            : "default"
      }
    >
      {loading || !data ? (
        <p className="text-xs text-slate-500">Probing subsystems…</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.subsystems.map((s) => (
            <SubsystemCard key={s.key} sub={s} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function SubsystemCard({ sub }: { sub: SubsystemHealth }) {
  const tone =
    sub.status === "DOWN"
      ? "border-red-200 bg-red-50/40"
      : sub.status === "DEGRADED"
        ? "border-amber-200 bg-amber-50/40"
        : "border-emerald-200 bg-emerald-50/40";
  const dot =
    sub.status === "DOWN"
      ? "bg-red-500"
      : sub.status === "DEGRADED"
        ? "bg-amber-500"
        : "bg-emerald-500";
  return (
    <li className={cn("rounded-md border p-3", tone)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-900">{sub.label}</p>
        <span
          className={cn(
            "h-2 w-2 rounded-full mt-1",
            dot,
            sub.status !== "HEALTHY" && "animate-pulse",
          )}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-700">{sub.detail}</p>
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 tabular-nums">
        <span>uptime 24h</span>
        <span className="font-semibold">
          {(sub.uptime24h * 100).toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full",
            sub.uptime24h > 0.99
              ? "bg-emerald-500"
              : sub.uptime24h > 0.95
                ? "bg-amber-500"
                : "bg-red-500",
          )}
          style={{ width: `${Math.max(2, sub.uptime24h * 100).toFixed(1)}%` }}
        />
      </div>
    </li>
  );
}

// ===========================================================================
// Section 5 — Security feed
// ===========================================================================

function Section5Security() {
  const sec = useQuery<OpsSecurityFeed, ApiError>({
    queryKey: qk.platform.operations.security({ limit: 50 }),
    queryFn: () => operationsApi.getSecurity({ limit: 50 }),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  return (
    <SectionCard
      title="Security operations"
      description="Failed logins, force-logouts, impersonations, throttle spikes"
      icon={<ShieldAlert className="h-3.5 w-3.5" />}
      bodyClassName="p-0"
    >
      {!sec.data || sec.data.events.length === 0 ? (
        <PanelEmptyState
          icon={<ShieldAlert className="h-4 w-4" />}
          title="No security events"
          description="Nothing to flag in the last 24 hours."
        />
      ) : (
        <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
          {sec.data.events.map((e) => (
            <li
              key={e.id}
              className={cn(
                "flex items-start gap-3 px-4 py-2.5",
                e.severity === "red" && "bg-red-50/30",
              )}
            >
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                  e.severity === "red"
                    ? "bg-red-500"
                    : e.severity === "amber"
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <StatusPill
                    tone={e.severity === "red" ? "danger" : "warning"}
                    size="xs"
                    uppercase
                  >
                    {e.category.replace("_", " ")}
                  </StatusPill>
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {timeAgo(e.at)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-800">{e.description}</p>
                {(e.actor || e.schoolName) && (
                  <p className="text-[10px] text-slate-500">
                    {e.actor && <span>actor {e.actor}</span>}
                    {e.actor && e.schoolName && " · "}
                    {e.schoolName && <span>school {e.schoolName}</span>}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ===========================================================================
// Section 6 — Sessions
// ===========================================================================

function Section6Sessions({ onRefresh }: { onRefresh: () => void }) {
  const [q, setQ] = React.useState("");
  const [onlyOnline, setOnlyOnline] = React.useState(false);
  const sessions = useQuery<OpsSessionMonitor, ApiError>({
    queryKey: qk.platform.operations.sessions({ q, onlyOnline }),
    queryFn: () => operationsApi.getSessions({ q, onlyOnline, limit: 80 }),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const revoke = useMutation({
    mutationFn: ({ userId, sessionId }: { userId: string; sessionId: string }) =>
      operationsApi.revokeSession(userId, sessionId),
    onSuccess: onRefresh,
  });
  const revokeAll = useMutation({
    mutationFn: (userId: string) => operationsApi.revokeAllSessions(userId),
    onSuccess: onRefresh,
  });
  const data = sessions.data;
  return (
    <SectionCard
      title="Active sessions"
      description={
        data
          ? `${data.totals.active} active · ${data.totals.onlineLast15m} online in the last 15 minutes`
          : "Loading…"
      }
      icon={<Users className="h-3.5 w-3.5" />}
      actions={
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search email or school…"
            className="h-7 w-56 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-800"
          />
          <label className="flex items-center gap-1 text-[11px] text-slate-700">
            <input
              type="checkbox"
              checked={onlyOnline}
              onChange={(e) => setOnlyOnline(e.target.checked)}
            />
            Online only
          </label>
        </div>
      }
      bodyClassName="p-0"
    >
      {!data || data.rows.length === 0 ? (
        <PanelEmptyState
          icon={<Users className="h-4 w-4" />}
          title="No active sessions"
          description="No sessions match the filter."
        />
      ) : (
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-[11px]">
            <thead className="text-slate-500 uppercase bg-slate-50/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-semibold">User</th>
                <th className="text-left px-3 py-1.5 font-semibold">School</th>
                <th className="text-left px-3 py-1.5 font-semibold">IP</th>
                <th className="text-left px-3 py-1.5 font-semibold">UA</th>
                <th className="text-left px-3 py-1.5 font-semibold">Last active</th>
                <th className="text-right px-3 py-1.5 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.rows.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/40">
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {s.online && (
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      )}
                      <span className="text-slate-800">{s.user.email}</span>
                      <span className="text-[10px] text-slate-400">
                        {s.user.role}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">
                    {s.school?.name ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-slate-600">
                    {s.ip ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 truncate max-w-[200px] text-slate-500">
                    {s.userAgent ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-slate-500">
                    {timeAgo(s.lastActiveAt)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        revoke.mutate({
                          userId: s.user.id,
                          sessionId: s.id,
                        })
                      }
                      disabled={revoke.isPending}
                      className="text-[10px] px-2 h-6 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                    <button
                      type="button"
                      onClick={() => revokeAll.mutate(s.user.id)}
                      disabled={revokeAll.isPending}
                      className="ml-1 text-[10px] px-2 h-6 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      Revoke all
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ===========================================================================
// Section 7 — School health grid
// ===========================================================================

function Section7Schools() {
  const grid = useQuery<OpsSchoolHealth, ApiError>({
    queryKey: qk.platform.operations.schools,
    queryFn: () => operationsApi.getSchools(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const rows = grid.data?.rows ?? [];
  return (
    <SectionCard
      title="School health grid"
      description="Per-tenant pulse — operators spot unhealthy tenants at a glance"
      icon={<Layers className="h-3.5 w-3.5" />}
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <PanelEmptyState
          icon={<Layers className="h-4 w-4" />}
          title="No schools yet"
          description="Once tenants are onboarded their pulse appears here."
        />
      ) : (
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-[11px]">
            <thead className="text-slate-500 uppercase bg-slate-50/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-semibold">School</th>
                <th className="text-left px-3 py-1.5 font-semibold">Status</th>
                <th className="text-left px-3 py-1.5 font-semibold">Plan</th>
                <th className="text-right px-3 py-1.5 font-semibold">Online</th>
                <th className="text-right px-3 py-1.5 font-semibold">Activity 24h</th>
                <th className="text-right px-3 py-1.5 font-semibold">Job fails</th>
                <th className="text-left px-3 py-1.5 font-semibold">Latest critical</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((s) => (
                <tr
                  key={s.id}
                  className={cn(
                    "hover:bg-slate-50/40",
                    s.queueFailures24h > 0 && "bg-red-50/20",
                    s.latestCritical?.severity === "CRITICAL" &&
                      "bg-red-50/40",
                  )}
                >
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/platform/schools/${s.id}`}
                      className="text-slate-800 hover:underline inline-flex items-center gap-1"
                    >
                      {s.name}
                      <ExternalLink className="h-2.5 w-2.5 text-slate-400" />
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusPill
                      tone={schoolStatusTone(s.status)}
                      size="xs"
                      uppercase
                    >
                      {s.status}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-1.5 text-slate-700">
                    {s.plan ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {s.onlineUsers}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {s.activityCount24h}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right tabular-nums",
                      s.queueFailures24h > 0 ? "text-red-700" : "text-slate-400",
                    )}
                  >
                    {s.queueFailures24h}
                  </td>
                  <td className="px-3 py-1.5 truncate max-w-[200px] text-slate-700">
                    {s.latestCritical
                      ? `[${s.latestCritical.severity}] ${s.latestCritical.title}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ===========================================================================
// Section 8 — Real-time event stream (right rail)
// ===========================================================================

function Section8EventStream({
  data,
  loading,
}: {
  data: { events: OpsEvent[] } | null;
  loading: boolean;
}) {
  return (
    <SectionCard
      title="Live event stream"
      description="Recent platform activity"
      icon={<Activity className="h-3.5 w-3.5" />}
      bodyClassName="p-0"
    >
      {loading ? (
        <p className="px-4 py-3 text-xs text-slate-500">Loading…</p>
      ) : !data || data.events.length === 0 ? (
        <PanelEmptyState
          icon={<Activity className="h-4 w-4" />}
          title="Quiet"
          description="No events to show."
        />
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {data.events.map((e) => (
            <li
              key={e.id}
              className="px-3 py-2 flex items-start gap-2.5 text-[11px]"
            >
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 rounded-full shrink-0",
                  e.severity === "red"
                    ? "bg-red-500"
                    : e.severity === "amber"
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-slate-800 truncate">{e.description}</p>
                <p className="text-[10px] text-slate-400 tabular-nums">
                  {e.kind.replace("_", " ").toLowerCase()} · {timeAgo(e.at)}
                  {e.tag && ` · ${e.tag}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ===========================================================================
// Section 9 — Incidents (active banner + history + composer)
// ===========================================================================

function ActiveIncidentBanner({
  incident,
  onResolve,
}: {
  incident: Incident;
  onResolve: () => void;
}) {
  const tone =
    incident.severity === "CRITICAL"
      ? "border-red-300 bg-red-50"
      : incident.severity === "WARNING"
        ? "border-amber-300 bg-amber-50"
        : "border-blue-200 bg-blue-50/60";
  const dotTone =
    incident.severity === "CRITICAL"
      ? "bg-red-500"
      : incident.severity === "WARNING"
        ? "bg-amber-500"
        : "bg-blue-500";
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 flex items-start gap-3",
        tone,
        incident.severity === "CRITICAL" && "shadow-sm",
      )}
    >
      <span
        className={cn(
          "mt-1.5 h-2.5 w-2.5 rounded-full shrink-0",
          dotTone,
          incident.severity === "CRITICAL" && "animate-pulse",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-700">
            {incident.severity}
          </span>
          <span className="text-[10px] text-slate-500">
            {timeAgo(incident.createdAt)} · {incident.targetScope === "ALL_SCHOOLS" ? "all schools" : `${incident.targetSchoolIds.length} schools`} · ↪ {incident.inAppFanOut} in-app · ↪ {incident.emailFanOut} email
          </span>
        </div>
        <p className="mt-1 text-sm font-semibold text-slate-900">
          {incident.title}
        </p>
        <p className="mt-0.5 text-xs text-slate-700 whitespace-pre-wrap">
          {incident.body}
        </p>
      </div>
      <button
        type="button"
        onClick={onResolve}
        className="shrink-0 inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
      >
        <CheckCircle2 className="h-3 w-3" />
        Mark resolved
      </button>
    </div>
  );
}

function Section9IncidentsHistory({
  incidents,
  onResolve,
}: {
  incidents: Incident[];
  onResolve: (id: string) => void;
}) {
  const resolved = incidents.filter((i) => i.status === "RESOLVED");
  return (
    <SectionCard
      title="Incident history"
      description={`${incidents.length} total · ${resolved.length} resolved`}
      icon={<BellRing className="h-3.5 w-3.5" />}
      bodyClassName="p-0"
    >
      {incidents.length === 0 ? (
        <PanelEmptyState
          icon={<BellRing className="h-4 w-4" />}
          title="No incidents broadcast"
          description="Operator-broadcast messages appear here when active or resolved."
        />
      ) : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {incidents.map((i) => (
            <li
              key={i.id}
              className="px-3 py-2 flex items-start gap-3 text-[11px]"
            >
              <StatusPill
                tone={
                  i.severity === "CRITICAL"
                    ? "danger"
                    : i.severity === "WARNING"
                      ? "warning"
                      : "info"
                }
                size="xs"
                uppercase
              >
                {i.severity}
              </StatusPill>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800 truncate">
                  {i.title}
                </p>
                <p className="text-[10px] text-slate-500">
                  {timeAgo(i.createdAt)} ·{" "}
                  {i.status === "ACTIVE" ? (
                    <span className="text-amber-700 font-medium">ACTIVE</span>
                  ) : (
                    <span>resolved {i.resolvedAt ? timeAgo(i.resolvedAt) : ""}</span>
                  )}
                </p>
              </div>
              {i.status === "ACTIVE" && (
                <button
                  type="button"
                  onClick={() => onResolve(i.id)}
                  className="text-[10px] px-2 h-6 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                >
                  Resolve
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function BroadcastButton({ onBroadcast }: { onBroadcast: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
      >
        <Send className="h-3.5 w-3.5" />
        Broadcast incident
      </button>
      {open && (
        <BroadcastIncidentModal
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            onBroadcast();
          }}
        />
      )}
    </>
  );
}

function BroadcastIncidentModal({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: () => void;
}) {
  const [severity, setSeverity] = React.useState<IncidentSeverity>("INFO");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [targetScope, setTargetScope] = React.useState<
    "ALL_SCHOOLS" | "SPECIFIC_SCHOOLS"
  >("ALL_SCHOOLS");
  const [schoolIdsRaw, setSchoolIdsRaw] = React.useState("");

  const broadcast = useMutation({
    mutationFn: () =>
      operationsApi.broadcastIncident({
        severity,
        title,
        body,
        targetScope,
        targetSchoolIds:
          targetScope === "ALL_SCHOOLS"
            ? []
            : schoolIdsRaw
                .split(/[\s,]+/)
                .map((s) => s.trim())
                .filter(Boolean),
      }),
    onSuccess: onSent,
  });

  const canSend = title.trim().length >= 3 && body.trim().length >= 3;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 max-w-lg w-full overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">
            Broadcast incident
          </p>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Severity
            </label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(["INFO", "WARNING", "CRITICAL"] as IncidentSeverity[]).map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSeverity(s)}
                    className={cn(
                      "h-8 rounded-md border text-[11px] font-medium",
                      severity === s
                        ? s === "CRITICAL"
                          ? "border-red-500 bg-red-500 text-white"
                          : s === "WARNING"
                            ? "border-amber-500 bg-amber-500 text-white"
                            : "border-blue-500 bg-blue-500 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    {s}
                  </button>
                ),
              )}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Payment gateway degraded"
              className="mt-1 w-full h-8 rounded-md border border-slate-200 px-2 text-xs text-slate-800"
              maxLength={160}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Operators will read this in their notification center + email."
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-800"
              maxLength={4000}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Scope
            </label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTargetScope("ALL_SCHOOLS")}
                className={cn(
                  "h-8 rounded-md border text-[11px] font-medium",
                  targetScope === "ALL_SCHOOLS"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                All active schools
              </button>
              <button
                type="button"
                onClick={() => setTargetScope("SPECIFIC_SCHOOLS")}
                className={cn(
                  "h-8 rounded-md border text-[11px] font-medium",
                  targetScope === "SPECIFIC_SCHOOLS"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                Selected schools
              </button>
            </div>
            {targetScope === "SPECIFIC_SCHOOLS" && (
              <textarea
                value={schoolIdsRaw}
                onChange={(e) => setSchoolIdsRaw(e.target.value)}
                rows={2}
                placeholder="School IDs (UUIDs), comma or whitespace-separated"
                className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs font-mono text-slate-800"
              />
            )}
          </div>
          {broadcast.error && (
            <p className="text-[11px] text-red-700">
              {(broadcast.error as Error).message}
            </p>
          )}
        </div>
        <div className="border-t border-slate-200 px-4 py-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 text-[11px] rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSend || broadcast.isPending}
            onClick={() => broadcast.mutate()}
            className="h-8 px-3 text-[11px] rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {broadcast.isPending ? "Broadcasting…" : "Broadcast"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function KvTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
}) {
  const toneCls =
    tone === "warning"
      ? "border-amber-200 bg-amber-50/40 text-amber-900"
      : tone === "danger"
        ? "border-red-200 bg-red-50/40 text-red-900"
        : "border-slate-200 bg-white text-slate-900";
  return (
    <div className={cn("rounded-md border p-2.5", toneCls)}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function statusTone(status: string): PillTone {
  switch (status) {
    case "PENDING":
    case "SCHEDULED":
      return "info";
    case "RUNNING":
      return "info";
    case "SUCCEEDED":
      return "success";
    case "FAILED":
      return "danger";
    case "DEAD":
      return "muted";
    default:
      return "default";
  }
}

function schoolStatusTone(status: string): PillTone {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "TRIAL":
      return "info";
    case "SUSPENDED":
      return "danger";
    case "EXPIRED":
      return "warning";
    default:
      return "default";
  }
}

function toneFor(t: SeverityTone): "default" | "warning" | "danger" {
  switch (t) {
    case "amber":
      return "warning";
    case "red":
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

// ===========================================================================
// Phase 22 panels — added at the bottom of the cockpit. Each is a
// self-contained React Query consumer; the parent only needs to
// invalidate queries to refresh them after operator actions.
// ===========================================================================

function PhaseAbusePanel() {
  const abuse = useQuery({
    queryKey: qk.platform.operations.abuse,
    queryFn: () => operationsApi.getAbuse(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const data = abuse.data;
  return (
    <SectionCard
      title="Potential abuse"
      description="Top throttled IPs / users / endpoints since process start"
      icon={<ShieldAlert className="h-3.5 w-3.5" />}
      tone={data?.abuseDetected ? "danger" : "default"}
      bodyClassName="p-0"
    >
      {!data ? (
        <p className="px-4 py-3 text-xs text-slate-500">Loading…</p>
      ) : data.topThrottledIps.length === 0 &&
        data.topThrottledUsers.length === 0 ? (
        <PanelEmptyState
          icon={<ShieldAlert className="h-4 w-4 text-emerald-500" />}
          title="No throttling activity"
          description="Nothing has hit a 429 since process start."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          <AbuseList title="By IP" rows={data.topThrottledIps.map((r) => ({ key: r.ip, count: r.count }))} />
          <AbuseList title="By user" rows={data.topThrottledUsers.map((r) => ({ key: r.userId, count: r.count }))} />
          <AbuseList title="By endpoint" rows={data.topThrottledRoutes.map((r) => ({ key: r.routeKey, count: r.count }))} />
        </div>
      )}
    </SectionCard>
  );
}

function AbuseList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; count: number }>;
}) {
  return (
    <div className="p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 mb-1.5">
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-400">—</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 5).map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between text-[11px]"
            >
              <code className="font-mono text-slate-700 truncate max-w-[180px]">
                {r.key}
              </code>
              <span
                className={cn(
                  "shrink-0 tabular-nums font-semibold",
                  r.count >= 100 ? "text-red-700" : "text-slate-700",
                )}
              >
                {r.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PhaseBreakersPanel() {
  const breakers = useQuery({
    queryKey: qk.platform.operations.breakers,
    queryFn: () => operationsApi.getBreakers(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const data = breakers.data;
  return (
    <SectionCard
      title="Circuit breakers"
      description="Email + future SMS / payment integrations"
      icon={<Activity className="h-3.5 w-3.5" />}
      tone={
        data?.breakers.some((b) => b.state === "OPEN")
          ? "danger"
          : data?.breakers.some((b) => b.state === "HALF_OPEN")
            ? "warning"
            : "default"
      }
    >
      {!data ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {data.breakers.map((b) => (
            <li
              key={b.name}
              className={cn(
                "rounded-md border p-3",
                b.state === "OPEN"
                  ? "border-red-200 bg-red-50/40"
                  : b.state === "HALF_OPEN"
                    ? "border-amber-200 bg-amber-50/40"
                    : "border-emerald-200 bg-emerald-50/40",
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900">{b.name}</p>
                <StatusPill
                  tone={
                    b.state === "OPEN"
                      ? "danger"
                      : b.state === "HALF_OPEN"
                        ? "warning"
                        : "success"
                  }
                  size="xs"
                  uppercase
                >
                  {b.state}
                </StatusPill>
              </div>
              <p className="mt-1 text-[11px] text-slate-700 tabular-nums">
                {b.totalSuccess.toLocaleString("en-IN")} ok ·{" "}
                {b.totalFailure.toLocaleString("en-IN")} fail ·{" "}
                {b.totalShortCircuited.toLocaleString("en-IN")} short-circuited
              </p>
              {b.state === "OPEN" && b.nextHalfOpenAt && (
                <p className="text-[10px] text-red-700 mt-0.5">
                  cooling down · probe {timeAgo(b.nextHalfOpenAt)} (target)
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PhaseDeadLetterPanel({ onRetry }: { onRetry: () => void }) {
  const [filterName, setFilterName] = React.useState("");
  const dl = useQuery({
    queryKey: qk.platform.operations.deadLetters({ name: filterName }),
    queryFn: () =>
      operationsApi.getDeadLetters({
        name: filterName || undefined,
        limit: 50,
      }),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const bulkRetry = useMutation({
    mutationFn: () =>
      operationsApi.bulkRetryDeadLetters({
        name: filterName || undefined,
      }),
    onSuccess: () => {
      onRetry();
    },
  });
  const retryOne = useMutation({
    mutationFn: (id: string) => operationsApi.retryJob(id),
    onSuccess: onRetry,
  });
  const data = dl.data;
  const total = data?.rows.length ?? 0;

  return (
    <SectionCard
      title="Dead letter queue"
      description="Jobs whose retry budget exhausted — operator action required"
      icon={<AlertOctagon className="h-3.5 w-3.5" />}
      tone={total > 0 ? "danger" : "default"}
      actions={
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="Filter by handler name…"
            className="h-7 w-48 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-800"
          />
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `Retry every dead-letter row${filterName ? ` matching "${filterName}"` : ""}? This re-queues the matching jobs from a clean slate.`,
                )
              ) {
                bulkRetry.mutate();
              }
            }}
            disabled={total === 0 || bulkRetry.isPending}
            className="h-7 px-2 text-[11px] rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            Bulk retry
          </button>
        </div>
      }
      bodyClassName="p-0"
    >
      {total === 0 ? (
        <PanelEmptyState
          icon={<AlertOctagon className="h-4 w-4 text-emerald-500" />}
          title="Dead letter queue is empty"
          description="Either nothing has exhausted retries yet, or operators have already cleared it."
        />
      ) : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {data!.rows.map((r) => (
            <li
              key={r.id}
              className="px-4 py-2.5 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <code className="font-mono text-slate-700">{r.name}</code>
                  <span className="text-[10px] text-slate-400">
                    attempts {r.attempts}/{r.maxAttempts}
                  </span>
                  {r.correlationId && (
                    <code className="font-mono text-[10px] text-slate-400">
                      cid={r.correlationId.slice(0, 8)}
                    </code>
                  )}
                </div>
                {r.lastError && (
                  <p className="mt-0.5 truncate text-[11px] text-red-700 font-mono">
                    {r.lastError}
                  </p>
                )}
                <p className="text-[10px] text-slate-400">
                  failed {r.completedAt ? timeAgo(r.completedAt) : "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => retryOne.mutate(r.id)}
                disabled={retryOne.isPending}
                className="shrink-0 text-[10px] px-2 h-6 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                Retry
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PhaseBackupsPanel() {
  const backups = useQuery({
    queryKey: qk.platform.operations.backups,
    queryFn: () => operationsApi.getBackups(),
    staleTime: 5 * 60_000,
  });
  const data = backups.data;
  return (
    <SectionCard
      title="Backup & disaster recovery"
      description="Snapshot inventory + restore foundations"
      icon={<Database className="h-3.5 w-3.5" />}
      tone={data?.capability.configured ? "default" : "warning"}
    >
      {!data ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : !data.capability.configured ? (
        <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3">
          <p className="text-xs font-semibold text-amber-900">
            Not yet configured
          </p>
          <p className="mt-1 text-[11px] text-amber-800 leading-relaxed">
            {data.capability.notice}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.snapshots.slice(0, 8).map((s) => (
            <li key={s.id} className="py-2 flex items-center justify-between">
              <span className="text-xs text-slate-700">
                {s.kind} · {s.storage} · {timeAgo(s.startedAt)}
              </span>
              <StatusPill
                tone={
                  s.status === "SUCCEEDED"
                    ? "success"
                    : s.status === "FAILED"
                      ? "danger"
                      : "info"
                }
                size="xs"
                uppercase
              >
                {s.status}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PhaseCorrelationPanel() {
  const [query, setQuery] = React.useState("");
  const [submitted, setSubmitted] = React.useState<string | null>(null);
  const trace = useQuery({
    queryKey: qk.platform.operations.correlation(submitted ?? ""),
    queryFn: () => operationsApi.getCorrelationTrace(submitted!),
    enabled: !!submitted,
  });
  return (
    <SectionCard
      title="Correlation inspector"
      description="Paste an x-request-id from a customer report to trace its impact"
      icon={<Activity className="h-3.5 w-3.5" />}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const value = query.trim();
          if (value.length === 0) return;
          setSubmitted(value);
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="x-request-id"
          className="flex-1 h-8 rounded-md border border-slate-200 bg-white px-2 font-mono text-[11px] text-slate-800"
        />
        <button
          type="submit"
          className="h-8 px-3 text-[11px] rounded-md bg-slate-900 text-white hover:bg-slate-800"
        >
          Trace
        </button>
      </form>
      {submitted && trace.data && (
        <div className="mt-3 space-y-3">
          <CorrelationGroup
            title="Audit"
            count={trace.data.audit.length}
            rows={trace.data.audit.map((r) => ({
              key: r.id,
              primary: `${r.action} ${r.target ?? ""}`,
              secondary: `${r.actor ?? "?"} · ${timeAgo(r.at)}`,
            }))}
          />
          <CorrelationGroup
            title="Jobs"
            count={trace.data.jobs.length}
            rows={trace.data.jobs.map((j) => ({
              key: j.id,
              primary: `${j.name} · ${j.status}`,
              secondary: j.lastError ?? timeAgo(j.createdAt),
            }))}
          />
          <CorrelationGroup
            title="Notifications"
            count={trace.data.notifications.length}
            rows={trace.data.notifications.map((n) => ({
              key: n.id,
              primary: n.title ?? n.templateKey,
              secondary: `${n.severity} · ${timeAgo(n.createdAt)}`,
            }))}
          />
          <CorrelationGroup
            title="Incidents"
            count={trace.data.incidents.length}
            rows={trace.data.incidents.map((i) => ({
              key: i.id,
              primary: `[${i.severity}] ${i.title}`,
              secondary: `${i.status} · ${timeAgo(i.createdAt)}`,
            }))}
          />
        </div>
      )}
      {submitted && trace.data && [trace.data.audit.length, trace.data.jobs.length, trace.data.notifications.length, trace.data.incidents.length].every((n) => n === 0) && (
        <p className="mt-3 text-[11px] text-slate-500">
          No artifacts found for this correlation id.
        </p>
      )}
    </SectionCard>
  );
}

function CorrelationGroup({
  title,
  count,
  rows,
}: {
  title: string;
  count: number;
  rows: Array<{ key: string; primary: string; secondary: string }>;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
        {title} ({count})
      </p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-slate-400">—</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100 border border-slate-100 rounded-md max-h-40 overflow-y-auto">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key} className="px-2 py-1.5">
              <p className="text-[11px] text-slate-800 truncate">{r.primary}</p>
              <p className="text-[10px] text-slate-500 truncate">
                {r.secondary}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Quiet unused-import warnings for lucide icons we may want later.
void RefreshCw;

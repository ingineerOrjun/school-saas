"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  Cpu,
  Database,
  Loader2,
  RotateCw,
  ShieldAlert,
  Timer,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { platformApi, type HealthPayload } from "@/lib/platform";
import { qk } from "@/lib/query-keys";
import { STALE } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import {
  PageHeader,
  PanelErrorState,
  PanelLoadingState,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform/health — Phase 10 operator pulse dashboard.
//
// Layout:
//
//   [ Status banner — green/yellow/red roll-up ]
//
//   [ Uptime card ][ Memory card ][ DB card ]
//
//   [ Errors card                  ][ Login failures card           ]
//   [   • last 5/15/60min counts    ][   • last 5/15/60min counts    ]
//   [   • recent error log tail     ][   • top source IPs            ]
//   [                               ][   • recent failure tail        ]
//
// Polling:
//   Every 30s by default. The "Refresh" button forces an immediate
//   fetch. We keep the previous payload visible while a refresh is
//   in flight (no flicker on every poll); a small spinner overlays
//   the refresh button when one is running.
//
// Failure mode:
//   If /platform/health itself errors, we show an inline banner.
//   The dashboard's own success is a meaningful signal — if the API
//   can't even tell you what's wrong, that's the operator's first
//   clue.
// ---------------------------------------------------------------------------

// Live operator pulse — fast-lane query.
//   • staleTime: 15s — within the window, repeat reads return cached.
//   • refetchInterval: 30s — background poll keeps the page live
//     without the operator clicking Refresh.
//   • Multiple operators (or multiple tabs of the same operator)
//     share ONE underlying poll because the query key is shared.
//
// Compare to /platform/analytics (slow lane) below: that one is
// staleTime 2m, no polling. The two queries are deliberately split
// so health doesn't drag the heavier analytics scan with it.
export default function PlatformHealthPage() {
  const {
    data,
    isLoading: loading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<HealthPayload, ApiError>({
    queryKey: qk.platform.health,
    queryFn: () => platformApi.getHealth(),
    staleTime: STALE.LIVE_HEALTH,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  // `isFetching` covers both initial + background refetch — the
  // refresh button uses it to spin during a background tick.
  const refreshing = isFetching && !loading;

  if (loading && !data) {
    return <PanelLoadingState />;
  }
  if ((isError || !data) && !data) {
    return (
      <PanelErrorState
        message={error?.message ?? "Could not load health."}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="System health"
        description="Live operator pulse. Auto-refreshes every 30 seconds."
        icon={<Activity className="h-4 w-4" />}
        actions={
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </button>
        }
      />

      <StatusBanner status={data.status} generatedAt={data.generatedAt} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <UptimeCard health={data} />
        <MemoryCard health={data} />
        <DatabaseCard health={data} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ErrorsCard health={data} />
        <LoginFailuresCard health={data} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status banner — green/yellow/red roll-up.
// ---------------------------------------------------------------------------

function StatusBanner({
  status,
  generatedAt,
}: {
  status: HealthPayload["status"];
  generatedAt: string;
}) {
  const map: Record<
    HealthPayload["status"],
    { label: string; tone: string; description: string }
  > = {
    green: {
      label: "All systems operational",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      description: "DB healthy, error rate quiet, no auth pressure.",
    },
    yellow: {
      label: "Elevated activity",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      description:
        "DB is up, but error rate or login failures are above normal. Investigate before it escalates.",
    },
    red: {
      label: "Degraded — DB probe failed",
      tone: "border-red-200 bg-red-50 text-red-800",
      description:
        "The database health probe could not complete. Until this clears, every tenant is affected.",
    },
  };
  const m = map[status];
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        m.tone,
      )}
    >
      <StatusDot status={status} large />
      <div className="flex-1">
        <p className="text-sm font-semibold">{m.label}</p>
        <p className="mt-0.5 text-xs opacity-80">{m.description}</p>
      </div>
      <p className="text-[10px] uppercase tracking-wider opacity-60">
        Sampled{" "}
        {new Date(generatedAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </p>
    </div>
  );
}

function StatusDot({
  status,
  large,
}: {
  status: HealthPayload["status"];
  large?: boolean;
}) {
  const tone =
    status === "green"
      ? "bg-emerald-500"
      : status === "yellow"
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span
      className={cn(
        "inline-block rounded-full",
        large ? "mt-1 h-3 w-3" : "h-2 w-2",
        tone,
        status !== "green" && "animate-pulse",
      )}
      aria-hidden
    />
  );
}

// ---------------------------------------------------------------------------
// Uptime / Memory / DB cards
// ---------------------------------------------------------------------------

function UptimeCard({ health }: { health: HealthPayload }) {
  return (
    <Card icon={<Timer className="h-4 w-4" />} label="Uptime">
      <p className="text-2xl font-semibold tabular-nums text-slate-900">
        {health.uptime.pretty}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Started{" "}
        {new Date(health.uptime.startedAt).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>
    </Card>
  );
}

function MemoryCard({ health }: { health: HealthPayload }) {
  // Heap usage as a percent of total — mostly informational. V8 GC
  // runs aggressively so 60-90% is perfectly normal.
  const pct =
    health.memory.heapTotalMb > 0
      ? Math.round(
          (health.memory.heapUsedMb / health.memory.heapTotalMb) * 100,
        )
      : 0;
  return (
    <Card icon={<Cpu className="h-4 w-4" />} label="Memory">
      <p className="text-2xl font-semibold tabular-nums text-slate-900">
        {health.memory.rssMb} <span className="text-sm font-normal">MB</span>
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        Heap {health.memory.heapUsedMb} / {health.memory.heapTotalMb} MB ·{" "}
        {pct}%
      </p>
    </Card>
  );
}

function DatabaseCard({ health }: { health: HealthPayload }) {
  return (
    <Card icon={<Database className="h-4 w-4" />} label="Database">
      <div className="flex items-baseline gap-2">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            health.database.healthy ? "text-slate-900" : "text-red-700",
          )}
        >
          {health.database.healthy
            ? `${health.database.latencyMs ?? "?"} `
            : "Down"}
          {health.database.healthy && (
            <span className="text-sm font-normal">ms</span>
          )}
        </p>
        <StatusDot status={health.database.healthy ? "green" : "red"} />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {health.database.healthy
          ? "SELECT 1 round-trip"
          : (health.database.error ?? "Probe failed")}
      </p>
    </Card>
  );
}

function Card({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Errors + Login Failures
// ---------------------------------------------------------------------------

function ErrorsCard({ health }: { health: HealthPayload }) {
  return (
    <DetailCard
      icon={<AlertTriangle className="h-4 w-4" />}
      label="Server errors"
      counts={[
        { label: "5 min", value: health.errors.last5min },
        { label: "15 min", value: health.errors.last15min },
        { label: "60 min", value: health.errors.last60min },
        { label: "Total", value: health.errors.totalSinceStart },
      ]}
    >
      {health.errors.recent.length === 0 ? (
        <EmptyState message="No errors recorded since startup." />
      ) : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {health.errors.recent.map((e, idx) => (
            <li key={idx} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span
                      className={cn(
                        "rounded-sm px-1.5 py-0.5 font-bold",
                        e.status >= 500
                          ? "bg-red-100 text-red-700"
                          : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {e.status}
                    </span>
                    <span className="font-semibold text-slate-700">
                      {e.method}
                    </span>
                    <span className="truncate text-slate-600">{e.route}</span>
                  </div>
                  <p className="mt-0.5 truncate text-slate-500">{e.message}</p>
                </div>
                <span className="shrink-0 text-[10px] text-slate-400">
                  {timeAgo(e.at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}

function LoginFailuresCard({ health }: { health: HealthPayload }) {
  return (
    <DetailCard
      icon={<ShieldAlert className="h-4 w-4" />}
      label="Login failures"
      counts={[
        { label: "5 min", value: health.loginFailures.last5min },
        { label: "15 min", value: health.loginFailures.last15min },
        { label: "60 min", value: health.loginFailures.last60min },
        { label: "Total", value: health.loginFailures.totalSinceStart },
      ]}
    >
      {health.loginFailures.topIps.length > 0 && (
        <div className="border-b border-slate-100 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Top sources (last hour)
          </p>
          <ul className="mt-1.5 space-y-1">
            {health.loginFailures.topIps.map((ip) => (
              <li
                key={ip.ip}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-mono text-slate-700">{ip.ip}</span>
                <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                  {ip.count}× <ArrowDown className="inline h-2.5 w-2.5" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {health.loginFailures.recent.length === 0 ? (
        <EmptyState message="No failed logins recorded since startup." />
      ) : (
        <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
          {health.loginFailures.recent.map((f, idx) => (
            <li key={idx} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800">
                    {f.email}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="font-mono">{f.ip ?? "—"}</span>
                    <span className="text-slate-300">·</span>
                    <span className="rounded-sm bg-slate-100 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider">
                      {f.reason}
                    </span>
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-slate-400">
                  {timeAgo(f.at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}

function DetailCard({
  icon,
  label,
  counts,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  counts: Array<{ label: string; value: number }>;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            {icon}
          </span>
          <span className="text-sm font-semibold text-slate-900">{label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {counts.map((c) => (
            <div key={c.label} className="flex flex-col items-end">
              <span className="font-semibold tabular-nums text-slate-900">
                {c.value.toLocaleString("en-IN")}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-slate-400">
                {c.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="px-4 py-6 text-center text-xs italic text-slate-400">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compact "5s ago" / "12m ago" / "1h ago" — same shape as the audit
 * page's relative timestamps so the operator can correlate by feel.
 */
function timeAgo(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 5) return "now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

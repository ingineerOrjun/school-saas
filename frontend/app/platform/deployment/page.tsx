"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Cog,
  Database,
  GitCommit,
  Layers,
  Rocket,
  ShieldCheck,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  productizationApi,
  type AdoptionMetrics,
  type DeploymentInfo,
  type UpgradeCheck,
  type UpgradeSafetyReport,
} from "@/lib/productization";
import { qk } from "@/lib/query-keys";
import {
  PageHeader,
  PanelLoadingState,
  SectionCard,
  StatCard,
  StatsGrid,
  StatusPill,
  type PillTone,
} from "@/components/platform-ui";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /platform/deployment — Phase 23 Sections 13 + 14 + 15.
//
// Three concerns one page (operators consume them together during a
// release):
//
//   • Deployment info — version / build SHA / build timestamp /
//     environment / migration status. Always visible at the top.
//
//   • Upgrade safety — pre-deploy checklist. A `block` check means
//     "do not deploy until resolved." `warn` is advisory.
//
//   • Adoption metrics — DAU/WAU, active schools, attendance/fees
//     usage, feature adoption. Helps operators understand what
//     customers actually use.
// ---------------------------------------------------------------------------

export default function PlatformDeploymentPage() {
  const deployment = useQuery({
    queryKey: qk.productization.deployment,
    queryFn: () => productizationApi.getDeployment(),
    staleTime: 60_000,
  });
  const safety = useQuery({
    queryKey: qk.productization.upgradeSafety,
    queryFn: () => productizationApi.getUpgradeSafety(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const adoption = useQuery({
    queryKey: qk.productization.adoption,
    queryFn: () => productizationApi.getAdoption(),
    staleTime: 5 * 60_000,
  });

  if (deployment.isLoading) return <PanelLoadingState />;
  const info = deployment.data;
  if (!info) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Deployment"
        description="Build info, upgrade safety checks, and adoption metrics"
        icon={<Rocket className="h-4 w-4" />}
      />

      <DeploymentInfoCard info={info} />
      <UpgradeSafetyCard report={safety.data ?? null} />
      <AdoptionCard metrics={adoption.data ?? null} />
    </div>
  );
}

function DeploymentInfoCard({ info }: { info: DeploymentInfo }) {
  return (
    <SectionCard
      title="Build"
      description={`${info.appName} · ${info.environment}`}
      icon={<GitCommit className="h-3.5 w-3.5" />}
    >
      <StatsGrid cols={4}>
        <StatCard
          label="Version"
          value={info.version}
          delta={info.buildSha ? `sha ${info.buildSha}` : undefined}
        />
        <StatCard
          label="Built"
          value={
            info.buildTimestamp
              ? new Date(info.buildTimestamp).toLocaleString()
              : "—"
          }
        />
        <StatCard
          label="Migrations applied"
          value={info.migrations.applied.toLocaleString("en-IN")}
          delta={info.migrations.inSync ? "in sync" : "0 applied"}
          deltaTone={info.migrations.inSync ? "positive" : "negative"}
          icon={<Database className="h-3 w-3" />}
        />
        <StatCard
          label="Uptime"
          value={prettyDuration(info.uptimeSec)}
          delta={`since ${new Date(info.startedAt).toLocaleString()}`}
        />
      </StatsGrid>
    </SectionCard>
  );
}

function UpgradeSafetyCard({
  report,
}: {
  report: UpgradeSafetyReport | null;
}) {
  return (
    <SectionCard
      title="Upgrade safety"
      description="Pre-deploy checks — review before rolling out"
      icon={<ShieldCheck className="h-3.5 w-3.5" />}
      tone={
        report?.checks.some((c) => c.status === "block")
          ? "danger"
          : report?.checks.some((c) => c.status === "warn")
            ? "warning"
            : "success"
      }
    >
      {!report ? (
        <p className="text-xs text-slate-500">Loading checks…</p>
      ) : (
        <ul className="space-y-2">
          {report.checks.map((c) => (
            <CheckRow key={c.key} check={c} />
          ))}
        </ul>
      )}
      {report && (
        <div
          className={cn(
            "mt-3 rounded-md border p-2.5 text-xs flex items-center gap-2",
            report.safe
              ? "border-emerald-200 bg-emerald-50/40 text-emerald-800"
              : "border-red-200 bg-red-50/40 text-red-800",
          )}
        >
          {report.safe ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <p className="font-medium">
            {report.safe
              ? "Safe to deploy — no blocking issues."
              : "Blocking issue(s) found — resolve before deploying."}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

function CheckRow({ check }: { check: UpgradeCheck }) {
  const icon =
    check.status === "block" ? (
      <XCircle className="h-4 w-4 text-red-600" />
    ) : check.status === "warn" ? (
      <AlertTriangle className="h-4 w-4 text-amber-600" />
    ) : (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    );
  return (
    <li
      className={cn(
        "rounded-md border p-2.5 flex items-start gap-2",
        check.status === "block" && "border-red-200 bg-red-50/40",
        check.status === "warn" && "border-amber-200 bg-amber-50/40",
        check.status === "ok" && "border-emerald-200/60 bg-emerald-50/30",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-900">{check.label}</p>
        <p className="mt-0.5 text-[11px] text-slate-700">{check.detail}</p>
      </div>
      <StatusPill
        tone={toneFor(check.status)}
        size="xs"
        uppercase
      >
        {check.status}
      </StatusPill>
    </li>
  );
}

function AdoptionCard({ metrics }: { metrics: AdoptionMetrics | null }) {
  return (
    <SectionCard
      title="Adoption metrics"
      description="DAU, WAU, and feature usage across all tenants"
      icon={<TrendingUp className="h-3.5 w-3.5" />}
    >
      {!metrics ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : (
        <>
          <StatsGrid cols={4}>
            <StatCard
              label="Active schools · 7d"
              value={metrics.activeSchoolsLast7d.toLocaleString("en-IN")}
            />
            <StatCard
              label="DAU"
              value={metrics.dau.toLocaleString("en-IN")}
              delta="users active in 24h"
            />
            <StatCard
              label="WAU"
              value={metrics.wau.toLocaleString("en-IN")}
              delta="users active in 7d"
            />
            <StatCard
              label="Attendance usage"
              value={metrics.attendanceUsageSchools.toLocaleString("en-IN")}
              delta={`${metrics.feesUsageSchools} schools collecting fees`}
            />
          </StatsGrid>

          {metrics.featureAdoption.length > 0 && (
            <div className="mt-4 rounded-md border border-slate-200 bg-white">
              <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-slate-700" />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                  Feature adoption (override opt-ins)
                </p>
              </div>
              <ul className="divide-y divide-slate-100">
                {metrics.featureAdoption.slice(0, 10).map((f) => (
                  <li
                    key={f.key}
                    className="px-3 py-1.5 flex items-center justify-between text-[11px]"
                  >
                    <code className="font-mono text-slate-700">{f.key}</code>
                    <span className="tabular-nums font-semibold text-slate-700">
                      {f.enabledCount.toLocaleString("en-IN")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

// Helpers

function toneFor(status: UpgradeCheck["status"]): PillTone {
  switch (status) {
    case "ok":
      return "success";
    case "warn":
      return "warning";
    case "block":
      return "danger";
    default:
      return "default";
  }
}

function prettyDuration(totalSec: number): string {
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}

// Quiet unused import
void Cog;

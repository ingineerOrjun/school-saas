"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Database,
  HardDrive,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import {
  systemApi,
  type BackupHealth,
  type IntegrityFinding,
  type IntegrityReport,
} from "@/lib/system";
import { STALE } from "@/lib/query-client";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

// ============================================================================
// System Health — Phase PLATFORM STABILIZATION Part 6.
//
// Lightweight admin-only operational surface. NOT analytics, NOT
// charts, NOT auto-refreshing. The school admin opens the page when
// they want to check "is our data safe?" and "is anything drifting?".
//
// Two cards:
//   1. BackupCard         — consumes /system/backup-status.
//   2. IntegrityReportCard — consumes /system/integrity-report.
//
// Both manually-refreshable via a single Refresh button at the top.
// Polling would be operational noise — the data only changes when
// the operator does something.
// ============================================================================

export default function SystemHealthPage() {
  const router = useRouter();
  const qc = useQueryClient();

  // Role gate. Backend rejects non-admins with 403 but we want to
  // avoid showing the page chrome for unauthorized users.
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    const role = getStoredUser()?.role ?? null;
    if (role !== "ADMIN") {
      router.replace("/dashboard");
      return;
    }
    setAllowed(true);
  }, [router]);

  const backupQuery = useQuery({
    queryKey: ["system", "backup-status"],
    queryFn: () => systemApi.backupStatus(),
    enabled: allowed === true,
    staleTime: STALE.SEMI_STATIC,
  });
  const integrityQuery = useQuery({
    queryKey: ["system", "integrity-report"],
    queryFn: () => systemApi.integrityReport(),
    enabled: allowed === true,
    staleTime: STALE.LIVE_OPERATOR,
  });

  // Auth + general error surface.
  React.useEffect(() => {
    const err = backupQuery.error ?? integrityQuery.error;
    if (err instanceof ApiError && err.status === 401) {
      router.replace("/login");
    }
  }, [backupQuery.error, integrityQuery.error, router]);

  const refresh = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["system"] });
  }, [qc]);

  if (allowed === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const integrityStale = integrityQuery.isFetching;
  const backupStale = backupQuery.isFetching;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            System Health
          </h1>
          <p className="text-sm text-muted-foreground max-w-prose">
            Read-only operational signals. Backup freshness on top; data
            drift checks below. Every check here runs on demand — nothing
            is auto-polling, so you can open this page without adding
            background load.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          leftIcon={<RotateCw className={cn("h-3.5 w-3.5", (integrityStale || backupStale) && "animate-spin")} />}
        >
          Refresh
        </Button>
      </div>

      <BackupCard
        data={backupQuery.data}
        loading={backupQuery.isLoading}
        error={backupQuery.error}
      />

      <IntegrityReportCard
        data={integrityQuery.data}
        loading={integrityQuery.isLoading}
        error={integrityQuery.error}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// BackupCard
// ---------------------------------------------------------------------------

function BackupCard({
  data,
  loading,
  error,
}: {
  data: BackupHealth | undefined;
  loading: boolean;
  error: unknown;
}) {
  return (
    <section
      aria-labelledby="backup-card-heading"
      className="glass rounded-xl p-5 space-y-4"
    >
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <HardDrive className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1">
          <h2 id="backup-card-heading" className="text-base font-semibold tracking-tight text-foreground">
            Backups
          </h2>
          <p className="text-sm text-muted-foreground">
            Daily database backups via{" "}
            <span className="font-mono">pg_dump</span>. Restore guidance lives
            in <span className="font-mono">backend/docs/disaster-recovery.md</span>.
          </p>
        </div>
        <BackupFreshnessChip data={data} />
      </header>

      {loading && <Skeleton className="h-20 w-full" />}
      {!loading && error ? (
        <ErrorBox message="Couldn't load backup status." />
      ) : null}
      {!loading && data && (
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <Datum label="Storage" value={data.storageProvider} />
          <Datum
            label="Last success"
            value={
              data.lastSuccessAt
                ? new Date(data.lastSuccessAt).toLocaleString()
                : "never"
            }
          />
          <Datum
            label="Hours since"
            value={
              data.hoursSinceLastSuccess === null
                ? "—"
                : `${data.hoursSinceLastSuccess}h ago`
            }
          />
          <Datum
            label="Last attempt"
            value={data.lastAttemptStatus ?? "—"}
            tone={
              data.lastAttemptStatus === "FAILED"
                ? "rose"
                : data.lastAttemptStatus === "SUCCEEDED"
                  ? "emerald"
                  : "slate"
            }
          />
        </dl>
      )}
      {!loading && data && !data.isFresh && (
        <div className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/5 dark:border-amber-500/30 dark:text-amber-200">
          <strong>Backup is stale.</strong> The last successful run was more
          than 24 hours ago. Check the platform operations log or trigger
          a manual backup from the SUPER_ADMIN cockpit.
        </div>
      )}
    </section>
  );
}

function BackupFreshnessChip({ data }: { data: BackupHealth | undefined }) {
  if (!data) {
    return (
      <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        …
      </span>
    );
  }
  if (data.isFresh) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Fresh
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
      <AlertTriangle className="h-3.5 w-3.5" />
      Stale
    </span>
  );
}

// ---------------------------------------------------------------------------
// IntegrityReportCard
// ---------------------------------------------------------------------------

function IntegrityReportCard({
  data,
  loading,
  error,
}: {
  data: IntegrityReport | undefined;
  loading: boolean;
  error: unknown;
}) {
  return (
    <section
      aria-labelledby="integrity-card-heading"
      className="glass rounded-xl p-5 space-y-4"
    >
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Database className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-1">
          <h2 id="integrity-card-heading" className="text-base font-semibold tracking-tight text-foreground">
            Data integrity
          </h2>
          <p className="text-sm text-muted-foreground">
            Read-only checks for duplicate registration numbers, archived
            references, orphaned sections, and academic-session sanity. Run
            this before a promotion or after a backup restore.
          </p>
        </div>
        <IntegritySummaryChip data={data} />
      </header>

      {loading && <Skeleton className="h-20 w-full" />}
      {!loading && error ? (
        <ErrorBox message="Couldn't load integrity report." />
      ) : null}
      {!loading && data && (
        <>
          <ul className="space-y-2">
            {data.findings.map((f) => (
              <IntegrityFindingRow key={f.code} finding={f} />
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Generated{" "}
            {new Date(data.generatedAt).toLocaleString()}. Nothing here
            modifies your data — these are read-only signals.
          </p>
        </>
      )}
    </section>
  );
}

function IntegritySummaryChip({ data }: { data: IntegrityReport | undefined }) {
  if (!data) {
    return (
      <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        …
      </span>
    );
  }
  if (data.clean) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-300/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30">
        <ShieldCheck className="h-3.5 w-3.5" />
        Clean
      </span>
    );
  }
  if (data.counts.errors > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-rose-800 ring-1 ring-rose-300/60 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30">
        <AlertOctagon className="h-3.5 w-3.5" />
        {data.counts.errors} error{data.counts.errors === 1 ? "" : "s"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
      <AlertTriangle className="h-3.5 w-3.5" />
      {data.counts.warnings} warning{data.counts.warnings === 1 ? "" : "s"}
    </span>
  );
}

function IntegrityFindingRow({ finding }: { finding: IntegrityFinding }) {
  const isClean = finding.count === 0;
  const tone = isClean
    ? "border-border/40"
    : finding.severity === "error"
      ? "border-rose-300/40 bg-rose-50/50 dark:bg-rose-500/5"
      : finding.severity === "warning"
        ? "border-amber-300/40 bg-amber-50/50 dark:bg-amber-500/5"
        : "border-sky-300/40 bg-sky-50/50 dark:bg-sky-500/5";
  return (
    <li className={cn("rounded-md border px-3 py-2 text-sm", tone)}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {finding.code}
            </span>
            <SeverityPill severity={finding.severity} clean={isClean} />
          </div>
          <p className="text-foreground">{finding.message}</p>
          {finding.remediation && finding.count > 0 && (
            <p className="text-xs text-muted-foreground">
              → {finding.remediation}
            </p>
          )}
        </div>
        <span
          className={cn(
            "font-mono tabular-nums text-sm font-semibold",
            isClean
              ? "text-muted-foreground"
              : finding.severity === "error"
                ? "text-rose-700 dark:text-rose-400"
                : "text-amber-700 dark:text-amber-400",
          )}
        >
          {finding.count}
        </span>
      </div>
    </li>
  );
}

function SeverityPill({
  severity,
  clean,
}: {
  severity: IntegrityFinding["severity"];
  clean: boolean;
}) {
  if (clean) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
        OK
      </span>
    );
  }
  const tone =
    severity === "error"
      ? "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300"
      : severity === "warning"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
        : "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        tone,
      )}
    >
      {severity}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tiny shared primitives
// ---------------------------------------------------------------------------

function Datum({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "slate" | "emerald" | "rose";
}) {
  const valueTone =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "rose"
        ? "text-rose-700 dark:text-rose-400"
        : "text-foreground";
  return (
    <div className="space-y-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("font-medium tabular-nums", valueTone)}>{value}</dd>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-rose-300/50 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-500/5 dark:border-rose-500/30 dark:text-rose-200">
      {message}
    </div>
  );
}

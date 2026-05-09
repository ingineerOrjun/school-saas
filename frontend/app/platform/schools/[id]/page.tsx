"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Coins,
  CreditCard,
  ExternalLink,
  GraduationCap,
  Layers,
  LogOut,
  Mail,
  Pause,
  Phone,
  Play,
  PowerOff,
  RefreshCw,
  ShieldAlert,
  Timer,
  UserCog,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type PlatformFeatureCatalogEntry,
  type PlatformFeatureSet,
  type PlatformSchoolRow,
  type SchoolActivityItem,
  type SchoolSnapshot,
  type SchoolStatus,
  type SubscriptionRow,
} from "@/lib/platform";
import { formatCurrency, formatCurrencyShort } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  PageHeader,
  PanelEmptyState,
  PanelErrorState,
  PanelLoadingState,
  PlanPill,
  SchoolStatusPill,
  SectionCard,
  SkeletonRows,
  StatCard,
  StatsGrid,
  StatusPill,
} from "@/components/platform-ui";
import { Sparkline } from "@/components/charts/Sparkline";
import { ImpersonateUserDialog } from "@/components/impersonation/ImpersonateUserDialog";
import { ManageSubscriptionDialog } from "@/components/platform/ManageSubscriptionDialog";
import { SecurityDialog } from "@/components/platform/SecurityDialog";

// ---------------------------------------------------------------------------
// /platform/schools/[id] — Phase 1 (maturity).
//
// Operational command center for one tenant. Composes data from four
// existing endpoints + the new /snapshot endpoint into a single
// dense, support-oriented page. All seven required sections render
// here:
//
//   1. School overview        (top: identity + usage + contact)
//   2. Subscription & billing (current plan + history)
//   3. Feature flags          (matrix toggle for this school)
//   4. Platform analytics     (KPIs + 30-day trends)
//   5. System health          (warnings + counters)
//   6. Recent activity        (unified feed)
//   7. Administration actions (sticky action bar)
//
// Action affordances reuse existing dialogs (impersonation,
// subscription, security) — this page is the new entry point but
// doesn't reinvent those flows. Status flips dispatch through the
// existing UpdateStatusDialog flow inline.
// ---------------------------------------------------------------------------

export default function PlatformSchoolDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const schoolId = params?.id;

  const [school, setSchool] = React.useState<PlatformSchoolRow | null>(null);
  const [snapshot, setSnapshot] = React.useState<SchoolSnapshot | null>(null);
  const [features, setFeatures] = React.useState<PlatformFeatureSet | null>(
    null,
  );
  const [catalog, setCatalog] = React.useState<PlatformFeatureCatalogEntry[]>(
    [],
  );
  const [subscriptions, setSubscriptions] = React.useState<SubscriptionRow[]>(
    [],
  );

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Dialogs (reuse existing components from the schools list page).
  const [impersonateOpen, setImpersonateOpen] = React.useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = React.useState(false);
  const [securityOpen, setSecurityOpen] = React.useState(false);
  const [statusTarget, setStatusTarget] = React.useState<SchoolStatus | null>(
    null,
  );

  const reload = React.useCallback(async () => {
    if (!schoolId) return;
    setError(null);
    try {
      const [s, snap, feats, cat, subs] = await Promise.all([
        platformApi.getSchool(schoolId),
        platformApi.getSchoolSnapshot(schoolId),
        platformApi.getSchoolFeatures(schoolId),
        platformApi.getFeatureCatalog(),
        platformApi.listSubscriptions(schoolId),
      ]);
      setSchool(s);
      setSnapshot(snap);
      setFeatures(feats);
      setCatalog(cat);
      setSubscriptions(subs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load school.");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonRows rows={2} />
        <SkeletonRows rows={6} />
      </div>
    );
  }
  if (error || !school || !snapshot || !features) {
    return (
      <PanelErrorState
        message={error ?? "School not found."}
        onRetry={() => void reload()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={school.name}
        description={`${school.slug}${school.email ? ` · ${school.email}` : ""}`}
        icon={<Building2 className="h-4 w-4" />}
        breadcrumbs={[
          { label: "Platform", href: "/platform" },
          { label: "Schools", href: "/platform/schools" },
          { label: school.name },
        ]}
        actions={
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        }
      />

      {/* Sticky action bar — operator's primary affordances. */}
      <ActionBar
        school={school}
        onImpersonate={() => setImpersonateOpen(true)}
        onManagePlan={() => setSubscriptionOpen(true)}
        onSecurity={() => setSecurityOpen(true)}
        onSuspend={() => setStatusTarget("SUSPENDED")}
        onReactivate={() => setStatusTarget("ACTIVE")}
        onMarkExpired={() => setStatusTarget("EXPIRED")}
        onToggleMaintenance={async () => {
          try {
            const updated = await platformApi.setMaintenanceMode(school.id, {
              enabled: !school.maintenanceMode,
            });
            setSchool(updated);
            toast.success(
              updated.maintenanceMode
                ? `Maintenance mode enabled for ${school.name}`
                : `Maintenance mode disabled for ${school.name}`,
            );
          } catch (e) {
            toast.error(
              e instanceof ApiError
                ? e.message
                : "Failed to toggle maintenance mode.",
            );
          }
        }}
        onRefresh={() => void reload()}
      />

      {/* Phase 17 — visible banner when maintenance mode is on so the
          operator sees the state at a glance, not buried in a button. */}
      {school.maintenanceMode && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Wrench className="h-4 w-4 shrink-0" />
          <span>
            <strong>Maintenance mode is ON.</strong> Reads continue; school
            users will get 503 on writes until you toggle it off.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-5">
          <OverviewCard school={school} snapshot={snapshot} />
          <BillingCard
            school={school}
            subscriptions={subscriptions}
            features={features}
            snapshot={snapshot}
            onManagePlan={() => setSubscriptionOpen(true)}
          />
          <HealthCard snapshot={snapshot} school={school} />
        </div>
        <div className="space-y-5">
          <UsageStatsRow snapshot={snapshot} school={school} features={features} />
          <FeatureFlagsCard
            schoolId={school.id}
            features={features}
            catalog={catalog}
            onChanged={(updated) => setFeatures(updated)}
          />
          <AnalyticsTrendsCard snapshot={snapshot} />
          <ActivityFeedCard snapshot={snapshot} schoolId={school.id} />
        </div>
      </div>

      {/* Dialogs */}
      {impersonateOpen && (
        <ImpersonateUserDialog
          school={school}
          onClose={() => setImpersonateOpen(false)}
        />
      )}
      {subscriptionOpen && (
        <ManageSubscriptionDialog
          school={school}
          onClose={() => setSubscriptionOpen(false)}
          onSaved={() => {
            setSubscriptionOpen(false);
            void reload();
          }}
        />
      )}
      {securityOpen && (
        <SecurityDialog
          school={school}
          onClose={() => setSecurityOpen(false)}
        />
      )}
      <StatusChangeDialog
        target={statusTarget}
        school={school}
        onClose={() => setStatusTarget(null)}
        onSaved={() => {
          setStatusTarget(null);
          void reload();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky action bar — admin actions live here so they're always reachable
// without scrolling. Visibility is status-aware: Reactivate replaces
// Suspend on suspended/expired tenants.
// ---------------------------------------------------------------------------

function ActionBar({
  school,
  onImpersonate,
  onManagePlan,
  onSecurity,
  onSuspend,
  onReactivate,
  onMarkExpired,
  onToggleMaintenance,
  onRefresh,
}: {
  school: PlatformSchoolRow;
  onImpersonate: () => void;
  onManagePlan: () => void;
  onSecurity: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onMarkExpired: () => void;
  onToggleMaintenance: () => void;
  onRefresh: () => void;
}) {
  const live = school.status === "ACTIVE" || school.status === "TRIAL";
  return (
    <div className="sticky top-14 z-20 -mx-1 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-1.5">
        <SchoolStatusPill status={school.status} />
        {school.currentSubscription && (
          <PlanPill plan={school.currentSubscription.plan} />
        )}
        {school.maintenanceMode && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
            <Wrench className="h-2.5 w-2.5" />
            Maintenance
          </span>
        )}
        <span className="text-xs text-slate-400 ml-1 hidden sm:inline">
          {school.studentCount.toLocaleString()} students ·{" "}
          {school.teacherCount.toLocaleString()} teachers
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onToggleMaintenance}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
              school.maintenanceMode
                ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
            title={
              school.maintenanceMode
                ? "Disable maintenance mode (resume writes)"
                : "Enable maintenance mode (pause writes)"
            }
          >
            {school.maintenanceMode ? (
              <PowerOff className="h-3.5 w-3.5" />
            ) : (
              <Wrench className="h-3.5 w-3.5" />
            )}
            {school.maintenanceMode ? "Resume" : "Maintenance"}
          </button>
          {live && (
            <button
              type="button"
              onClick={onImpersonate}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <UserCog className="h-3.5 w-3.5" />
              Sign in
            </button>
          )}
          <button
            type="button"
            onClick={onManagePlan}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <CreditCard className="h-3.5 w-3.5" />
            Plan
          </button>
          <button
            type="button"
            onClick={onSecurity}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:border-red-300 hover:text-red-700"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Security
          </button>
          {live ? (
            <>
              <button
                type="button"
                onClick={onSuspend}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                <Pause className="h-3.5 w-3.5" />
                Suspend
              </button>
              <button
                type="button"
                onClick={onMarkExpired}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-200 bg-white px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
              >
                <Timer className="h-3.5 w-3.5" />
                Mark expired
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onReactivate}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
            >
              <Play className="h-3.5 w-3.5" />
              Reactivate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Overview
// ---------------------------------------------------------------------------

function OverviewCard({
  school,
  snapshot,
}: {
  school: PlatformSchoolRow;
  snapshot: SchoolSnapshot;
}) {
  return (
    <SectionCard
      title="School overview"
      icon={<Building2 className="h-3.5 w-3.5" />}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
            <span className="text-sm font-semibold">
              {school.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">
              {school.name}
            </p>
            <p className="text-[11px] text-slate-500">{school.slug}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <SchoolStatusPill status={school.status} size="xs" />
              {school.currentSubscription && (
                <PlanPill
                  plan={school.currentSubscription.plan}
                  size="xs"
                />
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-1 border-t border-slate-100 pt-3 text-xs">
          <ContactLine icon={<Mail className="h-3 w-3" />} value={school.email} />
          <ContactLine icon={<Phone className="h-3 w-3" />} value={school.phone} />
          <ContactLine
            icon={<CalendarClock className="h-3 w-3" />}
            label="Created"
            value={formatDate(school.createdAt)}
          />
          {school.expiresAt && (
            <ContactLine
              icon={<Timer className="h-3 w-3" />}
              label="Expires"
              value={formatDate(school.expiresAt)}
              highlight={
                snapshot.health.expiringSoon ? "warning" : undefined
              }
            />
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function ContactLine({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label?: string;
  value: string | null;
  highlight?: "warning" | "danger";
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-slate-500">
        {icon}
      </span>
      {label && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </span>
      )}
      <span
        className={cn(
          "truncate text-slate-700",
          highlight === "warning" && "text-amber-700 font-medium",
          highlight === "danger" && "text-red-700 font-medium",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Billing / Subscription
// ---------------------------------------------------------------------------

function BillingCard({
  school,
  subscriptions,
  features,
  snapshot,
  onManagePlan,
}: {
  school: PlatformSchoolRow;
  subscriptions: SubscriptionRow[];
  features: PlatformFeatureSet;
  snapshot: SchoolSnapshot;
  onManagePlan: () => void;
}) {
  const current = school.currentSubscription;
  const enabledFeatureKeys = Object.entries(features.features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <SectionCard
      title="Subscription & billing"
      icon={<CreditCard className="h-3.5 w-3.5" />}
      actions={
        <button
          type="button"
          onClick={onManagePlan}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-2 text-[11px] font-medium text-white hover:bg-slate-800"
        >
          Manage
        </button>
      }
    >
      {!current ? (
        <PanelEmptyState
          icon={<CreditCard className="h-4 w-4" />}
          title="No active subscription"
          description="Create a subscription period to start tracking this tenant's plan."
          action={{ label: "Create plan", onClick: onManagePlan }}
        />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <KvBlock label="Plan" value={current.plan} />
            <KvBlock label="Cycle" value={current.billingCycle} />
            <KvBlock label="Started" value={formatDate(current.startDate)} />
            <KvBlock
              label="Ends"
              value={
                current.endDate ? formatDate(current.endDate) : "No expiry"
              }
              tone={
                snapshot.health.expiringSoon
                  ? "warning"
                  : snapshot.health.subscriptionDaysRemaining !== null &&
                      snapshot.health.subscriptionDaysRemaining < 0
                    ? "danger"
                    : undefined
              }
            />
            <KvBlock
              label="Students limit"
              value={
                current.studentLimit !== null
                  ? `${current.studentLimit.toLocaleString()}`
                  : "Unlimited"
              }
              tone={snapshot.health.studentLimitNearing ? "warning" : undefined}
            />
            <KvBlock
              label="Teachers limit"
              value={
                current.teacherLimit !== null
                  ? `${current.teacherLimit.toLocaleString()}`
                  : "Unlimited"
              }
              tone={snapshot.health.teacherLimitNearing ? "warning" : undefined}
            />
          </div>
          {snapshot.health.subscriptionDaysRemaining !== null && (
            <div
              className={cn(
                "rounded-md border px-2 py-1.5 text-[11px]",
                snapshot.health.subscriptionDaysRemaining < 0
                  ? "border-red-200 bg-red-50 text-red-800"
                  : snapshot.health.expiringSoon
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-slate-50 text-slate-600",
              )}
            >
              {snapshot.health.subscriptionDaysRemaining < 0
                ? `Expired ${Math.abs(snapshot.health.subscriptionDaysRemaining)} day${
                    Math.abs(snapshot.health.subscriptionDaysRemaining) === 1
                      ? ""
                      : "s"
                  } ago`
                : `${snapshot.health.subscriptionDaysRemaining} day${
                    snapshot.health.subscriptionDaysRemaining === 1
                      ? ""
                      : "s"
                  } remaining`}
            </div>
          )}

          <div className="border-t border-slate-100 pt-2">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Enabled modules ({enabledFeatureKeys.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {enabledFeatureKeys.length === 0 ? (
                <span className="text-[11px] italic text-slate-400">
                  None enabled.
                </span>
              ) : (
                enabledFeatureKeys.map((k) => (
                  <StatusPill key={k} tone="default" size="xs">
                    {k}
                  </StatusPill>
                ))
              )}
            </div>
          </div>

          {subscriptions.length > 1 && (
            <div className="border-t border-slate-100 pt-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Plan history
              </p>
              <ul className="space-y-1 text-[11px] text-slate-600">
                {subscriptions.slice(0, 5).map((s) => (
                  <li key={s.id} className="flex items-center justify-between">
                    <span>
                      <span className="font-mono">{s.plan}</span> ·{" "}
                      {s.billingCycle}
                    </span>
                    <span className="text-slate-400">
                      {formatDate(s.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function KvBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warning" | "danger";
}) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50/50 px-2.5 py-1.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate text-xs font-medium tabular-nums text-slate-900",
          tone === "warning" && "text-amber-700",
          tone === "danger" && "text-red-700",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Health
// ---------------------------------------------------------------------------

function HealthCard({
  snapshot,
  school,
}: {
  snapshot: SchoolSnapshot;
  school: PlatformSchoolRow;
}) {
  const warnings: Array<{
    severity: "warning" | "danger";
    title: string;
    detail: string;
  }> = [];

  if (
    snapshot.health.subscriptionDaysRemaining !== null &&
    snapshot.health.subscriptionDaysRemaining < 0
  ) {
    warnings.push({
      severity: "danger",
      title: "Subscription expired",
      detail: `Plan ended ${Math.abs(snapshot.health.subscriptionDaysRemaining)} days ago.`,
    });
  } else if (snapshot.health.expiringSoon) {
    warnings.push({
      severity: "warning",
      title: "Subscription expiring",
      detail: `${snapshot.health.subscriptionDaysRemaining} days remaining.`,
    });
  }
  if (snapshot.health.studentLimitNearing) {
    warnings.push({
      severity: "warning",
      title: "Student limit nearing",
      detail: `${school.studentCount.toLocaleString()} of ${school.currentSubscription?.studentLimit?.toLocaleString()}.`,
    });
  }
  if (snapshot.health.teacherLimitNearing) {
    warnings.push({
      severity: "warning",
      title: "Teacher limit nearing",
      detail: `${school.teacherCount.toLocaleString()} of ${school.currentSubscription?.teacherLimit?.toLocaleString()}.`,
    });
  }
  if (snapshot.health.loginFailuresLast60min > 30) {
    warnings.push({
      severity: "warning",
      title: "Login failure pressure",
      detail: `${snapshot.health.loginFailuresLast60min} failures in the last hour (platform-wide).`,
    });
  }
  if (snapshot.health.errorsLast60min > 20) {
    warnings.push({
      severity: "warning",
      title: "Elevated error rate",
      detail: `${snapshot.health.errorsLast60min} server errors in the last hour (platform-wide).`,
    });
  }

  return (
    <SectionCard
      title="System health"
      icon={<Activity className="h-3.5 w-3.5" />}
      tone={
        warnings.some((w) => w.severity === "danger")
          ? "danger"
          : warnings.length > 0
            ? "warning"
            : "default"
      }
    >
      {warnings.length === 0 ? (
        <PanelEmptyState
          icon={<Activity className="h-4 w-4 text-emerald-500" />}
          title="Everything looks healthy"
          description="No alerts on this tenant right now."
        />
      ) : (
        <ul className="space-y-1.5">
          {warnings.map((w, i) => (
            <li
              key={i}
              className={cn(
                "rounded-md border px-2.5 py-1.5",
                w.severity === "danger"
                  ? "border-red-200 bg-red-50/60"
                  : "border-amber-200 bg-amber-50/60",
              )}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    w.severity === "danger" ? "text-red-600" : "text-amber-600",
                  )}
                />
                <div>
                  <p
                    className={cn(
                      "text-[11px] font-semibold",
                      w.severity === "danger"
                        ? "text-red-900"
                        : "text-amber-900",
                    )}
                  >
                    {w.title}
                  </p>
                  <p className="text-[11px] text-slate-600">{w.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section: Usage stats row
// ---------------------------------------------------------------------------

function UsageStatsRow({
  snapshot,
  school,
  features,
}: {
  snapshot: SchoolSnapshot;
  school: PlatformSchoolRow;
  features: PlatformFeatureSet;
}) {
  const enabledCount = Object.values(features.features).filter(Boolean).length;
  const totalFeatures = Object.keys(features.features).length;

  return (
    <StatsGrid cols={4}>
      <StatCard
        label="Students"
        value={snapshot.usage.studentsCount.toLocaleString("en-IN")}
        delta={
          school.currentSubscription?.studentLimit !== null &&
          school.currentSubscription?.studentLimit !== undefined
            ? `of ${school.currentSubscription.studentLimit.toLocaleString("en-IN")} limit`
            : "unlimited"
        }
        icon={<Users className="h-3 w-3" />}
        tone={snapshot.health.studentLimitNearing ? "warning" : "default"}
      />
      <StatCard
        label="Teachers"
        value={snapshot.usage.teachersCount.toLocaleString("en-IN")}
        delta={
          school.currentSubscription?.teacherLimit !== null &&
          school.currentSubscription?.teacherLimit !== undefined
            ? `of ${school.currentSubscription.teacherLimit.toLocaleString("en-IN")} limit`
            : "unlimited"
        }
        icon={<GraduationCap className="h-3 w-3" />}
        tone={snapshot.health.teacherLimitNearing ? "warning" : "default"}
      />
      <StatCard
        label="Active users · 30d"
        value={snapshot.usage.activeUsers30d.toLocaleString("en-IN")}
        delta={`of ${(
          snapshot.usage.studentsCount + snapshot.usage.teachersCount
        ).toLocaleString("en-IN")} accounts`}
        icon={<Activity className="h-3 w-3" />}
      />
      <StatCard
        label="Modules"
        value={`${enabledCount}/${totalFeatures}`}
        delta="enabled features"
        icon={<Layers className="h-3 w-3" />}
      />
    </StatsGrid>
  );
}

// ---------------------------------------------------------------------------
// Section: Feature flags
// ---------------------------------------------------------------------------

function FeatureFlagsCard({
  schoolId,
  features,
  catalog,
  onChanged,
}: {
  schoolId: string;
  features: PlatformFeatureSet;
  catalog: PlatformFeatureCatalogEntry[];
  onChanged: (next: PlatformFeatureSet) => void;
}) {
  const [pending, setPending] = React.useState<Record<string, boolean>>({});

  const toggle = async (key: string) => {
    if (pending[key]) return;
    // Cycle through: inherit → on → off → inherit (matches /platform/features matrix).
    const currentOverride = features.overrides[key];
    const currentState: "on" | "off" | "inherit" =
      currentOverride === undefined
        ? "inherit"
        : currentOverride
          ? "on"
          : "off";
    const next: "on" | "off" | "inherit" =
      currentState === "inherit" ? "on" : currentState === "on" ? "off" : "inherit";

    const nextOverrides: Record<string, boolean> = { ...features.overrides };
    if (next === "inherit") delete nextOverrides[key];
    else nextOverrides[key] = next === "on";

    // Optimistic — flip the local state first; reconcile on response.
    const optimistic: PlatformFeatureSet = {
      ...features,
      overrides: nextOverrides,
      features: {
        ...features.features,
        [key]:
          next === "inherit"
            ? (features.subscription?.[key] ?? features.defaults[key] ?? false)
            : next === "on",
      },
    };
    onChanged(optimistic);
    setPending((p) => ({ ...p, [key]: true }));
    try {
      const result = await platformApi.setSchoolFeatures(schoolId, {
        overrides: nextOverrides,
      });
      onChanged(result);
      toast.success(`Updated "${key}".`);
    } catch (e) {
      // Roll back to the prior state.
      onChanged(features);
      toast.error(
        e instanceof ApiError ? e.message : `Failed to update "${key}".`,
      );
    } finally {
      setPending((p) => {
        const out = { ...p };
        delete out[key];
        return out;
      });
    }
  };

  return (
    <SectionCard
      title="Feature flags"
      description="Override the school's plan or coming-soon defaults."
      icon={<Layers className="h-3.5 w-3.5" />}
      actions={
        <Link
          href="/platform/features"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Cross-tenant view
          <ExternalLink className="h-3 w-3" />
        </Link>
      }
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-slate-100">
        {catalog.map((c) => {
          const overrideRaw = features.overrides[c.key];
          const state: "on" | "off" | "inherit" =
            overrideRaw === undefined ? "inherit" : overrideRaw ? "on" : "off";
          const effective = features.features[c.key] ?? c.defaultEnabled;
          const isPending = !!pending[c.key];

          return (
            <li
              key={c.key}
              className="flex items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {c.label}
                  </p>
                  {c.comingSoon && (
                    <StatusPill tone="muted" size="xs" uppercase>
                      Soon
                    </StatusPill>
                  )}
                </div>
                <p className="truncate text-[11px] text-slate-500">
                  {c.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">
                  {state === "inherit" ? "Inherits" : "Override"}
                </span>
                <button
                  type="button"
                  onClick={() => void toggle(c.key)}
                  disabled={isPending}
                  className={cn(
                    "inline-flex h-7 w-14 items-center justify-center rounded-md border text-[11px] font-semibold transition-colors disabled:opacity-50",
                    state === "on" &&
                      "border-emerald-300 bg-emerald-50 text-emerald-700",
                    state === "off" &&
                      "border-red-300 bg-red-50 text-red-700",
                    state === "inherit" &&
                      "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                  )}
                  title={
                    state === "inherit"
                      ? `Inherits ${effective ? "ON" : "OFF"} from plan/default`
                      : state === "on"
                        ? "Forced ON"
                        : "Forced OFF"
                  }
                >
                  {state === "inherit"
                    ? effective
                      ? "on*"
                      : "off*"
                    : state === "on"
                      ? "ON"
                      : "OFF"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section: Analytics + trends
// ---------------------------------------------------------------------------

function AnalyticsTrendsCard({ snapshot }: { snapshot: SchoolSnapshot }) {
  return (
    <SectionCard
      title="Platform analytics"
      description="Last 30 days"
      icon={<ClipboardList className="h-3.5 w-3.5" />}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TrendBlock
          label="Fee collection"
          value={formatCurrency(snapshot.financials.paymentsLast30dAmount)}
          subValue={`${snapshot.financials.paymentsLast30dCount.toLocaleString("en-IN")} transactions`}
          icon={<Wallet className="h-3 w-3" />}
          trend={snapshot.financials.collectionTrend.map((t) => t.amount)}
          tone="success"
        />
        <TrendBlock
          label="Attendance volume"
          value={snapshot.academic.attendanceLast30dCount.toLocaleString(
            "en-IN",
          )}
          subValue="entries recorded"
          icon={<CalendarCheck className="h-3 w-3" />}
          trend={snapshot.academic.attendanceTrend.map((t) => t.count)}
          tone="info"
        />
        <TrendBlock
          label="Refunds"
          value={formatCurrency(snapshot.financials.refundsLast30dAmount)}
          subValue={`${snapshot.financials.refundsLast30dCount.toLocaleString("en-IN")} refund${
            snapshot.financials.refundsLast30dCount === 1 ? "" : "s"
          }`}
          icon={<Coins className="h-3 w-3" />}
          // Refunds aren't a daily trend in the snapshot payload (we
          // don't bucket them) — pass an empty trend so the block
          // skips the sparkline and just shows the headline figure.
          trend={[]}
          tone="warning"
        />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500 sm:grid-cols-3">
        <span>
          All-time payments:{" "}
          <strong className="text-slate-700 tabular-nums">
            {formatCurrencyShort(snapshot.financials.paymentsTotalAmount)}
          </strong>
        </span>
        <span>
          Total exams:{" "}
          <strong className="text-slate-700 tabular-nums">
            {snapshot.academic.examsCount.toLocaleString("en-IN")}
          </strong>
        </span>
        <span>
          Active users (30d):{" "}
          <strong className="text-slate-700 tabular-nums">
            {snapshot.usage.activeUsers30d.toLocaleString("en-IN")}
          </strong>
        </span>
      </div>
    </SectionCard>
  );
}

function TrendBlock({
  label,
  value,
  subValue,
  icon,
  trend,
  tone,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  trend: number[];
  tone: "success" | "info" | "warning";
}) {
  const colorClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "info"
        ? "text-sky-600"
        : "text-amber-600";
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-md bg-white",
            colorClass,
          )}
        >
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-2 text-base font-semibold tabular-nums text-slate-900">
        {value}
      </p>
      {subValue && (
        <p className="text-[10px] text-slate-500">{subValue}</p>
      )}
      <div className="mt-2 h-10">
        {trend.length > 0 && (
          <Sparkline
            values={trend}
            width={240}
            height={36}
            filled
            strokeClassName={colorClass}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: Activity feed
// ---------------------------------------------------------------------------

function ActivityFeedCard({
  snapshot,
  schoolId,
}: {
  snapshot: SchoolSnapshot;
  schoolId: string;
}) {
  return (
    <SectionCard
      title="Recent activity"
      description="Combined feed across payments, audit log, and subscription changes."
      icon={<ClipboardList className="h-3.5 w-3.5" />}
      actions={
        <Link
          href={`/platform/audit?targetId=${encodeURIComponent(schoolId)}`}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          Open audit log
          <ExternalLink className="h-3 w-3" />
        </Link>
      }
      bodyClassName="p-0"
    >
      {snapshot.activity.length === 0 ? (
        <PanelEmptyState
          icon={<ClipboardList className="h-4 w-4" />}
          title="No recent activity"
          description="Recent payments, plan changes, and audit events will appear here."
        />
      ) : (
        <ul className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
          {snapshot.activity.map((item, idx) => (
            <ActivityRow key={idx} item={item} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function ActivityRow({ item }: { item: SchoolActivityItem }) {
  const map = activityVisuals(item);
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
          map.bg,
          map.text,
        )}
      >
        {map.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs font-medium text-slate-800">
            {item.title}
          </p>
          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
            {timeAgo(item.at)}
          </span>
        </div>
        {item.subtitle && (
          <p className="truncate text-[11px] text-slate-500">
            {item.subtitle}
          </p>
        )}
        {item.kind === "PAYMENT" && item.meta?.amount !== undefined && (
          <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-emerald-700">
            +{formatCurrency(Number(item.meta.amount))}
          </p>
        )}
        {item.kind === "PAYMENT_REFUND" && item.meta?.amount !== undefined && (
          <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-amber-700">
            −{formatCurrency(Number(item.meta.amount))}
          </p>
        )}
      </div>
    </li>
  );
}

function activityVisuals(item: SchoolActivityItem): {
  icon: React.ReactNode;
  bg: string;
  text: string;
} {
  switch (item.kind) {
    case "PAYMENT":
      return {
        icon: <Wallet className="h-3 w-3" />,
        bg: "bg-emerald-100",
        text: "text-emerald-700",
      };
    case "PAYMENT_REFUND":
      return {
        icon: <Coins className="h-3 w-3" />,
        bg: "bg-amber-100",
        text: "text-amber-700",
      };
    case "SUBSCRIPTION_CREATED":
      return {
        icon: <CreditCard className="h-3 w-3" />,
        bg: "bg-sky-100",
        text: "text-sky-700",
      };
    case "AUDIT": {
      const sub = item.subtype ?? "";
      if (sub.includes("FORCE_LOGOUT") || sub.includes("PASSWORD_RESET")) {
        return {
          icon: <LogOut className="h-3 w-3" />,
          bg: "bg-red-100",
          text: "text-red-700",
        };
      }
      if (sub.includes("IMPERSONATION")) {
        return {
          icon: <UserCog className="h-3 w-3" />,
          bg: "bg-amber-100",
          text: "text-amber-700",
        };
      }
      return {
        icon: <ShieldAlert className="h-3 w-3" />,
        bg: "bg-slate-100",
        text: "text-slate-600",
      };
    }
    default:
      return {
        icon: <Activity className="h-3 w-3" />,
        bg: "bg-slate-100",
        text: "text-slate-600",
      };
  }
}

// ---------------------------------------------------------------------------
// Status-change confirmation dialog (mirrors the schools list page).
// ---------------------------------------------------------------------------

function StatusChangeDialog({
  target,
  school,
  onClose,
  onSaved,
}: {
  target: SchoolStatus | null;
  school: PlatformSchoolRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (target) setReason("");
  }, [target]);

  if (!target) return null;
  const requiresReason = target === "SUSPENDED" || target === "EXPIRED";
  const canSubmit = !requiresReason || reason.trim().length >= 3;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await platformApi.updateSchoolStatus(school.id, {
        status: target,
        reason: requiresReason ? reason.trim() : undefined,
      });
      toast.success(`School set to ${target}.`);
      onSaved();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Failed to update status.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const verb =
    target === "ACTIVE"
      ? "Reactivate"
      : target === "SUSPENDED"
        ? "Suspend"
        : "Mark expired";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            {verb} {school.name}?
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Status will change from{" "}
            <span className="font-mono font-semibold">{school.status}</span>{" "}
            to <span className="font-mono font-semibold">{target}</span>.
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          {requiresReason && (
            <div>
              <label className="block text-[11px] font-medium text-slate-600">
                Reason <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Payment dispute, account abuse, expired plan"
                className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
              />
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            {target === "SUSPENDED"
              ? "All users at this school will be unable to log in until reactivated."
              : target === "EXPIRED"
                ? "Logins will be blocked. Renew the subscription to restore access."
                : "Users will be able to log in again."}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit || submitting}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold text-white transition-colors",
              target === "ACTIVE"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : target === "SUSPENDED"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-amber-600 hover:bg-amber-700",
              (!canSubmit || submitting) && "opacity-50 cursor-not-allowed",
            )}
          >
            {submitting ? "Saving…" : verb}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeAgo(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

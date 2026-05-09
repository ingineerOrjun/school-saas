"use client";

import * as React from "react";
import Link from "next/link";
import {
  CreditCard,
  AlertTriangle,
  Clock,
  Infinity as InfinityIcon,
  RotateCw,
  ArrowRight,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type PlatformSchoolRow,
  type SubscriptionPlan,
} from "@/lib/platform";
import { PlanChip } from "@/components/platform/ManageSubscriptionDialog";
import {
  PageHeader,
  PanelErrorState,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform/subscriptions — cross-tenant view of every school's
// subscription state. Composed entirely from the existing
// /platform/schools listing endpoint (which Phase 4 enriched with
// `currentSubscription`), so no extra round-trip is needed.
//
// Sections:
//   • Top: 4 KPIs (counts by lifecycle bucket).
//   • Body: a table grouped by lifecycle bucket — Expiring soon
//     (within 14 days) is the most operationally urgent and lands
//     at the top.
//
// "Expiring soon" surfaces the schools the platform owner needs to
// chase for renewal this week. Schools with no plan at all are a
// separate bucket — onboarding gap, not renewal urgency.
// ---------------------------------------------------------------------------

const EXPIRING_SOON_DAYS = 14;
const PAGE_SIZE = 100; // pull all-ish; we don't paginate this view

interface BucketedRows {
  expiringSoon: PlatformSchoolRow[];
  active: PlatformSchoolRow[];
  expired: PlatformSchoolRow[];
  noPlan: PlatformSchoolRow[];
}

export default function SubscriptionsOverviewPage() {
  const [rows, setRows] = React.useState<PlatformSchoolRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await platformApi.listSchools({ pageSize: PAGE_SIZE });
      setRows(res.rows);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load subscriptions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const buckets: BucketedRows = React.useMemo(() => {
    const out: BucketedRows = {
      expiringSoon: [],
      active: [],
      expired: [],
      noPlan: [],
    };
    if (!rows) return out;
    const now = Date.now();
    const soonCutoff = now + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
    for (const r of rows) {
      const sub = r.currentSubscription;
      if (!sub) {
        out.noPlan.push(r);
        continue;
      }
      if (sub.endDate === null) {
        // UNLIMITED — never expires.
        out.active.push(r);
        continue;
      }
      const ends = Date.parse(sub.endDate);
      if (!Number.isFinite(ends)) {
        out.active.push(r);
        continue;
      }
      if (ends < now) out.expired.push(r);
      else if (ends <= soonCutoff) out.expiringSoon.push(r);
      else out.active.push(r);
    }
    // Sort the urgent bucket so the soonest-expiring school is at
    // the top — that's the call list for the platform owner.
    out.expiringSoon.sort((a, b) => {
      const aMs = a.currentSubscription?.endDate
        ? Date.parse(a.currentSubscription.endDate)
        : 0;
      const bMs = b.currentSubscription?.endDate
        ? Date.parse(b.currentSubscription.endDate)
        : 0;
      return aMs - bMs;
    });
    return out;
  }, [rows]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Subscriptions"
        description="Plan + renewal status for every school. Click a school to manage its plan."
        icon={<CreditCard className="h-4 w-4" />}
        actions={
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      />

      {error ? (
        <PanelErrorState message={error} onRetry={fetchData} />
      ) : (
        <>
          <KpiRow
            buckets={buckets}
            loading={loading}
          />

          {/* Expiring soon — most urgent, render first. */}
          {buckets.expiringSoon.length > 0 && (
            <BucketSection
              title="Expiring within 14 days"
              tone="warn"
              icon={<Clock className="h-4 w-4" />}
              schools={buckets.expiringSoon}
              loading={false}
            />
          )}
          {/* Already expired — also urgent (operationally similar to
              suspended). */}
          {buckets.expired.length > 0 && (
            <BucketSection
              title="Expired"
              tone="bad"
              icon={<AlertTriangle className="h-4 w-4" />}
              schools={buckets.expired}
              loading={false}
            />
          )}
          {/* No plan — a separate concern (onboarding), shown
              between the "needs attention" rows and the "all good"
              ones. */}
          {buckets.noPlan.length > 0 && (
            <BucketSection
              title="No plan on file"
              tone="muted"
              icon={<CreditCard className="h-4 w-4" />}
              schools={buckets.noPlan}
              loading={false}
            />
          )}
          {/* Active / unlimited — the healthy bucket. */}
          <BucketSection
            title="Active"
            tone="ok"
            icon={<InfinityIcon className="h-4 w-4" />}
            schools={buckets.active}
            loading={loading}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiRow({
  buckets,
  loading,
}: {
  buckets: BucketedRows;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi
        label="Expiring soon"
        value={loading ? null : buckets.expiringSoon.length}
        tone={buckets.expiringSoon.length > 0 ? "warn" : "muted"}
      />
      <Kpi
        label="Expired"
        value={loading ? null : buckets.expired.length}
        tone={buckets.expired.length > 0 ? "bad" : "muted"}
      />
      <Kpi
        label="No plan"
        value={loading ? null : buckets.noPlan.length}
        tone={buckets.noPlan.length > 0 ? "muted" : "muted"}
      />
      <Kpi
        label="Active"
        value={loading ? null : buckets.active.length}
        tone="ok"
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 ${
        tone === "bad"
          ? "border-red-200 bg-red-50/40"
          : tone === "warn"
            ? "border-amber-200 bg-amber-50/40"
            : tone === "ok"
              ? "border-emerald-200 bg-emerald-50/30"
              : "border-slate-200"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${
          tone === "bad" ? "text-red-700" : "text-slate-900"
        }`}
      >
        {value === null ? "—" : value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BucketSection({
  title,
  tone,
  icon,
  schools,
  loading,
}: {
  title: string;
  tone: "ok" | "warn" | "bad" | "muted";
  icon: React.ReactNode;
  schools: PlatformSchoolRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <section>
        <SectionHeader title={title} icon={icon} count={null} tone={tone} />
        <div className="mt-2 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
            />
          ))}
        </div>
      </section>
    );
  }
  if (schools.length === 0) {
    return (
      <section>
        <SectionHeader title={title} icon={icon} count={0} tone={tone} />
        <div className="mt-2 rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs italic text-slate-500">
          Nothing here.
        </div>
      </section>
    );
  }
  return (
    <section>
      <SectionHeader
        title={title}
        icon={icon}
        count={schools.length}
        tone={tone}
      />
      <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2.5 text-left">School</th>
              <th className="px-4 py-2.5 text-left">Plan</th>
              <th className="px-4 py-2.5 text-left">Ends</th>
              <th className="px-4 py-2.5 text-right">Students</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {schools.map((s) => (
              <Row key={s.id} school={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SectionHeader({
  title,
  icon,
  count,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  count: number | null;
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  return (
    <h2
      className={`flex items-center gap-2 text-sm font-semibold ${
        tone === "bad"
          ? "text-red-700"
          : tone === "warn"
            ? "text-amber-700"
            : "text-slate-900"
      }`}
    >
      {icon}
      <span>{title}</span>
      {count !== null && (
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
          {count} school{count === 1 ? "" : "s"}
        </span>
      )}
    </h2>
  );
}

function Row({ school }: { school: PlatformSchoolRow }) {
  const sub = school.currentSubscription;
  const ends = sub?.endDate ? new Date(sub.endDate) : null;
  const daysToEnd = ends
    ? Math.ceil((ends.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{school.name}</div>
        <div className="text-[11px] text-slate-500 font-mono">{school.slug}</div>
      </td>
      <td className="px-4 py-3">
        {sub ? (
          <PlanChip plan={sub.plan as SubscriptionPlan} />
        ) : (
          <span className="text-[10px] italic text-slate-400">No plan</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-slate-700">
        {ends === null ? (
          sub === null ? (
            "—"
          ) : (
            <span className="text-slate-500">No expiry</span>
          )
        ) : (
          <div className="flex flex-col">
            <span className="tabular-nums">
              {ends.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            {daysToEnd !== null && (
              <span
                className={`text-[10px] tabular-nums ${
                  daysToEnd < 0
                    ? "text-red-600"
                    : daysToEnd <= 14
                      ? "text-amber-700"
                      : "text-slate-500"
                }`}
              >
                {daysToEnd < 0
                  ? `${Math.abs(daysToEnd)}d ago`
                  : daysToEnd === 0
                    ? "today"
                    : `in ${daysToEnd}d`}
              </span>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
        {sub?.studentLimit !== null && sub?.studentLimit !== undefined ? (
          <span>
            {school.studentCount.toLocaleString("en-IN")} / {sub.studentLimit}
          </span>
        ) : (
          <span>{school.studentCount.toLocaleString("en-IN")}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/platform/schools?status=`}
          className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-700 hover:text-slate-900"
          title="Open in Schools page"
        >
          Manage
          <ArrowRight className="h-3 w-3" />
        </Link>
      </td>
    </tr>
  );
}

// (ErrorBanner removed — use PanelErrorState from @/components/platform-ui.)

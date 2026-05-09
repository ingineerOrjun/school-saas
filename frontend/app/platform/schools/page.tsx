"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  AlertTriangle,
  ExternalLink,
  Pause,
  Play,
  RotateCw,
  UserCog,
  CreditCard,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type PlatformSchoolRow,
  type PlatformSchoolsResponse,
  type SchoolStatus,
} from "@/lib/platform";
import { formatCurrencyShort } from "@/lib/currency";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ImpersonateUserDialog } from "@/components/impersonation/ImpersonateUserDialog";
import {
  ManageSubscriptionDialog,
  PlanChip,
} from "@/components/platform/ManageSubscriptionDialog";
import { SecurityDialog } from "@/components/platform/SecurityDialog";
import {
  FilterToolbar,
  PageHeader,
  PanelEmptyState,
  PanelErrorState,
  SchoolStatusPill,
  SectionCard,
  SkeletonRows,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform/schools — manage every tenant on the platform.
//
// What lives here:
//   • Searchable, status-filtered, paginated table of schools.
//   • Per-row actions: Suspend / Reactivate. Mark Expired is exposed
//     too because subscription state isn't formally tracked yet
//     (Phase 4).
//   • A confirmation modal that REQUIRES a reason for SUSPENDED /
//     EXPIRED transitions — the same rule the backend enforces.
//
// What's intentionally NOT here yet:
//   • School create / edit forms. Today schools are minted via
//     `/auth/register-admin`; an explicit "create school" flow that
//     pre-provisions an admin password is Phase 4 territory.
//   • Subscription extension UI — same.
//   • Reset admin password — Phase 9.
//
// Initial filter state is read from the URL so deep-links from the
// Overview tiles ("Suspended schools" → ?status=SUSPENDED) work
// correctly. Filter changes don't currently write back to the URL —
// that's the same trade-off the analytics tabs made for filters
// the user only set once per visit.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

export default function PlatformSchoolsPage() {
  const searchParams = useSearchParams();
  const initialStatus =
    (searchParams?.get("status") as SchoolStatus | null) ?? "";

  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<SchoolStatus | "">(initialStatus);
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<PlatformSchoolsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<{
    school: PlatformSchoolRow;
    nextStatus: SchoolStatus;
  } | null>(null);
  // Separate target slot for the impersonation dialog. We keep it
  // separate from the status-change target so an open
  // impersonation dialog doesn't get mistaken for a status flip in
  // progress.
  const [impersonateTarget, setImpersonateTarget] =
    React.useState<PlatformSchoolRow | null>(null);
  const [subscriptionTarget, setSubscriptionTarget] =
    React.useState<PlatformSchoolRow | null>(null);
  // Phase 9 — security dialog target. Separate slot from
  // impersonation / subscription so an open security panel doesn't
  // collide with the others.
  const [securityTarget, setSecurityTarget] =
    React.useState<PlatformSchoolRow | null>(null);

  // Debounce search to keep keystrokes from spamming the backend.
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever filters change.
  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await platformApi.listSchools({
        q: debouncedSearch || undefined,
        status: (status || undefined) as SchoolStatus | undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load schools.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, page]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStatusChange = (
    school: PlatformSchoolRow,
    nextStatus: SchoolStatus,
  ) => {
    setTarget({ school, nextStatus });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Schools"
        description="Every tenant on the platform. Open a row for the full detail page."
        icon={<Building2 className="h-4 w-4" />}
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

      <FilterToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, slug, or email…"
        activeFilters={
          status
            ? [{ label: `Status: ${status}`, onClear: () => setStatus("") }]
            : []
        }
        onClearAll={status ? () => setStatus("") : undefined}
      >
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as SchoolStatus | "")}
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="TRIAL">Trial</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </FilterToolbar>

      {/* Result count */}
      {data && !loading && (
        <p className="text-xs text-slate-500">
          {data.total.toLocaleString("en-IN")} school
          {data.total === 1 ? "" : "s"}
          {(debouncedSearch || status) && " (filtered)"}
        </p>
      )}

      {/* Table / state */}
      {loading ? (
        <SectionCard bare>
          <SkeletonRows rows={6} />
        </SectionCard>
      ) : error ? (
        <PanelErrorState message={error} onRetry={fetchData} />
      ) : !data || data.rows.length === 0 ? (
        <SectionCard bare>
          <PanelEmptyState
            icon={<Building2 className="h-4 w-4" />}
            title={
              !!debouncedSearch || !!status
                ? "No schools match these filters"
                : "No schools yet"
            }
            description={
              !!debouncedSearch || !!status
                ? "Try widening the search or clearing the status filter."
                : undefined
            }
          />
        </SectionCard>
      ) : (
        <>
          <SchoolsTable
            rows={data.rows}
            onStatusChange={handleStatusChange}
            onImpersonate={setImpersonateTarget}
            onManageSubscription={setSubscriptionTarget}
            onOpenSecurity={setSecurityTarget}
          />
          {data.total > PAGE_SIZE && (
            <Pagination
              page={page}
              total={data.total}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          )}
        </>
      )}

      {/* Status change confirmation modal */}
      <UpdateStatusDialog
        target={target}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          fetchData();
        }}
      />

      {/* Impersonation user-picker. Closes on successful pick by
          hard-navigating to /dashboard, so an explicit success
          handler isn't needed. */}
      <ImpersonateUserDialog
        school={impersonateTarget}
        onClose={() => setImpersonateTarget(null)}
      />

      {/* Subscription dialog. After a successful save the dialog
          stays open (so the operator can see the new entry land in
          the history list) and we refresh the table behind it so
          the row's plan chip + expiry update without a manual
          reload. */}
      <ManageSubscriptionDialog
        school={subscriptionTarget}
        onClose={() => setSubscriptionTarget(null)}
        onSaved={() => {
          fetchData();
          setSubscriptionTarget(null);
        }}
      />

      {/* Phase 9 security panel — force-logout + admin password
          reset. The dialog auto-loads the school's users on mount,
          mirrors the impersonation picker's loading shape. */}
      <SecurityDialog
        school={securityTarget}
        onClose={() => setSecurityTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SchoolsTable({
  rows,
  onStatusChange,
  onImpersonate,
  onManageSubscription,
  onOpenSecurity,
}: {
  rows: PlatformSchoolRow[];
  onStatusChange: (s: PlatformSchoolRow, next: SchoolStatus) => void;
  onImpersonate: (s: PlatformSchoolRow) => void;
  onManageSubscription: (s: PlatformSchoolRow) => void;
  onOpenSecurity: (s: PlatformSchoolRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-2.5 text-left">School</th>
            <th className="px-4 py-2.5 text-left">Status</th>
            <th className="px-4 py-2.5 text-left">Plan</th>
            <th className="px-4 py-2.5 text-right">Students</th>
            <th className="px-4 py-2.5 text-right">Teachers</th>
            <th className="px-4 py-2.5 text-right">Payments</th>
            <th className="px-4 py-2.5 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((s) => (
            <tr key={s.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <a
                  href={`/platform/schools/${encodeURIComponent(s.id)}`}
                  className="font-medium text-slate-900 hover:text-slate-700 hover:underline"
                >
                  {s.name}
                </a>
                <div className="text-[11px] text-slate-500">
                  {s.slug}
                  {s.email && (
                    <>
                      {" · "}
                      {s.email}
                    </>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <SchoolStatusPill status={s.status} />
              </td>
              <td className="px-4 py-3">
                {s.currentSubscription ? (
                  <div className="flex flex-col gap-0.5">
                    <PlanChip plan={s.currentSubscription.plan} />
                    {s.currentSubscription.endDate && (
                      <span className="text-[10px] tabular-nums text-slate-500">
                        until{" "}
                        {new Date(
                          s.currentSubscription.endDate,
                        ).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-[10px] italic text-slate-400">
                    No plan
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                {s.studentCount.toLocaleString("en-IN")}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                {s.teacherCount.toLocaleString("en-IN")}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                {formatCurrencyShort(s.paymentsTotalAmount)}
              </td>
              <td className="px-4 py-3 text-right">
                <RowActions
                  school={s}
                  onStatusChange={onStatusChange}
                  onImpersonate={onImpersonate}
                  onManageSubscription={onManageSubscription}
                  onOpenSecurity={onOpenSecurity}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({
  school,
  onStatusChange,
  onImpersonate,
  onManageSubscription,
  onOpenSecurity,
}: {
  school: PlatformSchoolRow;
  onStatusChange: (s: PlatformSchoolRow, next: SchoolStatus) => void;
  onImpersonate: (s: PlatformSchoolRow) => void;
  onManageSubscription: (s: PlatformSchoolRow) => void;
  onOpenSecurity: (s: PlatformSchoolRow) => void;
}) {
  // Action availability per current status:
  //   ACTIVE / TRIAL → Sign in + Manage plan + Suspend
  //   SUSPENDED      → Manage plan + Reactivate
  //                    (Manage plan exposed even on suspended schools
  //                     so the operator can record a renewal alongside
  //                     the reactivation. Phase 4 won't auto-flip
  //                     SUSPENDED → ACTIVE on subscription create —
  //                     the operator does that explicitly afterwards.)
  //   EXPIRED        → Manage plan + Reactivate
  const canImpersonate =
    school.status === "ACTIVE" || school.status === "TRIAL";

  return (
    <div className="inline-flex items-center gap-1">
      <a
        href={`/platform/schools/${encodeURIComponent(school.id)}`}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-colors"
        title="Open school detail page"
      >
        <ExternalLink className="h-3 w-3" />
        Open
      </a>
      {canImpersonate && (
        <button
          type="button"
          onClick={() => onImpersonate(school)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-colors"
          title="Sign in as a school user (impersonation)"
        >
          <UserCog className="h-3 w-3" />
          Sign in
        </button>
      )}
      <button
        type="button"
        onClick={() => onManageSubscription(school)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-colors"
        title="Manage subscription"
      >
        <CreditCard className="h-3 w-3" />
        Plan
      </button>
      {/* Phase 9 — security panel: force-logout + reset password.
          Available for every school regardless of status — the
          operator may need to reset credentials at a SUSPENDED
          tenant during incident response. */}
      <button
        type="button"
        onClick={() => onOpenSecurity(school)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:border-red-300 hover:text-red-700 transition-colors"
        title="Security controls — force logout, reset password"
      >
        <ShieldAlert className="h-3 w-3" />
        Security
      </button>
      {canImpersonate ? (
        <button
          type="button"
          onClick={() => onStatusChange(school, "SUSPENDED")}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:border-red-300 hover:text-red-700 transition-colors"
          title="Suspend this school"
        >
          <Pause className="h-3 w-3" />
          Suspend
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onStatusChange(school, "ACTIVE")}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:border-emerald-300 hover:text-emerald-700 transition-colors"
          title="Reactivate this school"
        >
          <Play className="h-3 w-3" />
          Reactivate
        </button>
      )}
    </div>
  );
}

// (StatusPill moved to @/components/platform-ui/StatusPill — see
// SchoolStatusPill in the import list at the top of this file.)

// ---------------------------------------------------------------------------
// Confirmation dialog. Required reason for SUSPENDED transitions —
// the backend rejects without one, but pre-empting that here avoids
// a round-trip for an obvious validation failure.
// ---------------------------------------------------------------------------

function UpdateStatusDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { school: PlatformSchoolRow; nextStatus: SchoolStatus } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setReason("");
  }, [target]);

  if (!target) return null;
  const { school, nextStatus } = target;
  const reasonRequired = nextStatus === "SUSPENDED" || nextStatus === "EXPIRED";
  const canSubmit =
    !submitting && (!reasonRequired || reason.trim().length >= 5);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await platformApi.updateSchoolStatus(school.id, {
        status: nextStatus,
        reason: reason.trim() || undefined,
      });
      toast.success(
        nextStatus === "SUSPENDED"
          ? `Suspended ${school.name}`
          : nextStatus === "EXPIRED"
            ? `Marked ${school.name} as expired`
            : `Reactivated ${school.name}`,
      );
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update status.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const verb =
    nextStatus === "SUSPENDED"
      ? "Suspend"
      : nextStatus === "EXPIRED"
        ? "Mark expired"
        : "Reactivate";

  return (
    <Modal
      open={true}
      onClose={submitting ? () => {} : onClose}
      title={`${verb} school`}
      description={`This will change "${school.name}" to ${nextStatus}.`}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            type="button"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
            variant={reasonRequired ? "destructive" : "primary"}
          >
            {submitting ? "Saving…" : verb}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {nextStatus === "SUSPENDED" && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50/50 p-3 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              All users at this school — including the school admin —
              will be blocked from logging in until you reactivate. No
              data is deleted.
            </div>
          </div>
        )}
        {reasonRequired && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="reason"
              className="text-sm font-medium text-slate-900"
            >
              Reason{" "}
              <span className="text-red-600" aria-label="required">
                *
              </span>
            </label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              required
              minLength={5}
              placeholder="e.g. Subscription unpaid for 60 days · Suspected fraud · Customer requested pause"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400 resize-none"
            />
            <p className="text-xs text-slate-500">
              Recorded for the audit trail. Required (5+ characters).
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between text-sm">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
        className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        Previous
      </button>
      <span className="text-xs tabular-nums text-slate-500">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

// (Skeleton/Empty/Error states moved to @/components/platform-ui —
//  SkeletonRows / PanelEmptyState / PanelErrorState.)

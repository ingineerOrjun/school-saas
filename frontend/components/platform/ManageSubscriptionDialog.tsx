"use client";

import * as React from "react";
import {
  X,
  Loader2,
  AlertTriangle,
  Calendar,
  Users,
  GraduationCap,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type BillingCycle,
  type CreateSubscriptionInput,
  type PlatformSchoolRow,
  type SubscriptionPlan,
  type SubscriptionRow,
} from "@/lib/platform";

// ---------------------------------------------------------------------------
// ManageSubscriptionDialog — create a new subscription period for a
// school. Subscriptions are append-only on the backend, so the
// "edit" affordance for a plan is simply "create a new period that
// supersedes the old one." That keeps the audit trail clean and
// avoids hidden-state ambiguity.
//
// Layout:
//   • Top: school identity + current plan summary (read-only).
//   • Form: plan picker, billing cycle, dates, optional limits, notes.
//   • Bottom: history of previous subscription periods (newest-first).
//
// Plan defaults:
//   • TRIAL → 14-day window, ONE_TIME cycle, no student/teacher limit
//   • MONTHLY → 1-month window, MONTHLY cycle
//   • YEARLY → 1-year window, YEARLY cycle
//   • UNLIMITED → no end date, PERPETUAL cycle
//
// All defaults are editable — the operator can override anything.
// ---------------------------------------------------------------------------

const PLAN_DEFAULTS: Record<
  SubscriptionPlan,
  {
    billingCycle: BillingCycle;
    durationMonths: number | null; // null = unlimited
    studentLimit: number | null;
    teacherLimit: number | null;
  }
> = {
  TRIAL: {
    billingCycle: "ONE_TIME",
    durationMonths: 0.5, // ~14 days; we round to the nearest day below
    studentLimit: null,
    teacherLimit: null,
  },
  MONTHLY: {
    billingCycle: "MONTHLY",
    durationMonths: 1,
    studentLimit: null,
    teacherLimit: null,
  },
  YEARLY: {
    billingCycle: "YEARLY",
    durationMonths: 12,
    studentLimit: null,
    teacherLimit: null,
  },
  UNLIMITED: {
    billingCycle: "PERPETUAL",
    durationMonths: null,
    studentLimit: null,
    teacherLimit: null,
  },
};

export function ManageSubscriptionDialog({
  school,
  onClose,
  onSaved,
}: {
  school: PlatformSchoolRow | null;
  onClose: () => void;
  onSaved: (sub: SubscriptionRow) => void;
}) {
  const [plan, setPlan] = React.useState<SubscriptionPlan>("MONTHLY");
  const [billingCycle, setBillingCycle] =
    React.useState<BillingCycle>("MONTHLY");
  const [startDate, setStartDate] = React.useState<string>(todayIso());
  const [endDate, setEndDate] = React.useState<string>(monthsFromTodayIso(1));
  const [studentLimit, setStudentLimit] = React.useState<string>("");
  const [teacherLimit, setTeacherLimit] = React.useState<string>("");
  const [notes, setNotes] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);

  const [history, setHistory] = React.useState<SubscriptionRow[] | null>(null);
  const [historyError, setHistoryError] = React.useState<string | null>(null);

  // Reset + load history when the school changes.
  React.useEffect(() => {
    if (!school) return;
    setPlan("MONTHLY");
    setBillingCycle("MONTHLY");
    setStartDate(todayIso());
    setEndDate(monthsFromTodayIso(1));
    setStudentLimit("");
    setTeacherLimit("");
    setNotes("");
    setHistory(null);
    setHistoryError(null);
    let cancelled = false;
    platformApi
      .listSubscriptions(school.id)
      .then((rows) => {
        if (!cancelled) setHistory(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setHistoryError(
          err instanceof ApiError ? err.message : "Failed to load history.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [school]);

  // Plan change → reset cycle + duration to the plan's defaults. The
  // operator can override afterwards; this just makes the common
  // case (pick MONTHLY → end-date auto-fills) one click.
  const handlePlanChange = (next: SubscriptionPlan) => {
    setPlan(next);
    const def = PLAN_DEFAULTS[next];
    setBillingCycle(def.billingCycle);
    if (def.durationMonths === null) {
      setEndDate("");
    } else {
      setEndDate(monthsFromTodayIso(def.durationMonths));
    }
    setStudentLimit(def.studentLimit?.toString() ?? "");
    setTeacherLimit(def.teacherLimit?.toString() ?? "");
  };

  // Esc closes — same parity as other platform dialogs.
  React.useEffect(() => {
    if (!school) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [school, submitting, onClose]);

  if (!school) return null;

  // Validation guards. The submit button is enabled only when the
  // plan + dates are coherent; each branch reports a specific reason
  // when invalid so the operator knows what to fix.
  let validationError: string | null = null;
  if (plan !== "UNLIMITED" && !endDate) {
    validationError = "End date is required for this plan.";
  } else if (plan !== "UNLIMITED" && endDate <= startDate) {
    validationError = "End date must be after start date.";
  } else if (studentLimit && !/^\d+$/.test(studentLimit)) {
    validationError = "Student limit must be a whole number.";
  } else if (teacherLimit && !/^\d+$/.test(teacherLimit)) {
    validationError = "Teacher limit must be a whole number.";
  }

  const canSubmit = !submitting && !validationError;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload: CreateSubscriptionInput = {
        plan,
        billingCycle,
        startDate,
        endDate: plan === "UNLIMITED" ? null : endDate,
        studentLimit: studentLimit ? parseInt(studentLimit, 10) : null,
        teacherLimit: teacherLimit ? parseInt(teacherLimit, 10) : null,
        notes: notes.trim() || null,
      };
      const created = await platformApi.createSubscription(school.id, payload);
      toast.success(`Subscription created · ${plan}`);
      onSaved(created);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to create subscription.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const currentSub = school.currentSubscription;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl animate-fade-in-up"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Manage subscription
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 truncate">
              {school.name}
              {" · "}
              <span className="font-mono">{school.slug}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 px-5 py-5">
          {/* Current plan summary */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              Current plan
            </h3>
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
              {currentSub ? (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <PlanChip plan={currentSub.plan} />
                  <span className="text-slate-700">
                    {labelCycle(currentSub.billingCycle)}
                  </span>
                  <span className="text-slate-500">
                    {currentSub.endDate
                      ? `until ${formatDate(currentSub.endDate)}`
                      : "no expiry"}
                  </span>
                </div>
              ) : (
                <p className="italic text-slate-500">
                  No subscription on file yet.
                </p>
              )}
            </div>
          </section>

          {/* New subscription form */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              New subscription period
            </h3>

            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField label="Plan">
                <select
                  value={plan}
                  onChange={(e) =>
                    handlePlanChange(e.target.value as SubscriptionPlan)
                  }
                  disabled={submitting}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                >
                  <option value="TRIAL">Trial</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                  <option value="UNLIMITED">Unlimited</option>
                </select>
              </FormField>

              <FormField label="Billing cycle">
                <select
                  value={billingCycle}
                  onChange={(e) =>
                    setBillingCycle(e.target.value as BillingCycle)
                  }
                  disabled={submitting}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="YEARLY">Yearly</option>
                  <option value="ONE_TIME">One-time (trial)</option>
                  <option value="PERPETUAL">Perpetual (unlimited)</option>
                </select>
              </FormField>

              <FormField label="Start date" icon={<Calendar className="h-3.5 w-3.5" />}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={submitting}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                />
              </FormField>

              <FormField
                label="End date"
                icon={<Calendar className="h-3.5 w-3.5" />}
                hint={plan === "UNLIMITED" ? "Disabled — no expiry" : undefined}
              >
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={submitting || plan === "UNLIMITED"}
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </FormField>

              <FormField
                label="Student limit"
                icon={<Users className="h-3.5 w-3.5" />}
                hint="Leave blank for unlimited"
              >
                <input
                  type="number"
                  min={0}
                  value={studentLimit}
                  onChange={(e) => setStudentLimit(e.target.value)}
                  disabled={submitting}
                  placeholder="No limit"
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                />
              </FormField>

              <FormField
                label="Teacher limit"
                icon={<GraduationCap className="h-3.5 w-3.5" />}
                hint="Leave blank for unlimited"
              >
                <input
                  type="number"
                  min={0}
                  value={teacherLimit}
                  onChange={(e) => setTeacherLimit(e.target.value)}
                  disabled={submitting}
                  placeholder="No limit"
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                />
              </FormField>
            </div>

            <FormField
              label="Notes"
              hint="Free-form note recorded with this subscription period (audit visible)."
            >
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
                disabled={submitting}
                placeholder="e.g. Renewed early at parent's request"
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400 resize-none"
              />
            </FormField>
          </section>

          {/* History */}
          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
              History
            </h3>
            {historyError ? (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {historyError}
              </div>
            ) : history === null ? (
              <p className="mt-2 text-xs italic text-slate-500">Loading…</p>
            ) : history.length === 0 ? (
              <p className="mt-2 text-xs italic text-slate-500">
                No previous subscriptions.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {history.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-slate-100 bg-white px-3 py-2 text-xs"
                  >
                    <PlanChip plan={row.plan} />
                    <span className="text-slate-700">
                      {labelCycle(row.billingCycle)}
                    </span>
                    <span className="text-slate-500 tabular-nums">
                      {formatDate(row.startDate)}
                      {row.endDate ? ` → ${formatDate(row.endDate)}` : " → ∞"}
                    </span>
                    {row.createdByEmail && (
                      <span className="ml-auto text-slate-400">
                        by {row.createdByEmail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
          {validationError ? (
            <p className="flex items-center gap-1.5 text-xs text-red-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              {validationError}
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Audit row will be recorded under your account.
            </p>
          )}
          <div className="flex items-center gap-2">
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
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Create subscription"
              )}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FormField({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
        {icon}
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function PlanChip({ plan }: { plan: SubscriptionPlan }) {
  const map: Record<
    SubscriptionPlan,
    { label: string; className: string }
  > = {
    TRIAL: {
      label: "Trial",
      className: "bg-sky-500/15 text-sky-700",
    },
    MONTHLY: {
      label: "Monthly",
      className: "bg-slate-200 text-slate-800",
    },
    YEARLY: {
      label: "Yearly",
      className: "bg-emerald-500/15 text-emerald-700",
    },
    UNLIMITED: {
      label: "Unlimited",
      className: "bg-violet-500/15 text-violet-700",
    },
  };
  const { label, className } = map[plan];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}
    >
      {label}
    </span>
  );
}

function labelCycle(c: BillingCycle): string {
  switch (c) {
    case "MONTHLY":
      return "Monthly billing";
    case "YEARLY":
      return "Yearly billing";
    case "ONE_TIME":
      return "One-time";
    case "PERPETUAL":
      return "Perpetual";
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthsFromTodayIso(months: number): string {
  const d = new Date();
  // Round to whole days for sub-month durations (e.g. 0.5 = ~14 days for trials).
  if (months < 1) {
    const days = Math.round(months * 30);
    d.setDate(d.getDate() + days);
  } else {
    d.setMonth(d.getMonth() + Math.floor(months));
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

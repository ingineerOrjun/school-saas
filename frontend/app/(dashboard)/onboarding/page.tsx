"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Layers,
  Loader2,
  School2,
  UserPlus,
  Wallet,
} from "lucide-react";
import {
  productizationApi,
  type OnboardingStatus,
  type OnboardingStep,
} from "@/lib/productization";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /onboarding — Phase 23 Section 1.
//
// Resumable wizard. The page reads the persisted status (so a refresh
// brings the user back to the same step) and renders all five steps
// as a checklist with a visible "current" highlight.
//
// Each step is just a deep-link out to the existing product surface
// (school profile lives at /settings, classes at /classes, etc) —
// the wizard doesn't reimplement those forms. After the user finishes
// each step they come back here; the status auto-refreshes via
// invalidate-on-focus.
//
// Operator can skip the wizard entirely via "Mark complete." The
// dashboard shell stops redirecting once `completed` flips true.
// ---------------------------------------------------------------------------

const STEPS: Array<{
  slug: OnboardingStep;
  label: string;
  description: string;
  href: string;
  icon: React.ReactNode;
}> = [
  {
    slug: "school-profile",
    label: "School profile",
    description: "Add your logo, address, phone, and principal name.",
    href: "/settings",
    icon: <School2 className="h-4 w-4" />,
  },
  {
    slug: "academic-setup",
    label: "Academic setup",
    description:
      "Create the current academic session and at least one class.",
    href: "/classes",
    icon: <Layers className="h-4 w-4" />,
  },
  {
    slug: "staff-setup",
    label: "Staff setup",
    description: "Invite at least one teacher to join the school.",
    href: "/settings/invitations",
    icon: <UserPlus className="h-4 w-4" />,
  },
  {
    slug: "fee-setup",
    label: "Fee setup",
    description: "Define your first fee structure so cashiers can collect.",
    href: "/fees",
    icon: <Wallet className="h-4 w-4" />,
  },
];

export default function OnboardingPage() {
  const qc = useQueryClient();
  const status = useQuery<OnboardingStatus>({
    queryKey: qk.productization.onboarding,
    queryFn: () => productizationApi.getOnboarding(),
    refetchOnWindowFocus: true,
  });
  const completeMutation = useMutation({
    mutationFn: () => productizationApi.completeOnboarding(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.productization.onboarding });
    },
  });

  const data = status.data;
  if (status.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading wizard…
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          First-run setup
        </p>
        <h1 className="text-2xl font-semibold mt-1">
          Get your school live in five steps
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each step is independent — skip what you don't need today and come
          back any time. Your progress is saved automatically.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Overall progress</p>
          <p className="text-sm tabular-nums font-semibold">
            {data.completionPct}%
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              data.completionPct >= 100
                ? "bg-emerald-500"
                : data.completionPct > 50
                  ? "bg-primary"
                  : "bg-amber-500",
            )}
            style={{ width: `${Math.max(2, data.completionPct)}%` }}
          />
        </div>
      </div>

      <ul className="space-y-3">
        {STEPS.map((step) => {
          const stat = data.steps.find((s) => s.slug === step.slug);
          const done = stat?.done ?? false;
          const isCurrent = data.currentStep === step.slug;
          return (
            <li
              key={step.slug}
              className={cn(
                "rounded-xl border bg-card p-4 transition-colors",
                isCurrent && "border-primary/40 bg-primary/[0.02]",
                done && "border-emerald-200/60 bg-emerald-50/30",
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    done
                      ? "bg-emerald-100 text-emerald-700"
                      : isCurrent
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    step.icon
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{step.label}</p>
                    {done && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        Done
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {step.description}
                  </p>
                  {stat?.detail && (
                    <p className="mt-1 text-[11px] tabular-nums text-muted-foreground/80">
                      {stat.detail}
                    </p>
                  )}
                </div>
                <Link
                  href={step.href}
                  className={cn(
                    "shrink-0 inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium transition-colors",
                    done
                      ? "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                      : "border-input bg-card text-foreground hover:bg-muted/40",
                  )}
                >
                  {done ? "Review" : isCurrent ? "Continue" : "Open"}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-xl border bg-card p-4">
        {data.completed ? (
          <div className="flex items-center gap-3">
            <Circle className="h-4 w-4 text-emerald-500 fill-current" />
            <div className="flex-1">
              <p className="text-sm font-semibold">Onboarding complete</p>
              <p className="text-xs text-muted-foreground">
                You can re-open this page any time from settings.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Open dashboard
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Ready to launch?</p>
              <p className="text-xs text-muted-foreground">
                Mark onboarding complete and head to your dashboard. You can
                always revisit incomplete steps later.
              </p>
            </div>
            <button
              type="button"
              disabled={completeMutation.isPending}
              onClick={() => completeMutation.mutate()}
              className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {completeMutation.isPending ? "Saving…" : "Mark complete"}
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

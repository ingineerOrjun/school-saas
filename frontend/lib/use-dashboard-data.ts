"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { getStoredSchool } from "./auth";
import {
  dashboardApi,
  type DashboardSummary,
} from "./dashboard";
import { useAuthReady } from "@/hooks/useAuthReady";
import { qk } from "./query-keys";
import { STALE } from "./query-client";
import { shouldAllowRequest } from "./request-cooldown";
import type { StudentDto } from "./students";
import { studentsApi } from "./students";
import type {
  DashboardData,
  FeeStatus,
  Student,
  StudentStatus,
} from "./types";

// ---------------------------------------------------------------------------
// useDashboardData — Phase α fix (was: raw useEffect+fetch).
//
// Backed by React Query so multiple components on the same page +
// React 18 StrictMode dev double-mounts collapse to ONE underlying
// /dashboard/summary fetch. Public API is unchanged from the prior
// implementation — every consumer (AdminDashboardView,
// TeacherDashboardView, analytics OverviewTab) keeps working.
//
// Why this was 429-ing:
//   The previous version did `useEffect(() => fetch(), [])` which
//   in dev double-fires because of StrictMode, and which has no
//   shared cache so every component using the hook ran its own
//   request. Two-three consumers + a fast nav between /dashboard
//   and /analytics rapidly hit the default 600/min throttle bucket
//   on dev sessions where the same JWT bursts requests on multiple
//   tabs.
//
// Now: shared `qk.dashboardSummary` key, 60s staleTime so a
// refresh during the freshness window returns from cache, and
// `refresh()` triggers an explicit `refetch()` for the
// pull-to-refresh affordance.
// ---------------------------------------------------------------------------

export type DashboardState = "loading" | "empty" | "ready" | "error";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  done: boolean;
  cta?: string;
}

export interface UseDashboardData {
  state: DashboardState;
  data: DashboardData | null;
  school: { name: string };
  onboarding: {
    steps: OnboardingStep[];
    completed: number;
    total: number;
    progress: number;
  };
  error: string | null;
  /** All students — only fetched on demand when Export CSV is clicked. */
  allStudents: StudentDto[];
  /** True while the background CSV prefetch is in flight. */
  loadingStudents: boolean;
  /** Kick off a students fetch for the CSV export. Idempotent. */
  ensureStudentsLoaded: () => Promise<StudentDto[]>;
  refresh: () => Promise<void>;
  refreshing: boolean;
}

const FALLBACK_SCHOOL_NAME = "your school";

export function useDashboardData(): UseDashboardData {
  const qc = useQueryClient();
  const { authReady, isAuthenticated } = useAuthReady();

  // Seed school name from localStorage so the greeting renders
  // immediately, before the query resolves.
  const [schoolName, setSchoolName] = React.useState<string>(() => {
    if (typeof window === "undefined") return FALLBACK_SCHOOL_NAME;
    return getStoredSchool()?.name ?? FALLBACK_SCHOOL_NAME;
  });

  const summary = useQuery<DashboardSummary, ApiError>({
    queryKey: qk.dashboardSummary,
    queryFn: () => dashboardApi.getSummary(),
    // Phase α follow-up — gate on the subscribable auth-store. The
    // previous version fired on first render which on a cold reload
    // raced the localStorage restore + produced user=<anon> 429s.
    enabled: authReady && isAuthenticated,
    staleTime: STALE.SEMI_STATIC,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      // 401 → user is logged out, no point retrying.
      if (error?.status === 401 || error?.status === 403) return false;
      return failureCount < 1;
    },
  });

  // Prefer the live school name when the query lands.
  React.useEffect(() => {
    if (summary.data?.school?.name) {
      setSchoolName(summary.data.school.name);
    }
  }, [summary.data?.school?.name]);

  // On-demand student-list fetch for CSV export. Kept as a separate
  // mutation so it doesn't run on dashboard mount (keeps the
  // critical-path payload small).
  const studentsMutation = useMutation({
    mutationFn: () => studentsApi.list(),
  });
  const ensureStudentsLoaded = React.useCallback(async () => {
    if (studentsMutation.data && studentsMutation.data.length > 0) {
      return studentsMutation.data;
    }
    return studentsMutation.mutateAsync();
  }, [studentsMutation]);

  // Two-layer suppression so the Refresh button can't be weaponised:
  //   1. `isFetching` guard — if a fetch is already in flight, the
  //      click is a no-op (no point invalidating; the result will
  //      land momentarily anyway).
  //   2. 2s cooldown — if the user clicks again within 2s of the
  //      previous fire, the click is also a no-op (covers the race
  //      where setState hasn't committed yet so isFetching reads
  //      stale).
  // The explicit `summary.refetch()` is gone: invalidateQueries
  // already triggers a refetch for active observers, so the second
  // call was redundant request pressure.
  const isFetching = summary.isFetching;
  const refresh = React.useCallback(async () => {
    if (isFetching) return;
    if (!shouldAllowRequest("dashboard-summary-refresh", 2000)) return;
    await qc.invalidateQueries({ queryKey: qk.dashboardSummary });
  }, [qc, isFetching]);

  // Translate backend → UI shape. Memoised to avoid re-creating the
  // inner arrays on every render.
  const data: DashboardData | null = React.useMemo(() => {
    const s = summary.data;
    if (!s) return null;
    return {
      stats: {
        totalStudents: s.stats.totalStudents,
        totalTeachers: s.stats.totalTeachers,
        attendanceTodayPct: s.stats.attendanceTodayPct,
        feesCollected: s.stats.feesCollected,
        totalCredit: s.stats.totalCredit,
        studentsDelta: s.stats.studentsDelta,
        teachersDelta: s.stats.teachersDelta,
        attendanceDelta: s.stats.attendanceDelta,
        feesDelta: s.stats.feesDelta,
      },
      recentStudents: s.recentStudents.map<Student>((row) => ({
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        grade: row.className ?? "Unassigned",
        section: row.sectionName ?? "Whole class",
        status: "Active" as StudentStatus,
        fees: row.feeStatus as FeeStatus,
      })),
    };
  }, [summary.data]);

  const state: DashboardState = React.useMemo(() => {
    if (summary.isLoading) return "loading";
    if (summary.error) return "error";
    if (!summary.data) return "loading";
    const hasAnyContent =
      summary.data.stats.totalStudents > 0 ||
      summary.data.stats.totalTeachers > 0;
    return hasAnyContent ? "ready" : "empty";
  }, [summary.isLoading, summary.error, summary.data]);

  const onboarding = React.useMemo(
    () => buildOnboarding(state, summary.data ?? null),
    [state, summary.data],
  );

  return {
    state,
    data,
    school: { name: schoolName },
    onboarding,
    error: summary.error?.message ?? null,
    allStudents: studentsMutation.data ?? [],
    loadingStudents: studentsMutation.isPending,
    ensureStudentsLoaded,
    refresh,
    refreshing: summary.isFetching && !summary.isLoading,
  };
}

function buildOnboarding(
  state: DashboardState,
  summary: DashboardSummary | null,
): UseDashboardData["onboarding"] {
  const hasStudents = summary?.onboarding.hasStudents ?? false;
  const hasTeachers = summary?.onboarding.hasTeachers ?? false;
  const hasClasses = summary?.onboarding.hasClasses ?? false;

  const steps: OnboardingStep[] = [
    {
      id: "workspace",
      title: "Create your school workspace",
      description: "Your tenant is live and ready to go.",
      done: true,
    },
    {
      id: "student",
      title: "Add your first student",
      description: "Start tracking attendance, grades, and fees.",
      done: hasStudents,
      cta: "Add student",
    },
    {
      id: "teacher",
      title: "Invite a teacher",
      description: "Teachers manage classes and post announcements.",
      done: hasTeachers,
      cta: "Add teacher",
    },
    {
      id: "schedule",
      title: "Set up classes and sections",
      description: "Define classes so students can be grouped and graded.",
      done: hasClasses,
      cta: "Manage classes",
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const progress =
    state === "loading" ? 0 : Math.round((completed / total) * 100);

  return { steps, completed, total, progress };
}

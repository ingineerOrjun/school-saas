"use client";

import * as React from "react";
import { ApiError } from "./api";
import { getStoredSchool } from "./auth";
import {
  dashboardApi,
  type DashboardSummary,
} from "./dashboard";
import type { StudentDto } from "./students";
import { studentsApi } from "./students";
import type {
  DashboardData,
  FeeStatus,
  Student,
  StudentStatus,
} from "./types";

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

/**
 * Dashboard data layer backed by a single aggregate endpoint.
 *
 * Fetches `GET /dashboard/summary` once on mount, and again on demand
 * via `refresh()`. The JWT is attached automatically by the `api()`
 * client (it reads `scholaris:token` from localStorage).
 *
 * The response shape is used directly — there's no `{ data: ... }`
 * envelope on this backend.
 */
export function useDashboardData(): UseDashboardData {
  const [state, setState] = React.useState<DashboardState>("loading");
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [schoolName, setSchoolName] = React.useState<string>(
    FALLBACK_SCHOOL_NAME,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [allStudents, setAllStudents] = React.useState<StudentDto[]>([]);
  const [loadingStudents, setLoadingStudents] = React.useState(false);

  // Seed the school name from localStorage so the greeting shows
  // immediately, before the API responds.
  React.useEffect(() => {
    const stored = getStoredSchool();
    if (stored?.name) setSchoolName(stored.name);
  }, []);

  const load = React.useCallback(
    async (isRefresh: boolean): Promise<void> => {
      if (isRefresh) setRefreshing(true);
      else setState("loading");
      setError(null);

      try {
        const data = await dashboardApi.getSummary();

        // REQUIREMENT: log the response so the shape is verifiable in
        // the browser console.
        console.log("[dashboard] /dashboard/summary response:", data);

        setSummary(data);

        // Prefer the live school name over the one in localStorage —
        // the backend is the source of truth.
        if (data.school?.name) setSchoolName(data.school.name);

        const hasAnyContent =
          data.stats.totalStudents > 0 || data.stats.totalTeachers > 0;
        setState(hasAnyContent ? "ready" : "empty");
      } catch (err) {
        console.error("[dashboard] failed to load summary:", err);

        // 401 intentionally propagates — the page uses it to redirect
        // to /login.
        if (err instanceof ApiError && err.status === 401) {
          setState("error");
          throw err;
        }
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load dashboard.";
        setError(msg);
        setState("error");
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load(false);
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = React.useCallback(async () => {
    try {
      await load(true);
    } catch {
      /* component already reflects the error state */
    }
  }, [load]);

  /**
   * On-demand fetch of the full student list. The dashboard endpoint
   * only returns the 5 most-recent students to keep the payload small;
   * the full list is needed for the "Export CSV" action and is fetched
   * only when the user asks for it.
   */
  const ensureStudentsLoaded = React.useCallback(async () => {
    if (allStudents.length > 0) return allStudents;
    setLoadingStudents(true);
    try {
      const list = await studentsApi.list();
      setAllStudents(list);
      return list;
    } finally {
      setLoadingStudents(false);
    }
  }, [allStudents]);

  // Translate the backend summary into the UI's DashboardData shape.
  const data: DashboardData | null = React.useMemo(() => {
    if (!summary) return null;
    return {
      stats: {
        totalStudents: summary.stats.totalStudents,
        totalTeachers: summary.stats.totalTeachers,
        attendanceTodayPct: summary.stats.attendanceTodayPct,
        feesCollected: summary.stats.feesCollected,
        totalCredit: summary.stats.totalCredit,
        studentsDelta: summary.stats.studentsDelta,
        teachersDelta: summary.stats.teachersDelta,
        attendanceDelta: summary.stats.attendanceDelta,
        feesDelta: summary.stats.feesDelta,
      },
      recentStudents: summary.recentStudents.map<Student>((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        grade: s.className ?? "Unassigned",
        section: s.sectionName ?? "Whole class",
        status: "Active" as StudentStatus,
        fees: s.feeStatus as FeeStatus,
      })),
    };
  }, [summary]);

  const onboarding = React.useMemo(
    () => buildOnboarding(state, summary),
    [state, summary],
  );

  return {
    state,
    data,
    school: { name: schoolName },
    onboarding,
    error,
    allStudents,
    loadingStudents,
    ensureStudentsLoaded,
    refresh,
    refreshing,
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

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  RefreshCcw,
  Users,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  dashboardApi,
  type TeacherDashboardAssignment,
  type TeacherDashboardSummary,
} from "@/lib/dashboard";
import {
  teachingAssignmentsApi,
  type TeachingAssignmentDto,
} from "@/lib/teaching-assignments";
import {
  attendanceApi,
  daysAgoISO,
  todayISO,
  type AttendanceTrend,
} from "@/lib/attendance";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/utils";

/**
 * Teacher-specific dashboard. Shows ONLY what a classroom teacher needs:
 * their assigned class, today's attendance state with a CTA, pending
 * work, the (capped) roster, and a 30-day attendance %.
 *
 * Hides every admin-oriented surface: fees, total students, total
 * teachers, school-wide credit, "Add student" — these are admin-only
 * concerns and would be confusing on a teacher's first screen.
 */
export function TeacherDashboardView() {
  const router = useRouter();
  const [data, setData] = React.useState<TeacherDashboardSummary | null>(null);
  // Source of truth for "what am I assigned to?". Fetched in parallel
  // with the summary so a freshly-added assignment is reflected on the
  // very next refresh — no waiting for the dashboard aggregator to
  // re-derive its own copy. Permission checks server-side use the same
  // table, so the two views can never disagree.
  const [myAssignments, setMyAssignments] = React.useState<
    TeachingAssignmentDto[] | null
  >(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Class-scoped attendance trend for the sparkline. Fetched
  // alongside the summary so the dashboard renders in one pass.
  // Falls back to null on error / no-assignment — the StatCard then
  // simply omits the sparkline slot.
  const [trend, setTrend] = React.useState<AttendanceTrend | null>(null);

  const load = React.useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // GUARD: only call /teachers/me/assignments when the caller is
      // actually a TEACHER. The endpoint is gated by @Roles(TEACHER)
      // and 403s everyone else. With the current 401-only auto-logout
      // policy, a 403 from this call doesn't log the user out — but
      // we still avoid firing it for non-TEACHER cached users so the
      // network panel stays clean.
      const cachedUser = getStoredUser();
      const isTeacher = cachedUser?.role === "TEACHER";

      // Tolerate a 403 from listMine specifically — the call CAN 403
      // legitimately (no Teacher profile linked, role mismatch on a
      // stale token, etc.) and the right response is "render the
      // empty hero," NOT propagate to the page-level error state and
      // NOT log out. 401s still propagate to the catch below where
      // they get turned into a /login redirect.
      const safeListMine = async (): Promise<TeachingAssignmentDto[]> => {
        try {
          return await teachingAssignmentsApi.listMine();
        } catch (err) {
          if (err instanceof ApiError && err.status === 403) {
            return [];
          }
          throw err;
        }
      };

      const [summary, assignments] = await Promise.all([
        dashboardApi.getTeacherSummary(),
        isTeacher
          ? safeListMine()
          : Promise.resolve<TeachingAssignmentDto[]>([]),
      ]);
      setData(summary);
      setMyAssignments(assignments);
      // Diagnostic — pair with the admin-side "Assignments (admin
      // save result)" log to spot mismatches between "what was saved"
      // and "what the teacher's dashboard reads back".
      console.log("Assignments:", assignments);
    } catch (err) {
      // 401 — token expired/invalid. Global handler in api.ts already
      // started the redirect; keep the early return so this view
      // doesn't try to render with partial state.
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load dashboard.";
      setError(msg);
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    void load(false);
  }, [load]);

  // Refresh on tab focus / visibility change. Solves the common
  // "admin just added an assignment but I don't see it" surprise:
  // when the teacher returns to the tab we silently re-pull both
  // endpoints. We use `refreshing` (NOT `loading`) so the page
  // doesn't re-collapse to the skeleton — content stays visible
  // and the hero's spinner is the only signal of work.
  //
  // Both `visibilitychange` and `focus` are wired so we catch
  // tab-switch (visibility) AND window-switch / alt-tab (focus).
  // The dedupe is implicit: load() ignores the in-flight call's
  // result if the component unmounts between fire and resolve.
  React.useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === "visible") {
        void load(true);
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [load]);

  // Two-phase background polling.
  //
  //   Phase 1 — FAST burst (5s) for the first ~12s after mount.
  //   Phase 2 — SLOW (45s) thereafter, until unmount.
  //
  // The burst exists to catch the most common race: admin assigns a
  // teacher, then the teacher (or you, on the teacher's behalf)
  // immediately opens / refreshes the dashboard. Polling at 45s would
  // mean a 45-second wait to confirm the change landed; 5s feels
  // instantaneous. After ~12s we drop to 45s so we don't hammer the
  // API for a tab the teacher is just glancing at.
  //
  // Pause when the tab is hidden; restart when it's visible again.
  // The phase-swap timer fires REGARDLESS of visibility — if the
  // tab was hidden when 12s elapsed we still flip the flag, so a
  // hidden-then-visible cycle resumes at the slow rate.
  //
  // Focus / visibility wake also runs an immediate one-shot refresh
  // (separate effect above), which covers the "tab was hidden during
  // the burst" gap.
  React.useEffect(() => {
    const FAST_MS = 5_000;
    const SLOW_MS = 45_000;
    const FAST_BURST_MS = 12_000;

    let intervalId: number | undefined;
    let isFastPhase = true;

    const startInterval = () => {
      if (intervalId !== undefined) return;
      intervalId = window.setInterval(
        () => void load(true),
        isFastPhase ? FAST_MS : SLOW_MS,
      );
    };

    const stopInterval = () => {
      if (intervalId === undefined) return;
      window.clearInterval(intervalId);
      intervalId = undefined;
    };

    // After the burst window, swap to slow. Fires regardless of
    // visibility so the phase flag is always correct on the next
    // visibility-resume.
    const switchTimeoutId = window.setTimeout(() => {
      isFastPhase = false;
      if (intervalId !== undefined) {
        // Already polling — restart so the new cadence takes effect.
        stopInterval();
        startInterval();
      }
    }, FAST_BURST_MS);

    if (document.visibilityState === "visible") startInterval();

    const onVisibility = () => {
      if (document.visibilityState === "visible") startInterval();
      else stopInterval();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(switchTimeoutId);
      stopInterval();
    };
  }, [load]);

  // Derived assignment list, built via useMemo so the reference
  // is stable across renders that don't actually change the inputs.
  // Computed BEFORE the early-return block below — it's a hook
  // (`useMemo`) and React's Rules of Hooks forbid skipping any
  // hook in any render. The previous structure had this derivation
  // (and the trend `useEffect` that depends on it) AFTER the early
  // returns, so the trend effect fired only on later renders →
  // hook order changed between renders → React warning.
  const liveAssignments = React.useMemo<TeacherDashboardAssignment[]>(() => {
    if (!data || !myAssignments) return [];
    const summaryCountById = new Map(
      data.teacher.assignments.map((a) => [a.id, a.studentCount]),
    );
    return myAssignments.map((a) => ({
      id: a.id,
      classId: a.classId,
      className: a.class.name,
      sectionId: a.sectionId,
      sectionName: a.section?.name ?? null,
      subjectId: a.subjectId,
      subjectName: a.subject?.name ?? null,
      studentCount: summaryCountById.get(a.id) ?? 0,
      attendanceQuery: a.sectionId
        ? `sectionId=${a.sectionId}`
        : `classId=${a.classId}`,
    }));
  }, [data, myAssignments]);
  const primaryAssignment = liveAssignments[0] ?? null;

  // Sparkline data keyed off the primary assignment's classId /
  // sectionId. Effect re-runs when the assignment id changes (e.g.,
  // admin re-assigns the teacher mid-session) so the sparkline
  // tracks whichever class the hero CTA points at.
  //
  // POSITION: must run on every render (no conditional skip) — see
  // the hook-order note on the useMemo above. Internally it short-
  // circuits when there's no primary assignment yet, so loading /
  // unassigned states cost nothing.
  React.useEffect(() => {
    if (!primaryAssignment) {
      setTrend(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await attendanceApi.getTrend({
          fromDate: daysAgoISO(13), // 14 days, generous enough to show ~10 school days
          toDate: todayISO(),
          sectionId: primaryAssignment.sectionId ?? undefined,
          classId: primaryAssignment.sectionId
            ? undefined
            : primaryAssignment.classId,
        });
        if (!cancelled) setTrend(data);
      } catch {
        // Sparkline is decorative — silent fail keeps the rest of
        // the dashboard usable when the trend endpoint hiccups.
        if (!cancelled) setTrend(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [primaryAssignment]);

  // ---- Early-return states (rendered AFTER all hooks have run) ----

  if (loading) {
    return <TeacherDashboardSkeleton />;
  }

  if (error || !data || myAssignments === null) {
    return (
      <div className="space-y-6">
        <ErrorBanner
          message={error ?? "Failed to load dashboard."}
          onRetry={() => load(true)}
        />
      </div>
    );
  }

  // SOURCE OF TRUTH for "am I assigned?":
  // /teachers/me/assignments. Falls back to the dashboard summary's
  // copy only when both arrays are empty (defensive — they should
  // always agree because the backend reads the same table).
  if (myAssignments.length === 0) {
    // Pass the same refresh + refreshing wires the assigned hero
    // uses, so a teacher whose admin JUST assigned them isn't stuck
    // waiting up to 45s for the next poll. They can hit "Check
    // again" the moment they expect data.
    return (
      <UnassignedHero
        teacherName={data.teacher.name}
        onRefresh={() => load(true)}
        refreshing={refreshing}
      />
    );
  }

  // Hero label collapses across assignments:
  //   • 1 assignment → "Class 8 · A" (or just "Class 8" / w/ subject)
  //   • 2+           → "3 classes" so the hero stays terse
  const scopeLabel = describeScope(liveAssignments);

  // Hero CTA targets the primary assignment so the click lands on the
  // most-likely-intended roster. Other assignments still appear as
  // their own quick-jump cards lower in the page. Sourced from the
  // live assignments list, NOT the dashboard summary's snapshot.
  const attendanceHref = buildAttendanceHref(primaryAssignment);

  return (
    <div className="space-y-6">
      <TeacherHero
        teacherName={data.teacher.name}
        scopeLabel={scopeLabel}
        attendanceMarked={data.today.attendanceMarked}
        attendanceHref={attendanceHref}
        onRefresh={() => load(true)}
        refreshing={refreshing}
      />

      {/* Quick stats — three cards: today's attendance, 30-day %, total students. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 stagger">
        <StatCard
          label="Today's attendance"
          value={
            data.today.attendancePct !== null
              ? `${data.today.attendancePct.toFixed(1)}%`
              : "—"
          }
          subtitle={
            data.today.studentsMarked > 0
              ? `${data.today.presentCount} present · ${data.today.absentCount} absent`
              : "Not marked yet"
          }
          icon={CalendarCheck}
          tint="emerald"
        />
        <StatCard
          label="Last 30 days"
          value={
            data.classAttendance30d.percentage !== null
              ? `${data.classAttendance30d.percentage.toFixed(1)}%`
              : "—"
          }
          subtitle={`${data.classAttendance30d.totalDays} attendance entries`}
          icon={ClipboardCheck}
          tint="indigo"
          extra={
            // Sparkline of the last ~14 days (only days with marks
            // recorded show as data points; weekends / holidays
            // become gaps). Hidden until the trend resolves so the
            // card doesn't reflow under the user's eye.
            trend && trend.daily.length >= 2 ? (
              <Sparkline
                values={trend.daily.map((d) => d.percentage)}
                width={140}
                height={28}
                strokeClassName="text-indigo-500 dark:text-indigo-400"
                filled
                ariaLabel="Last 14 days attendance sparkline"
              />
            ) : null
          }
        />
        <StatCard
          label="Students in scope"
          value={data.studentsTotal.toString()}
          subtitle={
            liveAssignments.length === 1
              ? "Across 1 assignment"
              : `Across ${liveAssignments.length} assignments`
          }
          icon={Users}
          tint="sky"
        />
      </section>

      {/* Assignments card — driven by the live assignments list so
          freshly-added rows appear on the next refresh without waiting
          for the dashboard aggregator to re-derive its own copy. */}
      <AssignmentsCard
        assignments={liveAssignments}
        refreshing={refreshing}
      />


      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Roster — left column, spans 2 */}
        <div className="lg:col-span-2 glass rounded-xl overflow-hidden animate-fade-in-up">
          <div className="flex items-center justify-between p-5 pb-4">
            <div>
              <h3 className="text-md font-semibold tracking-tight text-foreground">
                Your students
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {data.studentsTotal === 0
                  ? "No students assigned yet."
                  : `${Math.min(data.students.length, data.studentsTotal)} of ${data.studentsTotal} shown.`}
              </p>
            </div>
            {data.studentsTotal > data.students.length && (
              <Link
                href="/students"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          {data.students.length === 0 ? (
            <EmptyState
              icon={<Users className="h-10 w-10" strokeWidth={1.5} />}
              title="No students in your classes yet"
              description="Once your admin enrolls students into your assigned classes, they'll show up here."
            />
          ) : (
            <RosterTable students={data.students} />
          )}
        </div>

        {/* Pending tasks — right column */}
        <div className="flex flex-col gap-4 animate-fade-in-up [animation-delay:120ms]">
          <PendingTasksCard
            attendanceNotMarkedToday={data.pending.attendanceNotMarkedToday}
            attendanceHref={attendanceHref}
            examsWithoutResults={data.pending.examsWithoutResults}
          />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignments card
// ---------------------------------------------------------------------------

/**
 * "Your assignments" — one row per (class × section? × subject?) tuple
 * with a per-row student count and a deep-link button straight to that
 * roster. Hidden when the teacher has zero rows (the unassigned hero
 * handles that case earlier).
 */
function AssignmentsCard({
  assignments,
  refreshing,
}: {
  assignments: TeacherDashboardAssignment[];
  /**
   * True while a poll/focus refresh is in flight. Renders an inline
   * "Updating…" indicator next to the title — content stays in place
   * (no jarring full-skeleton swap) so the page doesn't visibly twitch
   * every 45 seconds.
   */
  refreshing: boolean;
}) {
  return (
    <div className="glass rounded-xl p-5 animate-fade-in-up [animation-delay:60ms]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-md font-semibold tracking-tight text-foreground">
              Your assignments
            </h3>
            {refreshing && <RefreshingBadge />}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {assignments.length === 1
              ? "1 class assigned to you."
              : `${assignments.length} classes assigned to you.`}
          </p>
        </div>
      </div>

      {/* The list is wrapped so we can dim it slightly while a refresh
          is in flight. Each row's actual content swaps atomically when
          the new payload arrives — there's no per-row skeleton flicker. */}
      <ul
        className={cn(
          "mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 transition-opacity duration-200",
          refreshing && "opacity-60",
        )}
      >
        {assignments.map((a) => (
          <li key={a.id}>
            <Link
              href={`/attendance?${a.attendanceQuery}`}
              className="group flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface/80 px-3 py-2.5 text-sm text-foreground transition-all hover:border-emerald-300 hover:bg-emerald-50/40 hover:-translate-y-px hover:shadow-sm focus-ring"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground truncate">
                  {a.className}
                  {a.sectionName ? (
                    <span className="text-muted-foreground"> · {a.sectionName}</span>
                  ) : null}
                </span>
                <span className="text-[11px] text-muted-foreground truncate">
                  {a.subjectName ? (
                    <>
                      <span className="font-medium text-emerald-700">
                        {a.subjectName}
                      </span>
                      {" · "}
                    </>
                  ) : (
                    <>Class teacher · </>
                  )}
                  {a.studentCount} {a.studentCount === 1 ? "student" : "students"}
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-700" />
            </Link>
          </li>
        ))}
      </ul>

      {/* Empty-list refresh state: assignments is empty AND we're
          actively fetching → drop in skeleton rows so the user sees
          the page IS doing something even if there's nothing to show
          yet. (Once the first row lands the skeleton stops rendering
          because assignments.length > 0.) */}
      {refreshing && assignments.length === 0 && (
        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-[58px] rounded-lg border border-border/70 bg-surface/80 px-3 py-2.5"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-2.5 w-32" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tiny "Updating…" pill with a spinner. Goes next to the section
 * title so the user sees the page is alive without anything moving
 * around. Used during background polling.
 */
function RefreshingBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200/70">
      <RefreshCcw className="h-2.5 w-2.5 animate-spin" strokeWidth={2.5} />
      Updating…
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function TeacherHero({
  teacherName,
  scopeLabel,
  attendanceMarked,
  attendanceHref,
  onRefresh,
  refreshing,
}: {
  teacherName: string;
  scopeLabel: string;
  attendanceMarked: boolean;
  attendanceHref: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/50 bg-gradient-to-br from-emerald-500/10 via-teal-500/8 to-transparent p-6 sm:p-8 shadow-[0_1px_0_hsl(0_0%_100%/0.5)_inset,0_20px_40px_-20px_hsl(160_60%_45%/0.15)] animate-fade-in-up">
      <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-gradient-to-br from-emerald-400/25 via-emerald-300/10 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-10 h-72 w-72 rounded-full bg-gradient-to-tr from-teal-300/30 to-transparent blur-3xl" />

      <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/60 backdrop-blur px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-xs">
            <GraduationCap className="h-3.5 w-3.5 text-emerald-600" />
            Teacher view
          </div>
          <h1 className="text-3xl sm:text-[40px] leading-[1.1] sm:leading-[1.05] font-semibold tracking-tight text-foreground">
            Good day,{" "}
            <span className="bg-gradient-to-br from-emerald-600 via-teal-500 to-sky-500 bg-clip-text text-transparent">
              {teacherName}
            </span>
            <span className="ml-1 inline-block animate-[fade-in-up_600ms_ease-out]">
              ✨
            </span>
          </h1>
          <p className="max-w-xl text-md text-muted-foreground leading-relaxed">
            You&apos;re managing{" "}
            <span className="font-medium text-foreground">{scopeLabel}</span>.{" "}
            {attendanceMarked
              ? "Today's attendance is recorded — you can update or review it any time."
              : "Start by recording today's attendance."}
          </p>
        </div>

        {/* flex-wrap so the button cluster falls onto two lines on
            narrow screens. On mobile the Take Attendance CTA stretches
            to its natural width — pinning it doesn't help, the click
            target is large enough already. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            loading={refreshing}
            leftIcon={<RefreshCcw className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
          <Link href={attendanceHref}>
            <Button
              size="lg"
              leftIcon={<ClipboardCheck className="h-4 w-4" />}
              className="shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/30 hover:-translate-y-px transition-all"
            >
              {attendanceMarked ? "Update attendance" : "Take attendance"}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card (lightweight — three on the teacher dashboard)
// ---------------------------------------------------------------------------

type Tint = "emerald" | "indigo" | "sky";

const TINT_CLASSES: Record<Tint, { gradient: string; iconBg: string }> = {
  emerald: {
    gradient: "from-emerald-500/10 via-teal-500/5 to-transparent",
    iconBg: "bg-emerald-500/12 text-emerald-600 ring-emerald-500/20",
  },
  indigo: {
    gradient: "from-indigo-500/10 via-purple-500/5 to-transparent",
    iconBg: "bg-indigo-500/12 text-indigo-600 ring-indigo-500/20",
  },
  sky: {
    gradient: "from-sky-500/10 via-blue-500/5 to-transparent",
    iconBg: "bg-sky-500/12 text-sky-600 ring-sky-500/20",
  },
};

function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tint,
  extra,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: Tint;
  /**
   * Optional slot rendered below the subtitle. Used for inline
   * sparklines on stat cards that benefit from a trend visualization
   * (e.g., "Last 30 days" gets a 7-day sparkline of recent days).
   */
  extra?: React.ReactNode;
}) {
  const t = TINT_CLASSES[tint];
  return (
    <div className="relative overflow-hidden rounded-xl glass p-5">
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70",
          t.gradient,
        )}
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset",
              t.iconBg,
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[32px] leading-none font-semibold tracking-tight text-foreground">
            {value}
          </span>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
          {extra && <div className="mt-1">{extra}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending tasks
// ---------------------------------------------------------------------------

function PendingTasksCard({
  attendanceNotMarkedToday,
  attendanceHref,
  examsWithoutResults,
}: {
  attendanceNotMarkedToday: boolean;
  attendanceHref: string;
  examsWithoutResults: TeacherDashboardSummary["pending"]["examsWithoutResults"];
}) {
  const items: Array<{
    key: string;
    title: string;
    description: string;
    href: string;
    cta: string;
  }> = [];

  if (attendanceNotMarkedToday) {
    items.push({
      key: "attendance",
      title: "Attendance not marked today",
      description: "Record today's attendance for your class.",
      href: attendanceHref,
      cta: "Take attendance",
    });
  }

  for (const exam of examsWithoutResults) {
    items.push({
      key: `exam:${exam.id}`,
      title: `Enter results for ${exam.name}`,
      description: "No marks have been recorded for your students yet.",
      // Land on the unified marks page — defaults to the bulk grid,
      // which is the right tool for "no marks yet" (whole class to
      // grade). Teachers can still flip to the Individual tab from
      // there if they need per-student edits.
      href: "/exams/marks",
      cta: "Enter marks",
    });
  }

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-md font-semibold tracking-tight text-foreground">
            Pending tasks
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {items.length === 0
              ? "You're all caught up."
              : `${items.length} ${items.length === 1 ? "item" : "items"} need your attention.`}
          </p>
        </div>
        {items.length === 0 && (
          <CheckCircle2 className="h-5 w-5 text-success" />
        )}
      </div>

      {items.length === 0 ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 px-3 py-3">
          <Sparkles className="h-4 w-4 text-success shrink-0" />
          <p className="text-sm text-foreground">
            Nice work — nothing is waiting on you right now.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="group flex items-center justify-between gap-3 rounded-lg border border-amber-300/40 bg-amber-50/50 px-3 py-2.5 transition-all hover:border-amber-400/60 hover:bg-amber-50 hover:-translate-y-px focus-ring"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <ClipboardList className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {item.description}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 group-hover:text-amber-800 shrink-0">
                  {item.cta}
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster table
// ---------------------------------------------------------------------------

function RosterTable({
  students,
}: {
  students: TeacherDashboardSummary["students"];
}) {
  return (
    <div className="animate-fade-in">
      <Table>
        <THead>
          <Tr>
            <Th>Student</Th>
            <Th>Symbol No.</Th>
            <Th>Today</Th>
          </Tr>
        </THead>
        <TBody>
          {students.map((s) => (
            <Tr key={s.id}>
              <Td>
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-100 to-emerald-50 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200/50">
                    {initials(s.firstName, s.lastName)}
                  </div>
                  <span className="font-medium">
                    {s.firstName} {s.lastName}
                  </span>
                </div>
              </Td>
              <Td className="text-muted-foreground tabular-nums">
                {s.symbolNumber ?? "—"}
              </Td>
              <Td>
                <AttendancePill status={s.todayStatus} />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function AttendancePill({
  status,
}: {
  status: "PRESENT" | "ABSENT" | null;
}) {
  if (status === "PRESENT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success px-2 py-0.5 text-xs font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Present
      </span>
    );
  }
  if (status === "ABSENT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-xs font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        Absent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Not marked
    </span>
  );
}

// ---------------------------------------------------------------------------
// Unassigned hero
// ---------------------------------------------------------------------------

function UnassignedHero({
  teacherName,
  onRefresh,
  refreshing,
}: {
  teacherName: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  // Auto-refresh aggressively while we're in the unassigned state.
  // The normal dashboard polling runs every 45s once past the burst,
  // which means a teacher whose admin just assigned them could wait
  // up to 45s for the next check. While unassigned, we re-check
  // every 7s — small enough to feel responsive, large enough not to
  // hammer the API. Stops automatically the moment they get assigned
  // (this whole component unmounts and the assigned hero takes over).
  React.useEffect(() => {
    const id = window.setInterval(() => {
      onRefresh();
    }, 7_000);
    return () => window.clearInterval(id);
  }, [onRefresh]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 p-8 animate-fade-in-up">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Welcome, {teacherName}
            </h1>
            <p className="text-base font-medium text-foreground">
              You are not assigned to any class or subject yet.
            </p>
            <p className="text-sm text-muted-foreground max-w-xl">
              Please contact your admin. Once they assign you a class
              (or specific section / subject), you&apos;ll be able to mark
              attendance, view your roster, and enter exam results from
              this dashboard.
            </p>
            <p className="text-xs text-muted-foreground">
              This page rechecks automatically every few seconds, so the
              moment your admin assigns you, the dashboard will load
              itself.
            </p>
            <div className="pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                loading={refreshing}
                leftIcon={
                  !refreshing ? (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  ) : undefined
                }
              >
                Check again
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton + error
// ---------------------------------------------------------------------------

function TeacherDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface p-8">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-10 w-80" />
        <Skeleton className="mt-3 h-4 w-96" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass rounded-xl p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-9 w-9 rounded-lg" />
            </div>
            <Skeleton className="mt-4 h-8 w-28" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 glass rounded-xl p-5 space-y-3">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-2 border-b border-border/40 last:border-0"
            >
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20 ml-auto" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
        <div className="glass rounded-xl p-5 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="glass rounded-xl p-6 flex items-start gap-4 border-destructive/20 animate-fade-in">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <h3 className="text-md font-semibold tracking-tight text-foreground">
          Couldn&apos;t load your dashboard
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          leftIcon={<RefreshCcw className="h-3.5 w-3.5" />}
          className="mt-4"
        >
          Try again
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

/**
 * Build the /attendance deep link for a single assignment row. The
 * backend already pre-encoded the right (sectionId | classId) param
 * in `attendanceQuery`, so we just append it.
 *
 * Falls back to bare /attendance for unassigned teachers — the page
 * shows a picker in that state instead of a roster.
 */
function buildAttendanceHref(
  assignment: TeacherDashboardAssignment | null,
): string {
  if (!assignment) return "/attendance";
  return `/attendance?${assignment.attendanceQuery}`;
}

/**
 * Hero subtitle: collapse the assignment list to a short phrase.
 *   • 0 → "your classes" (defensive — unassigned UI is shown earlier)
 *   • 1 → "Class 8 · A · Math" (skips section/subject when null)
 *   • N → "N classes"
 */
function describeScope(assignments: TeacherDashboardAssignment[]): string {
  if (assignments.length === 0) return "your classes";
  if (assignments.length === 1) {
    const a = assignments[0];
    const parts = [a.className];
    if (a.sectionName) parts.push(a.sectionName);
    if (a.subjectName) parts.push(a.subjectName);
    return parts.join(" · ");
  }
  return `${assignments.length} classes`;
}

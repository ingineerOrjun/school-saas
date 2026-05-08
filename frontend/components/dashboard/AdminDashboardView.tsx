"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Users,
  GraduationCap,
  Wallet,
  CalendarCheck,
  Plus,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  UserPlus,
  RefreshCcw,
  ArrowRight,
  AlertCircle,
  ClipboardCheck,
  BookOpen,
  Receipt,
  Megaphone,
  PiggyBank,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/Table";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { OnboardingChecklist } from "@/components/ui/OnboardingChecklist";
import { AddStudentDialog } from "@/components/students/AddStudentDialog";
import { useDashboardData } from "@/lib/use-dashboard-data";
import { classesApi, type ClassWithSections } from "@/lib/classes";
import type { StudentDto } from "@/lib/students";
import { ApiError } from "@/lib/api";
import { formatCurrencyShort } from "@/lib/currency";
import { getStoredUser, type Role } from "@/lib/auth";
import type {
  DashboardStats,
  FeeStatus,
  Student,
  StudentStatus,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Stat theming
// ---------------------------------------------------------------------------

type StatKey =
  | "totalStudents"
  | "totalTeachers"
  | "attendanceTodayPct"
  | "feesCollected"
  | "totalCredit";
type DeltaKey =
  | "studentsDelta"
  | "teachersDelta"
  | "attendanceDelta"
  | "feesDelta";

type StatConfig = {
  key: StatKey;
  deltaKey: DeltaKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  format: (v: number) => string;
  /** Destination when the user clicks the card. */
  href: string;
  // Themed gradients per metric — soft tints layered over the glass card.
  gradient: string;
  iconBg: string;
  /**
   * When set, the card only renders for users with one of these roles.
   * Used to hide finance-related cards from STAFF (whose href would
   * 403 anyway) and other admin-only links.
   */
  requiresRole?: Role[];
};

// Currency goes through the centralized utility so the dashboard never
// drifts from the rest of the app. Integers + percent formatters stay
// local — they're not currency and have no per-school config.
const integerFmt = new Intl.NumberFormat("en-IN");
const deltaFmt = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

const STAT_CONFIGS: StatConfig[] = [
  {
    key: "totalStudents",
    deltaKey: "studentsDelta",
    label: "Total Students",
    icon: Users,
    format: (v) => integerFmt.format(v),
    href: "/students",
    gradient: "from-indigo-500/10 via-purple-500/5 to-transparent",
    iconBg: "bg-indigo-500/12 text-indigo-600 ring-indigo-500/20",
  },
  {
    key: "totalTeachers",
    deltaKey: "teachersDelta",
    label: "Teachers",
    icon: GraduationCap,
    format: (v) => integerFmt.format(v),
    href: "/teachers",
    gradient: "from-sky-500/10 via-blue-500/5 to-transparent",
    iconBg: "bg-sky-500/12 text-sky-600 ring-sky-500/20",
    // Teachers admin page is admin-only; href would 404/403 for STAFF.
    requiresRole: ["ADMIN"],
  },
  {
    key: "attendanceTodayPct",
    deltaKey: "attendanceDelta",
    label: "Attendance Today",
    icon: CalendarCheck,
    format: (v) => `${v.toFixed(1)}%`,
    href: "/attendance",
    gradient: "from-emerald-500/10 via-teal-500/5 to-transparent",
    iconBg: "bg-emerald-500/12 text-emerald-600 ring-emerald-500/20",
  },
  {
    key: "feesCollected",
    deltaKey: "feesDelta",
    label: "Fees Collected",
    icon: Wallet,
    format: (v) => formatCurrencyShort(v),
    href: "/fees",
    gradient: "from-amber-500/10 via-orange-500/5 to-transparent",
    iconBg: "bg-amber-500/12 text-amber-600 ring-amber-500/20",
    // Finance is admin-only — STAFF can't access /fees.
    requiresRole: ["ADMIN"],
  },
  {
    key: "totalCredit",
    // Re-use feesDelta as a placeholder — deltas aren't computed yet and
    // the StatCard hides the pill for zero deltas regardless.
    deltaKey: "feesDelta",
    label: "General Credit",
    icon: PiggyBank,
    format: (v) => formatCurrencyShort(v),
    href: "/fees",
    gradient: "from-violet-500/10 via-fuchsia-500/5 to-transparent",
    iconBg: "bg-violet-500/12 text-violet-600 ring-violet-500/20",
    requiresRole: ["ADMIN"],
  },
];

interface QuickActionItem {
  label: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * When set, the action only renders for users with one of these
   * roles. Same role-gating mechanism as the stat cards above.
   */
  requiresRole?: Role[];
}

const QUICK_ACTIONS: QuickActionItem[] = [
  {
    label: "Record today's attendance",
    description: "Mark present / absent by section",
    href: "/attendance",
    icon: ClipboardCheck,
  },
  {
    label: "Manage fee payments",
    description: "Record payments and issue receipts",
    href: "/fees",
    icon: Receipt,
    requiresRole: ["ADMIN"],
  },
  {
    // Pair-with-Enter-Marks: creating the exam comes first, so
    // surface it directly in Quick Actions. Admin-only because the
    // backend gates POST /exams on ADMIN + STAFF and we want the
    // dashboard CTA to match (STAFF still gets the sidebar link).
    label: "Create Exam",
    description: "Set up a new exam with subjects and full marks",
    href: "/exams/create",
    icon: BookOpen,
    requiresRole: ["ADMIN"],
  },
  {
    // Promoted to the primary "exams" CTA: bulk grid is the default
    // workflow now, so the dashboard sends admins straight there.
    // The label includes "(Bulk)" so admins immediately understand
    // it's the class-wide path; per-student edits live behind the
    // "Individual" tab on the same page.
    label: "Enter Marks (Bulk)",
    description: "Type a column of marks for an entire class",
    href: "/exams/marks",
    icon: BookOpen,
  },
  {
    // Symmetrical with the entry CTA — admins enter marks on the
    // bulk page and view them on the ledger. The ledger page has
    // its own exam + class pickers, so this is a one-click jump
    // into the read flow.
    label: "View Results",
    description: "Class ledger — every student × every subject",
    href: "/results/ledger",
    icon: BookOpen,
  },
  {
    label: "Invite a teacher",
    description: "Add staff to your workspace",
    href: "/teachers",
    icon: GraduationCap,
    requiresRole: ["ADMIN"],
  },
  {
    label: "Announcements",
    description: "Post a school-wide notice",
    href: "/announcements",
    icon: Megaphone,
  },
];

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/**
 * Admin dashboard — the school-wide overview. Surfaces every metric the
 * principal/owner cares about: students, teachers, attendance, fees,
 * credit, plus onboarding progress and the recent enrollments table.
 *
 * This component used to live in app/(dashboard)/dashboard/page.tsx.
 * It moved here so the page can branch on role and route teachers to a
 * focused view that hides the financial + admin-only surfaces.
 */
export function AdminDashboardView() {
  const router = useRouter();
  const {
    state,
    data,
    school,
    onboarding,
    error,
    ensureStudentsLoaded,
    loadingStudents,
    refresh,
    refreshing,
  } = useDashboardData();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [classes, setClasses] = React.useState<ClassWithSections[]>([]);

  // Setup notices come in via querystring after login. Currently the
  // only one is `setup=missing-class` — sent here when a TEACHER who
  // has no class assigned tries to land on /attendance. Shown on the
  // admin page only when an admin is impersonating-style debugging;
  // teachers see their own dedicated unassigned hero instead.
  const searchParams = useSearchParams();
  const setupNotice = searchParams.get("setup");

  // Cached role drives which stat cards / quick actions render. STAFF
  // shares this dashboard with ADMIN but can't access fees / teachers
  // / users surfaces, so those entries get filtered out.
  const [role, setRole] = React.useState<Role | null>(null);
  React.useEffect(() => {
    setRole(getStoredUser()?.role ?? null);
  }, []);
  const isAdmin = role === "ADMIN";
  // Helper: matches the same shape as the Sidebar's role gate.
  const matchesRole = React.useCallback(
    (item: { requiresRole?: Role[] }) =>
      !item.requiresRole ||
      (role !== null && item.requiresRole.includes(role)),
    [role],
  );
  const visibleStatConfigs = React.useMemo(
    () => STAT_CONFIGS.filter(matchesRole),
    [matchesRole],
  );
  const visibleQuickActions = React.useMemo(
    () => QUICK_ACTIONS.filter(matchesRole),
    [matchesRole],
  );

  // Load classes once for the Add-Student dialog's section dropdown.
  React.useEffect(() => {
    let cancelled = false;
    classesApi
      .list()
      .then((list) => {
        if (!cancelled) setClasses(list);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
        }
        // Otherwise silently fall back — the dialog still works without
        // sections.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const isLoading = state === "loading";
  const isEmpty = state === "empty";
  const isError = state === "error";
  const isReady = state === "ready" && data !== null;

  const handleStudentCreated = React.useCallback(
    (_student: StudentDto) => {
      // Re-pull everything so stats + table + onboarding are in sync.
      refresh();
    },
    [refresh],
  );

  const handleExport = React.useCallback(async () => {
    // `/dashboard/summary` only returns the 5 recent students — fetch
    // the full list lazily here so the dashboard render stays small.
    try {
      const list = await ensureStudentsLoaded();
      if (list.length === 0) {
        toast.info("No students to export yet.");
        return;
      }
      downloadStudentsCsv(list, school.name);
      toast.success(`Exported ${list.length} students to CSV.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Export failed.",
      );
    }
  }, [ensureStudentsLoaded, school.name]);

  const handleOnboardingStep = React.useCallback(
    (id: string) => {
      switch (id) {
        case "student":
          setModalOpen(true);
          break;
        case "teacher":
          router.push("/teachers");
          break;
        case "schedule":
          router.push("/classes");
          break;
        default:
          break;
      }
    },
    [router],
  );

  return (
    <div className="space-y-6">
      {setupNotice === "missing-class" && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-4 flex items-start gap-3 animate-fade-in-up">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              You are not assigned to a class yet
            </p>
            <p className="mt-0.5 text-sm text-amber-800">
              Contact your school admin to assign you a class. Once
              assigned, you&apos;ll be able to mark attendance and enter
              marks for your students.
            </p>
          </div>
        </div>
      )}
      <WelcomeHero
        loading={isLoading}
        schoolName={school.name}
        progress={onboarding.progress}
        completed={onboarding.completed}
        total={onboarding.total}
        onAdd={() => setModalOpen(true)}
        onExport={handleExport}
        exporting={loadingStudents}
        onRefresh={refresh}
        refreshing={refreshing}
        // Add student is admin-only on the backend (POST /students
        // requires @Roles(ADMIN)). Hide for STAFF so the button isn't
        // a 403-in-waiting; STAFF still gets Refresh + Export CSV.
        canAddStudent={isAdmin}
      />

      {/* Error banner — sits above the grid so the user always sees what
          went wrong, but the cards themselves still render (with zeros). */}
      {isError && (
        <ErrorBanner message={error ?? "Something went wrong."} onRetry={refresh} />
      )}

      {/* Stats row — admin sees 5 cards, STAFF sees 3 (fees +
          teachers cards filtered out). On mobile they stack; at sm
          → 2 per row; at lg → up to 5 in a single row. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 stagger">
        {isLoading &&
          Array.from({ length: visibleStatConfigs.length }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        {(isEmpty || isError) &&
          visibleStatConfigs.map((cfg) => (
            <StatCardPlaceholder key={cfg.key} config={cfg} />
          ))}
        {isReady &&
          visibleStatConfigs.map((cfg) => (
            <StatCard key={cfg.key} stats={data!.stats} config={cfg} />
          ))}
      </section>

      {/* Main grid */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 glass rounded-xl overflow-hidden animate-fade-in-up">
          <div className="flex items-center justify-between p-5 pb-4">
            <div>
              <h3 className="text-md font-semibold tracking-tight text-foreground">
                Recent enrollments
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Your {RECENT_LABEL} most-recently added students.
              </p>
            </div>
            {isReady && (
              <Link
                href="/students"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          <div className="px-0 pb-0">
            {isLoading && <TableSkeleton />}
            {isEmpty && (
              <EmptyState
                icon={<UserPlus className="h-10 w-10" strokeWidth={1.5} />}
                title={
                  isAdmin
                    ? "Your school is a clean slate ✨"
                    : "No students enrolled yet"
                }
                description={
                  isAdmin
                    ? "Add your first student to bring this dashboard to life."
                    : "Once your admin enrolls students, this dashboard will fill in."
                }
                // CTA only renders for admin — STAFF can view but not write.
                action={
                  isAdmin
                    ? {
                        label: "Add your first student",
                        icon: <Plus className="h-4 w-4" />,
                        onClick: () => setModalOpen(true),
                      }
                    : undefined
                }
              />
            )}
            {isError && !isLoading && (
              <EmptyState
                icon={<AlertCircle className="h-10 w-10" strokeWidth={1.5} />}
                title="Couldn't load students"
                description={error ?? "Please try again."}
                action={{
                  label: "Retry",
                  icon: <RefreshCcw className="h-4 w-4" />,
                  onClick: refresh,
                }}
              />
            )}
            {isReady && <StudentTable students={data!.recentStudents} />}
          </div>
        </div>

        {/* Right column — onboarding (only while incomplete) +
            quick actions. Once setup is fully complete the checklist
            is just chrome — the admin already knows the system. We
            hide it permanently rather than collapse-with-a-toggle
            because there's nothing to act on; if a step is later
            "un-done" (e.g., last admin demoted) the checklist
            reappears automatically on the next refresh. */}
        <div className="flex flex-col gap-4 animate-fade-in-up [animation-delay:120ms]">
          {isLoading ? (
            <div className="glass rounded-xl p-5 space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-56" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 pt-2">
                  <Skeleton className="h-5 w-5 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ))}
            </div>
          ) : onboarding.completed < onboarding.total ? (
            <OnboardingChecklist
              steps={onboarding.steps}
              completed={onboarding.completed}
              total={onboarding.total}
              progress={onboarding.progress}
              onStepAction={handleOnboardingStep}
            />
          ) : null}

          {(isReady || isEmpty) && (
            <QuickActionsCard items={visibleQuickActions} />
          )}
        </div>
      </section>

      <AddStudentDialog
        open={modalOpen}
        classes={classes}
        onClose={() => setModalOpen(false)}
        onCreated={handleStudentCreated}
      />
    </div>
  );
}

const RECENT_LABEL = "5";

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 animate-fade-in-up">
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        <span className="font-medium">{message}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRetry}
        leftIcon={<RefreshCcw className="h-3.5 w-3.5" />}
      >
        Retry
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome hero
// ---------------------------------------------------------------------------

function WelcomeHero({
  loading,
  schoolName,
  progress,
  completed,
  total,
  onAdd,
  onExport,
  exporting,
  onRefresh,
  refreshing,
  canAddStudent,
}: {
  loading: boolean;
  schoolName: string;
  progress: number;
  completed: number;
  total: number;
  onAdd: () => void;
  onExport: () => void;
  exporting: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  /** False for STAFF — POST /students requires admin. */
  canAddStudent: boolean;
}) {
  const isOnboarding = progress < 100;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/50 bg-gradient-to-br from-indigo-500/8 via-purple-500/6 to-transparent p-6 sm:p-8 shadow-[0_1px_0_hsl(0_0%_100%/0.5)_inset,0_20px_40px_-20px_hsl(238_60%_50%/0.15)] animate-fade-in-up">
      {/* Decorative gradient orbs */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-gradient-to-br from-primary/25 via-primary/10 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-10 h-72 w-72 rounded-full bg-gradient-to-tr from-purple-300/30 to-transparent blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,white_0,transparent_65%)] opacity-50" />

      <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/60 bg-white/60 backdrop-blur px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Workspace live
          </div>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-80" />
              <Skeleton className="h-4 w-96" />
            </div>
          ) : (
            <>
              <h1 className="text-3xl sm:text-[40px] leading-[1.1] sm:leading-[1.05] font-semibold tracking-tight text-foreground">
                Welcome back,{" "}
                <span className="bg-gradient-to-br from-primary-600 via-primary-500 to-purple-500 bg-clip-text text-transparent">
                  {schoolName}
                </span>
                <span className="ml-1 inline-block animate-[fade-in-up_600ms_ease-out]">
                  👋
                </span>
              </h1>
              <p className="max-w-xl text-md text-muted-foreground leading-relaxed">
                {isOnboarding
                  ? `You're ${completed} of ${total} steps into setting up your school. Keep going — you're almost there.`
                  : "Your workspace is fully set up. Here's what's happening across your school today."}
              </p>
            </>
          )}

          {/* Progress bar (only during onboarding) */}
          {!loading && isOnboarding && (
            <div className="max-w-md pt-2">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-foreground">
                  Setup progress
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {progress}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/60 ring-1 ring-inset ring-white/40 backdrop-blur-sm">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary-500 via-primary-500 to-purple-500 transition-[width] duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* flex-wrap so the button cluster falls onto two lines on
            narrow screens instead of overflowing the hero card. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            loading={refreshing}
            leftIcon={<RefreshCcw className="h-3.5 w-3.5" />}
            title="Refresh data"
          >
            Refresh
          </Button>
          <Button
            variant="outline"
            onClick={onExport}
            loading={exporting}
            leftIcon={<Download className="h-4 w-4" />}
          >
            Export CSV
          </Button>
          {canAddStudent && (
            <Button
              size="lg"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={onAdd}
              className="shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-px transition-all"
            >
              Add student
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

function StatCard({
  stats,
  config,
}: {
  stats: DashboardStats;
  config: StatConfig;
}) {
  const Icon = config.icon;
  const value = stats[config.key];
  const delta = stats[config.deltaKey];
  const hasDelta = delta !== 0;
  const trendUp = delta >= 0;
  const TrendIcon = trendUp ? ArrowUpRight : ArrowDownRight;

  return (
    <Link
      href={config.href}
      className={cn(
        "group relative block overflow-hidden rounded-xl glass p-5",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-0.5 hover:shadow-lg focus-ring",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70 transition-opacity duration-300 group-hover:opacity-100",
          config.gradient,
        )}
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{config.label}</span>
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset transition-transform duration-300 group-hover:scale-110",
              config.iconBg,
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </div>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-[32px] leading-none font-semibold tracking-tight text-foreground">
            {config.format(value)}
          </span>
          {hasDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                trendUp
                  ? "bg-success/10 text-success"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              <TrendIcon className="h-3 w-3" />
              {deltaFmt.format(delta)}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Live
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function StatCardSkeleton() {
  return (
    <div className="glass rounded-xl p-5">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
        <div className="flex items-end justify-between">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function StatCardPlaceholder({ config }: { config: StatConfig }) {
  const Icon = config.icon;
  return (
    <Link
      href={config.href}
      className={cn(
        "group relative block overflow-hidden rounded-xl p-5 bg-surface/60 backdrop-blur-md",
        "border-2 border-dashed border-border",
        "transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 focus-ring",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-50",
          config.gradient,
        )}
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            {config.label}
          </span>
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset opacity-80",
              config.iconBg,
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </div>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-[32px] leading-none font-semibold tracking-tight text-muted-foreground/50">
            —
          </span>
          <span className="text-xs text-muted-foreground">No data yet</span>
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Students table
// ---------------------------------------------------------------------------

function StudentTable({ students }: { students: Student[] }) {
  return (
    <div className="animate-fade-in">
      <Table>
        <THead>
          <Tr>
            <Th>Student</Th>
            <Th>Class / Section</Th>
            <Th>Status</Th>
            <Th>Fees</Th>
          </Tr>
        </THead>
        <TBody>
          {students.map((s) => (
            <Tr key={s.id}>
              <Td>
                <Link
                  href={`/students`}
                  className="flex items-center gap-3 hover:text-primary transition-colors"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-100 to-primary-50 text-xs font-semibold text-primary-700 ring-1 ring-inset ring-primary-200/50">
                    {initials(s.firstName, s.lastName)}
                  </div>
                  <span className="font-medium">
                    {s.firstName} {s.lastName}
                  </span>
                </Link>
              </Td>
              <Td className="text-muted-foreground">
                {s.grade} · {s.section}
              </Td>
              <Td>
                <StatusBadge status={s.status} />
              </Td>
              <Td>
                <FeesBadge status={s.fees} />
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="px-5 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 py-3 border-b border-border/40 last:border-0"
        >
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-36 ml-auto" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

function QuickActionsCard({ items }: { items: QuickActionItem[] }) {
  return (
    <div className="glass rounded-xl p-5">
      <h3 className="text-md font-semibold tracking-tight text-foreground">
        Quick actions
      </h3>
      <p className="mt-0.5 text-sm text-muted-foreground">Common workflows</p>
      <div className="mt-4 flex flex-col gap-2">
        {items.map((item) => (
          <QuickAction key={item.label} item={item} />
        ))}
      </div>
    </div>
  );
}

function QuickAction({ item }: { item: QuickActionItem }) {
  const Icon = item.icon;
  const isDisabled = item.href === "#";

  const inner = (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary ring-1 ring-inset ring-primary/15 transition-all group-hover:bg-primary/15">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {item.label}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {item.description}
          </span>
        </span>
      </div>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </>
  );

  const className = cn(
    "group flex items-center justify-between rounded-lg border border-border/70 bg-surface/80 px-3 py-2.5 text-sm text-foreground gap-3",
    "transition-all duration-150",
    isDisabled
      ? "opacity-60 cursor-not-allowed"
      : "hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-px hover:shadow-sm focus-ring",
  );

  if (isDisabled) {
    return (
      <div className={className} aria-disabled>
        {inner}
      </div>
    );
  }

  return (
    <Link href={item.href} className={className}>
      {inner}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: StudentStatus }) {
  const styles: Record<StudentStatus, string> = {
    Active: "bg-success/10 text-success",
    "On Leave": "bg-muted text-muted-foreground",
  };
  const dotStyles: Record<StudentStatus, string> = {
    Active: "bg-success",
    "On Leave": "bg-muted-foreground/60",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        styles[status],
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotStyles[status])} />
      {status}
    </span>
  );
}

function FeesBadge({ status }: { status: FeeStatus }) {
  const styles: Record<FeeStatus, string> = {
    Paid: "bg-success/10 text-success",
    Pending: "bg-amber-500/10 text-amber-700",
    Overdue: "bg-destructive/10 text-destructive",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function initials(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

/**
 * Build a CSV string from students and trigger a download. Uses a
 * BOM + CRLF line endings so Excel on Windows opens the file cleanly
 * without mangling UTF-8 names.
 */
function downloadStudentsCsv(students: StudentDto[], schoolName: string) {
  const headers = [
    "First Name",
    "Last Name",
    "Symbol Number",
    "Class",
    "Section",
    "Created At",
  ];
  const rows = students.map((s) => [
    s.firstName,
    s.lastName,
    s.symbolNumber ?? "",
    s.section?.class?.name ?? "",
    s.section?.name ?? "",
    s.createdAt,
  ]);

  const csv =
    "\uFEFF" +
    [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 10);
  const safeName = schoolName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  a.href = url;
  a.download = `${safeName || "school"}-students-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// (The school-wide attendance trend card that used to live here was
// removed at the user's request — it didn't fit the dashboard's
// rhythm. The chart still renders on /attendance/insights, scoped
// to a class or section, where it has more room to breathe.)

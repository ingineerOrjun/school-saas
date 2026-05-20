"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  BookOpen,
  UserCircle,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  AlertCircle,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { useCalendarMode } from "@/components/calendar/CalendarProvider";
import { formatByMode, type CalendarMode } from "@/lib/date";
import { AttendanceTrendChart } from "@/components/charts/AttendanceTrendChart";
import {
  LowAttendanceBar,
  type LowAttendanceBarItem,
} from "@/components/charts/LowAttendanceBar";
import {
  attendanceApi,
  daysAgoISO,
  todayISO,
  type AttendanceReport,
  type AttendanceTrend,
  type ClassAttendanceReport,
  type SectionAttendanceReport,
  type StudentAttendanceReport,
  type StudentReportRow,
} from "@/lib/attendance";
import { useClasses, type ClassWithSections } from "@/lib/classes";
import { useStudents, type StudentDto } from "@/lib/students";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const LOW_ATTENDANCE_THRESHOLD = 75;

/**
 * Composite scope identifier for the class/section picker. Matches the
 * pattern used on the attendance marking page:
 *   ""               → nothing selected
 *   "section:<uuid>" → specific section
 *   "class:<uuid>"   → whole class (for schools without sections)
 *
 * When `studentId` is also set, studentId trumps — the backend returns
 * a student-scope report regardless of this scope selection.
 */
type ScopeValue = string;

function parseScope(value: ScopeValue): {
  sectionId?: string;
  classId?: string;
} {
  if (value.startsWith("section:")) return { sectionId: value.slice(8) };
  if (value.startsWith("class:")) return { classId: value.slice(6) };
  return {};
}

export default function AttendanceInsightsPage() {
  const router = useRouter();

  // Classes + students via the shared React Query hooks. Both are
  // reference data with a shared cache slot — fast back/forward
  // navigation between this page and other consumers (the picker
  // dialog in /students, the /exams/* pages) is a cache hit.
  const classesQuery = useClasses();
  const studentsQuery = useStudents();
  const classes: ClassWithSections[] = classesQuery.data ?? [];
  const students: StudentDto[] = React.useMemo(
    () => studentsQuery.data ?? [],
    [studentsQuery.data],
  );
  // Combined loading flag — used by the empty-state branches below.
  const loadingMeta = classesQuery.isLoading || studentsQuery.isLoading;

  const [fromDate, setFromDate] = React.useState<string>(daysAgoISO(30));
  const [toDate, setToDate] = React.useState<string>(todayISO());
  const [scope, setScope] = React.useState<ScopeValue>("");
  const [studentId, setStudentId] = React.useState<string>("");

  const [report, setReport] = React.useState<AttendanceReport | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Bridge classesQuery.error into the local error display — the
  // previous useEffect's catch branch funneled the classes failure
  // into `setError(...)`; preserve that behavior at render time.
  React.useEffect(() => {
    if (classesQuery.error) {
      const msg =
        classesQuery.error instanceof ApiError
          ? classesQuery.error.message
          : "Failed to load classes.";
      setError((prev) => prev ?? msg);
    }
  }, [classesQuery.error]);

  // Mirror the same error bridge for the students hook. The original
  // try/catch funneled non-401 errors into `setError(...)`; the React
  // Query retry layer drops 401s without retry so the only error
  // landing here that matters is a real load failure.
  React.useEffect(() => {
    if (!studentsQuery.error) return;
    if (
      studentsQuery.error instanceof ApiError &&
      studentsQuery.error.status === 401
    ) {
      router.replace("/login");
      return;
    }
    const msg =
      studentsQuery.error instanceof ApiError
        ? studentsQuery.error.message
        : "Failed to load students.";
    setError((prev) => prev ?? msg);
  }, [studentsQuery.error, router]);

  // Student picker is now section-independent — lists ALL students. When
  // a scope is selected we narrow the list (section → students of that
  // section; class → students directly assigned to that class). With no
  // scope selected, the picker lists every student in the school.
  const pickableStudents = React.useMemo(() => {
    const parsed = parseScope(scope);
    if (parsed.sectionId) {
      return students.filter((s) => s.sectionId === parsed.sectionId);
    }
    if (parsed.classId) {
      // Whole-class scope covers students directly linked to the class
      // (no section). Match the backend's getClassReport filter so the
      // student picker and the generated report stay in sync.
      return students.filter(
        (s) => s.classId === parsed.classId && s.sectionId === null,
      );
    }
    return students;
  }, [students, scope]);

  // Auto-reset studentId when the scope changes out from under the
  // current selection.
  React.useEffect(() => {
    if (studentId && !pickableStudents.some((s) => s.id === studentId)) {
      setStudentId("");
    }
  }, [pickableStudents, studentId]);

  const fetchReport = React.useCallback(async () => {
    const parsed = parseScope(scope);
    // studentId alone is a valid query — spec says student select is
    // optional. A scope alone is also valid. Fire only when at least
    // one of them is set.
    if (!parsed.sectionId && !parsed.classId && !studentId) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await attendanceApi.getReport({
        fromDate,
        toDate,
        sectionId: parsed.sectionId,
        classId: parsed.classId,
        studentId: studentId || undefined,
      });
      setReport(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      const msg =
        err instanceof ApiError ? err.message : "Failed to load report.";
      setError(msg);
      setReport(null);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, scope, studentId, router]);

  // Auto-fetch on any input change (debounced via effect).
  React.useEffect(() => {
    const t = window.setTimeout(fetchReport, 250);
    return () => window.clearTimeout(t);
  }, [fetchReport]);

  const noClasses = !loadingMeta && classes.length === 0;
  const hasSections = classes.some((c) => c.sections.length > 0);
  const parsedScope = parseScope(scope);
  const hasScope = !!parsedScope.sectionId || !!parsedScope.classId;

  return (
    <div className="space-y-6">
      <Header />

      {/* Filters */}
      <div className="glass rounded-xl p-4 grid grid-cols-1 gap-3 sm:grid-cols-[auto_auto_1fr_1fr_auto] sm:items-end animate-fade-in-up">
        <DateField
          label="From"
          value={fromDate}
          max={toDate}
          onChange={setFromDate}
        />
        <DateField
          label="To"
          value={toDate}
          min={fromDate}
          max={todayISO()}
          onChange={setToDate}
        />
        <SelectField
          label="Class & Section"
          value={scope}
          onChange={setScope}
          icon={<BookOpen className="h-4 w-4 text-muted-foreground" />}
          disabled={loadingMeta || noClasses}
          placeholder={
            noClasses
              ? "No classes"
              : loadingMeta
                ? "Loading…"
                : "All — pick one to see a report"
          }
        >
          {classes.map((klass) => (
            <optgroup key={klass.id} label={klass.name}>
              {/* Whole-class option — essential for classes without
                  sections and useful as a catch-all for students not yet
                  placed into a section. Matches the attendance marking
                  page so the two flows feel consistent. */}
              <option value={`class:${klass.id}`}>
                {klass.sections.length > 0
                  ? `${klass.name} — whole class (no section)`
                  : `${klass.name} — whole class`}
              </option>
              {klass.sections.map((s) => (
                <option key={s.id} value={`section:${s.id}`}>
                  {klass.name} · {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        <SelectField
          label="Student (optional)"
          value={studentId}
          onChange={setStudentId}
          icon={<UserCircle className="h-4 w-4 text-muted-foreground" />}
          disabled={loadingMeta || pickableStudents.length === 0}
          placeholder={
            loadingMeta
              ? "Loading…"
              : pickableStudents.length === 0
                ? "No students"
                : hasScope
                  ? "All students in scope"
                  : "All students"
          }
        >
          {pickableStudents.map((s) => (
            <option key={s.id} value={s.id}>
              {s.firstName} {s.lastName}
            </option>
          ))}
        </SelectField>
        <Button
          variant="outline"
          size="md"
          onClick={fetchReport}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
      </div>

      {noClasses && !loadingMeta ? (
        <div className="glass rounded-xl">
          <EmptyState
            icon={<BookOpen className="h-10 w-10" strokeWidth={1.5} />}
            title="Create a class first"
            description="Attendance reports need classes. Set up your academic structure, then come back."
            action={{
              label: "Go to Classes",
              onClick: () => router.push("/classes"),
            }}
          />
        </div>
      ) : error ? (
        <ErrorBanner message={error} onRetry={fetchReport} />
      ) : loading ? (
        <ReportSkeleton />
      ) : !hasScope && !studentId ? (
        <div className="glass rounded-xl">
          <EmptyState
            icon={<BarChart3 className="h-10 w-10" strokeWidth={1.5} />}
            title="Pick a class, section, or student to see insights"
            description={
              hasSections
                ? "Attendance percentages and per-student trends will appear once you narrow the scope."
                : "You have classes but no sections yet — pick a whole class to see insights."
            }
          />
        </div>
      ) : report ? (
        report.scope === "student" ? (
          <StudentReportView report={report} />
        ) : report.scope === "class" ? (
          <ClassReportView report={report} />
        ) : (
          <SectionReportView report={report} />
        )
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Link
            href="/attendance"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to attendance
          </Link>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Attendance insights
        </h1>
        <p className="text-sm text-muted-foreground">
          Spot patterns, track trends, and flag students who need follow-up.
        </p>
      </div>
    </div>
  );
}

function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-44 rounded-md border border-border bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary transition-colors"
        />
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  icon,
  disabled,
  placeholder,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  icon: React.ReactNode;
  disabled?: boolean;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
          {icon}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
            "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
            "transition-colors",
          )}
        >
          <option value="">{placeholder}</option>
          {children}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student view
// ---------------------------------------------------------------------------

function StudentReportView({ report }: { report: StudentAttendanceReport }) {
  const sectionLabel = report.student.section
    ? `${report.student.section.className} · ${report.student.section.name}`
    : "Unassigned";
  const calendarMode = useCalendarMode();
  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="glass rounded-xl p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Student
        </p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          {report.student.firstName} {report.student.lastName}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {report.student.symbolNumber
            ? `#${report.student.symbolNumber} · `
            : ""}
          {sectionLabel} ·{" "}
          {formatRangeLabel(report.fromDate, report.toDate, calendarMode)}
        </p>
      </div>
      <StatsRow
        percentage={report.percentage}
        presentDays={report.presentDays}
        absentDays={report.absentDays}
        totalDays={report.totalDays}
      />
      {report.totalDays === 0 && <NoDataNote />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section view
// ---------------------------------------------------------------------------

function SectionReportView({ report }: { report: SectionAttendanceReport }) {
  const below = report.lowAttendanceCount;
  const calendarMode = useCalendarMode();
  const trend = useScopeTrend(report.fromDate, report.toDate, {
    sectionId: report.section.id,
  });
  const lowItems = React.useMemo(
    () => toLowAttendanceItems(report.students),
    [report.students],
  );

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="glass rounded-xl p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Section
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {report.section.className} · {report.section.name}
          </h2>
          {below > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {below} below {LOW_ATTENDANCE_THRESHOLD}%
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {formatRangeLabel(report.fromDate, report.toDate, calendarMode)} ·{" "}
          {report.students.length}{" "}
          {report.students.length === 1 ? "student" : "students"}
        </p>
      </div>

      <StatsRow
        percentage={report.percentage}
        presentDays={report.presentDays}
        absentDays={report.absentDays}
        totalDays={report.totalDays}
        lowAttendanceCount={report.lowAttendanceCount}
      />

      {/* Daily trend — surfaces dips and recoveries that the
          aggregate "%" stat alone hides. Skipped silently when
          the trend fetch fails (chart is decorative). */}
      {trend && trend.daily.length > 0 && (
        <div className="glass rounded-xl p-5">
          <AttendanceTrendChart
            data={trend.daily}
            title={`Daily attendance — ${trend.scopeLabel}`}
            height={240}
          />
        </div>
      )}

      {/* Low-attendance leaderboard — sorted ascending so the most
          urgent rows lead. Threshold matches the StatsRow flag
          (75%); items above the bar still appear (capped to 8) for
          context but render in emerald rather than red. */}
      {lowItems.length > 0 && (
        <div className="glass rounded-xl p-5">
          <LowAttendanceBar
            items={lowItems}
            threshold={LOW_ATTENDANCE_THRESHOLD}
            limit={8}
            title="Lowest attendance — top 8"
          />
        </div>
      )}

      {report.students.length === 0 ? (
        <div className="glass rounded-xl">
          <EmptyState
            icon={<UserCircle className="h-10 w-10" strokeWidth={1.5} />}
            title="No students in this section"
            description="Assign students to this section from the Students page, then come back."
          />
        </div>
      ) : (
        <StudentReportTable rows={report.students} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Class view (whole-class, no section)
// ---------------------------------------------------------------------------

function ClassReportView({ report }: { report: ClassAttendanceReport }) {
  const below = report.lowAttendanceCount;
  const calendarMode = useCalendarMode();
  const trend = useScopeTrend(report.fromDate, report.toDate, {
    classId: report.class.id,
  });
  const lowItems = React.useMemo(
    () => toLowAttendanceItems(report.students),
    [report.students],
  );

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="glass rounded-xl p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Whole class
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            {report.class.name}
          </h2>
          {below > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {below} below {LOW_ATTENDANCE_THRESHOLD}%
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {formatRangeLabel(report.fromDate, report.toDate, calendarMode)} ·{" "}
          {report.students.length}{" "}
          {report.students.length === 1 ? "student" : "students"} · no section
        </p>
      </div>

      <StatsRow
        percentage={report.percentage}
        presentDays={report.presentDays}
        absentDays={report.absentDays}
        totalDays={report.totalDays}
        lowAttendanceCount={report.lowAttendanceCount}
      />

      {/* Same chart pair as the section view — see SectionReportView
          for the rationale comments. Class scope here covers
          students linked directly without a section. */}
      {trend && trend.daily.length > 0 && (
        <div className="glass rounded-xl p-5">
          <AttendanceTrendChart
            data={trend.daily}
            title={`Daily attendance — ${trend.scopeLabel}`}
            height={240}
          />
        </div>
      )}
      {lowItems.length > 0 && (
        <div className="glass rounded-xl p-5">
          <LowAttendanceBar
            items={lowItems}
            threshold={LOW_ATTENDANCE_THRESHOLD}
            limit={8}
            title="Lowest attendance — top 8"
          />
        </div>
      )}

      {report.students.length === 0 ? (
        <div className="glass rounded-xl">
          <EmptyState
            icon={<UserCircle className="h-10 w-10" strokeWidth={1.5} />}
            title="No students directly assigned to this class"
            description="Students placed into sections are reported under those sections. Use the Students page to assign students to this class without a section."
          />
        </div>
      ) : (
        <StudentReportTable rows={report.students} />
      )}
    </div>
  );
}

type SortOrder = "worst" | "best";
type RowFilter = "all" | "low";

function StudentReportTable({ rows }: { rows: StudentReportRow[] }) {
  // Default: Worst first — spec's "find at-risk students quickly". Backend
  // already returns rows worst-first, but the client re-sorts to stay
  // authoritative about the current toggle and handle Best flips.
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("worst");
  // Default: All. Switch to "low" to focus on at-risk students.
  const [rowFilter, setRowFilter] = React.useState<RowFilter>("all");

  // Count students below the threshold, derived from the same rule as the
  // filter (`percentage !== null && < 75`). Keeping it local — instead of
  // plumbing the backend's `lowAttendanceCount` down through every parent
  // — guarantees the toggle label and the filtered rows can never
  // disagree, no matter where the rows came from.
  const lowCount = React.useMemo(
    () =>
      rows.filter(
        (r) =>
          r.percentage !== null && r.percentage < LOW_ATTENDANCE_THRESHOLD,
      ).length,
    [rows],
  );

  // Filter first, then sort. Nulls (no-data students) are EXCLUDED from
  // the "Below 75%" view per spec — they represent "unknown", not "bad".
  const filtered = React.useMemo(() => {
    if (rowFilter === "all") return rows;
    return rows.filter(
      (r) => r.percentage !== null && r.percentage < LOW_ATTENDANCE_THRESHOLD,
    );
  }, [rows, rowFilter]);

  // Null percentages always go last regardless of direction — they
  // represent "unknown", not "worst" or "best".
  const sorted = React.useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const pa = a.percentage;
      const pb = b.percentage;
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      return sortOrder === "worst" ? pa - pb : pb - pa;
    });
    return copy;
  }, [filtered, sortOrder]);

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Filter + sort toggles live above the table so they don't fight
          the column headers for attention. Filter on the left, sort on
          the right — reads as "what / how" left-to-right. */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Students
          </p>
          <FilterToggle
            value={rowFilter}
            onChange={setRowFilter}
            lowCount={lowCount}
          />
        </div>
        <SortToggle value={sortOrder} onChange={setSortOrder} />
      </div>

      {sorted.length === 0 ? (
        // Empty-state branch only triggers when the user FILTERED out
        // every row — the parent view already handles "no students
        // assigned" before we ever render this table.
        <div className="px-6 py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
            <TrendingUp className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            No students below threshold
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Everyone is at {LOW_ATTENDANCE_THRESHOLD}% or above. Switch back
            to{" "}
            <button
              type="button"
              onClick={() => setRowFilter("all")}
              className="font-medium text-primary hover:underline"
            >
              All students
            </button>{" "}
            to see the full list.
          </p>
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-muted/30">
              <Th className="rounded-tl-xl">Student</Th>
              <Th className="text-right">Total days</Th>
              <Th className="text-right">Present</Th>
              <Th className="text-right">Absent</Th>
              <Th className="text-right rounded-tr-xl">Attendance</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => {
              const isLast = idx === sorted.length - 1;
              const low =
                r.percentage !== null && r.percentage < LOW_ATTENDANCE_THRESHOLD;
              return (
                <tr
                  key={r.studentId}
                  className={cn(
                    "transition-colors",
                    low ? "hover:bg-destructive/5" : "hover:bg-primary/5",
                  )}
                >
                  <Td
                    className={cn(
                      "border-t border-border/50",
                      isLast && "rounded-bl-xl",
                    )}
                  >
                    <div className="flex flex-col leading-tight">
                      <span className="font-medium text-foreground">
                        {r.firstName} {r.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.symbolNumber ? `#${r.symbolNumber}` : "—"}
                      </span>
                    </div>
                  </Td>
                  <Td className="border-t border-border/50 text-right tabular-nums text-muted-foreground">
                    {r.totalDays}
                  </Td>
                  <Td className="border-t border-border/50 text-right tabular-nums text-success">
                    {r.presentDays}
                  </Td>
                  <Td className="border-t border-border/50 text-right tabular-nums text-muted-foreground">
                    {r.absentDays}
                  </Td>
                  <Td
                    className={cn(
                      "border-t border-border/50 text-right",
                      isLast && "rounded-br-xl",
                    )}
                  >
                    <AttendanceBar
                      percentage={r.percentage}
                      lowThreshold={LOW_ATTENDANCE_THRESHOLD}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function FilterToggle({
  value,
  onChange,
  lowCount,
}: {
  value: RowFilter;
  onChange: (next: RowFilter) => void;
  /** Count of students below the threshold — surfaced in the label so
      users see what the filter would do before clicking. */
  lowCount: number;
}) {
  return (
    <div
      role="group"
      aria-label="Filter students"
      className="inline-flex items-stretch overflow-hidden rounded-md border border-border bg-surface/60 text-xs font-semibold"
    >
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        className={cn(
          "px-2.5 py-1 transition-colors",
          value === "all"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        All
      </button>
      <span aria-hidden className="w-px bg-border" />
      <button
        type="button"
        aria-pressed={value === "low"}
        // Disable when there's nothing to filter to — clicking would
        // immediately drop into the "no students below threshold" empty
        // state, which is correct behavior but a wasted click.
        disabled={lowCount === 0}
        onClick={() => onChange("low")}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 transition-colors",
          value === "low"
            ? "bg-destructive text-destructive-foreground"
            : "text-muted-foreground hover:bg-muted",
          lowCount === 0 && "opacity-50 cursor-not-allowed hover:bg-transparent",
        )}
      >
        <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
        Below {LOW_ATTENDANCE_THRESHOLD}% ({lowCount})
      </button>
    </div>
  );
}

function SortToggle({
  value,
  onChange,
}: {
  value: SortOrder;
  onChange: (next: SortOrder) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Sort by attendance"
      className="inline-flex items-stretch overflow-hidden rounded-md border border-border bg-surface/60 text-xs font-semibold"
    >
      <button
        type="button"
        aria-pressed={value === "worst"}
        onClick={() => onChange("worst")}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 transition-colors",
          value === "worst"
            ? "bg-destructive text-destructive-foreground"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <TrendingDown className="h-3 w-3" />
        Worst
      </button>
      <span aria-hidden className="w-px bg-border" />
      <button
        type="button"
        aria-pressed={value === "best"}
        onClick={() => onChange("best")}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 transition-colors",
          value === "best"
            ? "bg-success text-white"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <TrendingUp className="h-3 w-3" />
        Best
      </button>
    </div>
  );
}

function AttendanceBar({
  percentage,
  lowThreshold,
}: {
  percentage: number | null;
  lowThreshold: number;
}) {
  if (percentage === null) {
    return (
      <span className="text-xs italic text-muted-foreground">No data</span>
    );
  }
  const low = percentage < lowThreshold;
  return (
    <div className="inline-flex items-center gap-2 w-36 justify-end">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            low
              ? "bg-gradient-to-r from-destructive to-red-400"
              : "bg-gradient-to-r from-success to-emerald-400",
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span
        className={cn(
          "tabular-nums text-sm font-semibold",
          low ? "text-destructive" : "text-foreground",
        )}
      >
        {percentage.toFixed(1)}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** totalDays below this threshold triggers the "Limited data" hint. */
const LIMITED_DATA_THRESHOLD = 5;

function StatsRow({
  percentage,
  presentDays,
  absentDays,
  totalDays,
  lowAttendanceCount,
}: {
  percentage: number | null;
  presentDays: number;
  absentDays: number;
  totalDays: number;
  /** Optional — not present on student-scope reports. */
  lowAttendanceCount?: number;
}) {
  const tone = pctTone(percentage);
  const limitedData = totalDays < LIMITED_DATA_THRESHOLD;
  // Days context lives under the percentage so the reader sees the
  // sample size right next to the headline number — no need to look at
  // the Total days card to know whether to trust it.
  const daysCaption =
    totalDays > 0
      ? `Based on ${totalDays} day${totalDays === 1 ? "" : "s"}`
      : "No attendance recorded yet";
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <StatCard
        label="Attendance rate"
        value={percentage !== null ? `${percentage.toFixed(1)}%` : "—"}
        tone={tone}
        icon={
          tone === "danger" ? (
            <TrendingDown className="h-5 w-5" />
          ) : (
            <TrendingUp className="h-5 w-5" />
          )
        }
        caption={daysCaption}
        captionHint={
          limitedData
            ? {
                label: "Limited data",
                title:
                  "Fewer than 5 attendance days in this range — percentages may not reflect a real pattern.",
              }
            : undefined
        }
        badge={
          lowAttendanceCount && lowAttendanceCount > 0
            ? {
                label: `${lowAttendanceCount} student${lowAttendanceCount === 1 ? "" : "s"} below 75%`,
                tone: "danger",
              }
            : undefined
        }
      />
      <StatCard
        label="Present days"
        value={presentDays.toString()}
        tone="success"
      />
      <StatCard
        label="Absent days"
        value={absentDays.toString()}
        tone={absentDays > 0 ? "danger" : "muted"}
      />
      <StatCard
        label="Total days"
        value={totalDays.toString()}
        tone="muted"
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
  badge,
  caption,
  captionHint,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "muted" | "neutral";
  icon?: React.ReactNode;
  /** Optional pill rendered under the value — used for the <75% flag. */
  badge?: {
    label: string;
    tone: "danger" | "muted";
    title?: string;
  };
  /** Subtle line under the value — e.g. "Based on 12 days". */
  caption?: string;
  /** Inline subtle hint appended to the caption — e.g. "Limited data". */
  captionHint?: { label: string; title?: string };
}) {
  const bg =
    tone === "success"
      ? "bg-success/10 text-success"
      : tone === "danger"
        ? "bg-destructive/10 text-destructive"
        : tone === "muted"
          ? "bg-muted text-muted-foreground"
          : "bg-primary/10 text-primary";
  return (
    <div
      className={cn(
        "glass rounded-xl p-5 transition-shadow hover:shadow-sm",
        tone === "danger" && "border-destructive/30 bg-destructive/[0.04]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {icon && (
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md",
              bg,
            )}
          >
            {icon}
          </div>
        )}
      </div>
      <p
        className={cn(
          "mt-3 text-3xl font-semibold tracking-tight tabular-nums",
          tone === "danger" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      {caption && (
        <p className="mt-1 text-xs text-muted-foreground">
          {caption}
          {captionHint && (
            <>
              {" · "}
              <span
                title={captionHint.title}
                className="italic text-muted-foreground/70"
              >
                {captionHint.label}
              </span>
            </>
          )}
        </p>
      )}
      {badge && (
        <span
          title={badge.title}
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            badge.tone === "danger"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          {badge.tone === "danger" && (
            <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
          )}
          {badge.label}
        </span>
      )}
    </div>
  );
}

function pctTone(pct: number | null): "success" | "danger" | "muted" | "neutral" {
  if (pct === null) return "muted";
  if (pct < LOW_ATTENDANCE_THRESHOLD) return "danger";
  if (pct >= 90) return "success";
  return "neutral";
}

function NoDataNote() {
  return (
    <div className="glass rounded-xl p-4 flex items-start gap-3 border-muted-foreground/10">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <BarChart3 className="h-4 w-4" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          No attendance recorded in this range
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Widen the date range or start marking attendance for this student.
        </p>
      </div>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass rounded-xl p-5 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="glass rounded-xl p-4 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
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
    <div className="glass rounded-xl p-6 flex items-start gap-4 border-destructive/20">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <h3 className="text-md font-semibold tracking-tight text-foreground">
          Couldn&apos;t load the report
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
          className="mt-4"
        >
          Try again
        </Button>
      </div>
    </div>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      className={cn(
        "h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>
  );
}

/**
 * Range label like "2081-04-17 — 2081-05-15", routed through
 * `formatByMode` so the user's calendar preference is honored.
 *
 * Tradeoff vs. the previous Western-only "Aug 1 — Aug 30" rendering:
 * we lose the year-omission shorthand (formatByMode always returns
 * full YYYY-MM-DD), but we gain consistency with every other date
 * surface in the app — and the spec mandates "ALWAYS use displayDate,
 * NEVER use toLocaleDateString."
 */
function formatRangeLabel(
  from: string,
  to: string,
  mode: CalendarMode,
): string {
  return `${formatByMode(from, mode)} — ${formatByMode(to, mode)}`;
}

/**
 * Fetch the attendance trend for a (scope × date range). Used by the
 * Class / Section views to render the line chart above the existing
 * stats. Returns null until the request resolves so callers can skip
 * the chart while loading.
 */
function useScopeTrend(
  fromDate: string,
  toDate: string,
  scope: { sectionId?: string; classId?: string },
): AttendanceTrend | null {
  const [trend, setTrend] = React.useState<AttendanceTrend | null>(null);

  // Stable scope key so the effect re-fires only when the scope
  // identity actually changes (not on every render).
  const scopeKey = `${scope.sectionId ?? ""}|${scope.classId ?? ""}`;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await attendanceApi.getTrend({
          fromDate,
          toDate,
          sectionId: scope.sectionId,
          classId: scope.sectionId ? undefined : scope.classId,
        });
        if (!cancelled) setTrend(data);
      } catch {
        // Insights charts are decorative — silent fail keeps the
        // rest of the page usable.
        if (!cancelled) setTrend(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, scopeKey]);

  return trend;
}

/**
 * Map StudentReportRow[] → LowAttendanceBarItem[] for the chart.
 * Filters out rows with no recorded data (percentage === null) since
 * the bar chart needs a numeric value to plot.
 */
function toLowAttendanceItems(
  rows: StudentReportRow[],
): LowAttendanceBarItem[] {
  return rows
    .filter((r) => r.percentage !== null)
    .map((r) => ({
      studentId: r.studentId,
      name: `${r.firstName} ${r.lastName}`,
      percentage: r.percentage!,
      symbolNumber: r.symbolNumber,
    }));
}

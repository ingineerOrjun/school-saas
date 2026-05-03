"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CalendarCheck,
  Check,
  CheckCircle2,
  X,
  Users,
  CalendarDays,
  BookOpen,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { classesApi, type ClassWithSections } from "@/lib/classes";
import {
  teachingAssignmentsApi,
  type TeachingAssignmentDto,
} from "@/lib/teaching-assignments";
import {
  attendanceApi,
  todayISO,
  type AttendanceRoster,
  type AttendanceStatus,
} from "@/lib/attendance";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { DualDate } from "@/components/calendar/DualDate";

/**
 * Composite scope identifier for the roster dropdown. Encoded as a
 * single string so we can keep a single `<select>` driving both "pick a
 * section" and "pick a whole class". Formats:
 *   - ""               → nothing selected
 *   - "section:<uuid>" → specific section
 *   - "class:<uuid>"   → whole class (no sections)
 */
type ScopeValue = string;

function parseScope(value: ScopeValue): {
  sectionId?: string;
  classId?: string;
} {
  if (value.startsWith("section:")) {
    return { sectionId: value.slice("section:".length) };
  }
  if (value.startsWith("class:")) {
    return { classId: value.slice("class:".length) };
  }
  return {};
}

/**
 * Restrict the catalog to the classes/sections a TEACHER is assigned to.
 *
 * Rules per assignment:
 *   • sectionId set  → only that section appears (under its parent class)
 *   • sectionId null → the whole class appears, with EVERY section under it
 *
 * The union across all assignments is what's shown. ADMINs pass
 * `assignments = null` to get the unfiltered catalog.
 *
 * Implementation note: we re-shape the original `ClassWithSections`
 * objects rather than mutating them, so React refs stay stable for the
 * unaffected branches.
 */
function filterClassesByAssignments(
  classes: ClassWithSections[],
  assignments: TeachingAssignmentDto[] | null,
): ClassWithSections[] {
  if (assignments === null) return classes;
  if (assignments.length === 0) return [];

  // Per-class allow-set: which sections (or "whole class") are allowed.
  // `whole === true` means class-bound assignment → show every section.
  const byClass = new Map<string, { whole: boolean; sectionIds: Set<string> }>();
  for (const a of assignments) {
    const entry =
      byClass.get(a.classId) ?? { whole: false, sectionIds: new Set<string>() };
    if (a.sectionId) {
      entry.sectionIds.add(a.sectionId);
    } else {
      // Class-bound assignment: implicitly grants every section under it.
      entry.whole = true;
    }
    byClass.set(a.classId, entry);
  }

  return classes
    .filter((c) => byClass.has(c.id))
    .map((c) => {
      const allow = byClass.get(c.id)!;
      const sections = allow.whole
        ? c.sections
        : c.sections.filter((s) => allow.sectionIds.has(s.id));
      return { ...c, sections };
    });
}

/**
 * Read `?sectionId=...` or `?classId=...` from the URL once and convert
 * to the encoded ScopeValue used by the picker. Used to seed the scope
 * when the page is reached via a deep link (e.g. from the teacher
 * dashboard "Take attendance" button). Empty string when neither param
 * is present, which leaves the picker in its default empty state.
 */
function useInitialScopeFromQuery(): ScopeValue {
  const params = useSearchParams();
  // We only ever read this on first render — after that the picker is
  // authoritative, so it's fine to ignore subsequent param changes.
  const initial = React.useRef<ScopeValue | null>(null);
  if (initial.current === null) {
    const sectionId = params.get("sectionId");
    const classId = params.get("classId");
    initial.current = sectionId
      ? `section:${sectionId}`
      : classId
        ? `class:${classId}`
        : "";
  }
  return initial.current;
}

export default function AttendancePage() {
  const router = useRouter();
  // Pre-fill scope from URL on mount so deep links from the teacher
  // dashboard ("Take attendance") land directly on the right roster
  // instead of an empty picker. We read once at init, not on every
  // render — afterwards the picker is the source of truth.
  const initialScope = useInitialScopeFromQuery();
  const [date, setDate] = React.useState<string>(todayISO());
  const [classes, setClasses] = React.useState<ClassWithSections[]>([]);
  // For TEACHER users we filter the picker to only their assigned
  // classes/sections — they can't act outside their scope anyway, and
  // showing the full catalog would just waste their time. ADMIN keeps
  // the full list (`null` = "no filter applied").
  const [assignments, setAssignments] = React.useState<
    TeachingAssignmentDto[] | null
  >(null);
  const [scope, setScope] = React.useState<ScopeValue>(initialScope);
  const [roster, setRoster] = React.useState<AttendanceRoster[] | null>(null);
  const [loadingClasses, setLoadingClasses] = React.useState(true);
  const [loadingRoster, setLoadingRoster] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savingIds, setSavingIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // Load classes — and, for TEACHER users, their assignments — in
  // parallel. The dropdown blends them downstream so a teacher only
  // sees classes/sections they're authorized for.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const role = getStoredUser()?.role ?? null;
      try {
        const [classList, myAssignments] = await Promise.all([
          classesApi.list(),
          role === "TEACHER"
            ? teachingAssignmentsApi.listMine().catch((err) => {
                // 403 here means "not a teacher row yet" — treat as
                // "no assignments" so the dropdown collapses to empty
                // rather than blocking the page entirely.
                if (err instanceof ApiError && err.status === 403) {
                  return [];
                }
                throw err;
              })
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setClasses(classList);
        setAssignments(myAssignments);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        const msg =
          err instanceof ApiError ? err.message : "Failed to load classes.";
        setError(msg);
      } finally {
        if (!cancelled) setLoadingClasses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Fetch the roster whenever date or scope changes. Scope is either a
  // section or a whole class (for schools that don't use sections).
  React.useEffect(() => {
    const parsed = parseScope(scope);
    if (!parsed.sectionId && !parsed.classId) {
      setRoster(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingRoster(true);
      setError(null);
      try {
        const data = await attendanceApi.getRoster(date, parsed);
        if (!cancelled) setRoster(data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        const msg =
          err instanceof ApiError ? err.message : "Failed to load roster.";
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, scope, router]);

  const stats = React.useMemo(() => {
    if (!roster) return { present: 0, absent: 0, unmarked: 0, total: 0 };
    let present = 0,
      absent = 0,
      unmarked = 0;
    for (const r of roster) {
      if (r.status === "PRESENT") present++;
      else if (r.status === "ABSENT") absent++;
      else unmarked++;
    }
    return { present, absent, unmarked, total: roster.length };
  }, [roster]);

  const saveOne = async (studentId: string, status: AttendanceStatus) => {
    const prev = roster;
    setRoster(
      (r) =>
        r?.map((s) => (s.studentId === studentId ? { ...s, status } : s)) ?? r,
    );
    setSavingIds((s) => new Set(s).add(studentId));
    try {
      await attendanceApi.mark({ date, entries: [{ studentId, status }] });
    } catch (err) {
      setRoster(prev);
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Failed to save attendance. Reverted.",
      );
    } finally {
      setSavingIds((s) => {
        if (!s.has(studentId)) return s;
        const n = new Set(s);
        n.delete(studentId);
        return n;
      });
    }
  };

  const markAll = async (status: AttendanceStatus) => {
    if (!roster || roster.length === 0) return;
    const prev = roster;
    setRoster(roster.map((r) => ({ ...r, status })));
    const allIds = new Set(roster.map((r) => r.studentId));
    setSavingIds(allIds);
    try {
      await attendanceApi.mark({
        date,
        entries: roster.map((r) => ({ studentId: r.studentId, status })),
      });
      toast.success(
        status === "PRESENT"
          ? `Marked all ${roster.length} present`
          : `Marked all ${roster.length} absent`,
      );
    } catch (err) {
      setRoster(prev);
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Bulk save failed. Roster reverted.",
      );
    } finally {
      setSavingIds(new Set());
    }
  };

  // Restrict the dropdown to assignments when the caller is a TEACHER.
  // ADMIN users (assignments === null) see the full catalog unchanged.
  const visibleClasses = React.useMemo(
    () => filterClassesByAssignments(classes, assignments),
    [classes, assignments],
  );

  const noClasses = !loadingClasses && visibleClasses.length === 0;
  const hasSections = visibleClasses.some((c) => c.sections.length > 0);
  const scopeSelected = scope !== "";

  return (
    <div className="space-y-6">
      <Header />

      {/* Controls */}
      <div className="glass rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-end animate-fade-in-up">
        <div className="flex flex-col gap-1.5 sm:w-56">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Date
          </label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
              className={cn(
                "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
                "transition-colors",
              )}
            />
          </div>
          {/* Show the picked date in the user's preferred calendar
              under the input. The native picker is locked to A.D., so
              this is how Nepali admins see the BS equivalent without
              us writing a custom calendar widget. */}
          <p className="text-[11px] text-muted-foreground">
            <DualDate date={date} />
          </p>
        </div>

        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Class &amp; Section
          </label>
          <div className="relative">
            <BookOpen className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={loadingClasses || noClasses}
              className={cn(
                "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
                "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
                "transition-colors",
              )}
            >
              <option value="">
                {noClasses
                  ? "No classes yet"
                  : loadingClasses
                    ? "Loading classes…"
                    : "Choose a class or section…"}
              </option>
              {visibleClasses.map((klass) => (
                <optgroup key={klass.id} label={klass.name}>
                  {/* Whole-class option — essential for schools without
                      sections. Also available when sections exist, and it
                      returns the students who haven't been placed into
                      any section yet. */}
                  <option value={`class:${klass.id}`}>
                    {klass.sections.length > 0
                      ? `${klass.name} — whole class (no section)`
                      : `${klass.name} — whole class`}
                  </option>
                  {klass.sections.map((section) => (
                    <option key={section.id} value={`section:${section.id}`}>
                      {klass.name} · Section {section.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {scopeSelected && roster && roster.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => markAll("PRESENT")}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Mark all present
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => markAll("ABSENT")}
              leftIcon={<X className="h-4 w-4" />}
            >
              Mark all absent
            </Button>
          </div>
        )}
      </div>

      {/* No classes yet — prompt to create one */}
      {noClasses && (
        <div className="glass rounded-xl animate-fade-in-up">
          <EmptyState
            icon={<BookOpen className="h-10 w-10" strokeWidth={1.5} />}
            title="Create a class first"
            description="Attendance needs a class with sections. Set up your academic structure, then come back here."
            action={{
              label: "Go to Classes",
              icon: <Sparkles className="h-4 w-4" />,
              onClick: () => router.push("/classes"),
            }}
          />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="glass rounded-xl p-5 flex items-start gap-3 border-destructive/20 animate-fade-in">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-md font-semibold tracking-tight text-foreground">
              Something went wrong
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {/* Roster states */}
      {!scopeSelected && !noClasses && !error && (
        <div className="glass rounded-xl animate-fade-in-up">
          <EmptyState
            icon={<CalendarCheck className="h-10 w-10" strokeWidth={1.5} />}
            title="Pick a class or section to start"
            description={
              hasSections
                ? "Attendance rows will appear here — tap Present or Absent on each student. Classes without sections can be marked as a whole."
                : "Your classes don't have sections — pick a class to mark attendance for the whole class."
            }
          />
        </div>
      )}

      {scopeSelected && (
        <>
          {loadingRoster ? (
            <RosterSkeleton />
          ) : roster && roster.length === 0 ? (
            <div className="glass rounded-xl animate-fade-in-up">
              <EmptyState
                icon={<Users className="h-10 w-10" strokeWidth={1.5} />}
                title={
                  parseScope(scope).classId
                    ? "No students in this class yet"
                    : "No students in this section"
                }
                description={
                  parseScope(scope).classId
                    ? "Assign students to this class from the Students page, then come back to mark their attendance."
                    : "Assign students to this section from the Students page, then come back to mark their attendance."
                }
                action={{
                  label: "Go to Students",
                  onClick: () => router.push("/students"),
                }}
              />
            </div>
          ) : roster && roster.length > 0 ? (
            <div className="space-y-4 animate-fade-in-up">
              <StatsBar
                present={stats.present}
                absent={stats.absent}
                unmarked={stats.unmarked}
                total={stats.total}
              />
              <ul className="space-y-2" role="list">
                {roster.map((r) => (
                  <AttendanceRow
                    key={r.studentId}
                    row={r}
                    saving={savingIds.has(r.studentId)}
                    onMark={(status) => saveOne(r.studentId, status)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Attendance
        </h1>
        <p className="text-sm text-muted-foreground">
          Tap Present or Absent on each student — changes save as you go.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Link
          href="/attendance/insights"
          className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
        >
          Insights →
        </Link>
        <Link
          href="/classes"
          className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
        >
          Manage classes →
        </Link>
      </div>
    </div>
  );
}

function StatsBar({
  present,
  absent,
  unmarked,
  total,
}: {
  present: number;
  absent: number;
  unmarked: number;
  total: number;
}) {
  const marked = present + absent;
  const progressPct = total === 0 ? 0 : (marked / total) * 100;
  const isComplete = total > 0 && unmarked === 0;

  return (
    <div
      className={cn(
        "glass rounded-xl p-4",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        "transition-colors duration-500 ease-out",
        isComplete && "border-success/40 bg-success/[0.04]",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatPill tone="success" count={present} label="Present" />
        <StatPill tone="destructive" count={absent} label="Absent" />
        <StatPill tone="muted" count={unmarked} label="Unmarked" />
        {isComplete && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success animate-fade-in-up">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
            Attendance complete
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs tabular-nums">
            <span className="font-semibold text-foreground">{marked}</span>
            <span className="text-muted-foreground"> of {total} marked</span>
          </span>
          <div className="h-2 w-44 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                isComplete
                  ? "bg-gradient-to-r from-success to-emerald-400"
                  : "bg-gradient-to-r from-primary to-purple-500",
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatPill({
  tone,
  count,
  label,
}: {
  tone: "success" | "destructive" | "muted";
  count: number;
  label: string;
}) {
  const tones = {
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tones[tone],
      )}
    >
      <span className="tabular-nums font-semibold">{count}</span>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------

function AttendanceRow({
  row,
  saving,
  onMark,
}: {
  row: AttendanceRoster;
  saving: boolean;
  onMark: (status: AttendanceStatus) => void;
}) {
  const isPresent = row.status === "PRESENT";
  const isAbsent = row.status === "ABSENT";

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl p-3 sm:p-4",
        "border transition-colors duration-200 ease-out",
        isPresent && "bg-success/10 border-success/30",
        isAbsent && "bg-destructive/10 border-destructive/30",
        !isPresent && !isAbsent && "glass border-border/60",
        saving && "opacity-80",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar
          firstName={row.firstName}
          lastName={row.lastName}
          id={row.studentId}
          tone={isPresent ? "success" : isAbsent ? "destructive" : "neutral"}
        />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="font-medium text-foreground truncate">
            {row.firstName} {row.lastName}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            #{row.studentId.slice(0, 8)}
          </span>
        </div>
      </div>

      <MarkButtons
        status={row.status}
        saving={saving}
        onMark={(status) => {
          // No-op if clicking the already-active button so we don't
          // trigger a redundant network write.
          if (status === row.status) return;
          onMark(status);
        }}
      />
    </li>
  );
}

function MarkButtons({
  status,
  saving,
  onMark,
}: {
  status: AttendanceStatus | null;
  saving: boolean;
  onMark: (status: AttendanceStatus) => void;
}) {
  const isPresent = status === "PRESENT";
  const isAbsent = status === "ABSENT";

  return (
    <div
      className="inline-flex shrink-0 items-stretch overflow-hidden rounded-lg border border-border bg-surface/60 backdrop-blur-md text-xs font-semibold"
      role="group"
      aria-label="Mark attendance"
    >
      <button
        type="button"
        aria-pressed={isPresent}
        disabled={saving}
        onClick={() => onMark("PRESENT")}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 transition-all duration-150",
          "focus:outline-none focus:ring-2 focus:ring-success/30 focus:z-10",
          "active:scale-[0.97]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          isPresent
            ? "bg-success text-white shadow-inner"
            : "text-success hover:bg-success/10",
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        Present
      </button>
      <span
        aria-hidden
        className={cn(
          "w-px bg-border",
          (isPresent || isAbsent) && "bg-transparent",
        )}
      />
      <button
        type="button"
        aria-pressed={isAbsent}
        disabled={saving}
        onClick={() => onMark("ABSENT")}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 transition-all duration-150",
          "focus:outline-none focus:ring-2 focus:ring-destructive/30 focus:z-10",
          "active:scale-[0.97]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          isAbsent
            ? "bg-destructive text-white shadow-inner"
            : "text-destructive hover:bg-destructive/10",
        )}
      >
        <X className="h-3.5 w-3.5" strokeWidth={3} />
        Absent
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RosterSkeleton() {
  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="glass rounded-xl p-4 flex items-center justify-between">
        <div className="flex gap-3">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="h-2 w-40 rounded-full" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="glass rounded-xl p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

const AVATAR_PALETTES = [
  "from-indigo-400 to-purple-400",
  "from-sky-400 to-blue-400",
  "from-amber-400 to-orange-400",
  "from-pink-400 to-rose-400",
  "from-violet-400 to-fuchsia-400",
  "from-teal-400 to-cyan-400",
];

function paletteFor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_PALETTES[sum % AVATAR_PALETTES.length];
}

function Avatar({
  firstName,
  lastName,
  id,
  tone,
}: {
  firstName: string;
  lastName: string;
  id: string;
  tone: "neutral" | "success" | "destructive";
}) {
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  if (tone === "success") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-xs font-semibold text-success-foreground shadow-sm ring-1 ring-inset ring-white/20">
        {initials}
      </div>
    );
  }
  if (tone === "destructive") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive text-xs font-semibold text-destructive-foreground shadow-sm ring-1 ring-inset ring-white/20">
        {initials}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-1 ring-inset ring-white/20",
        `bg-gradient-to-br ${paletteFor(id)}`,
      )}
    >
      {initials}
    </div>
  );
}

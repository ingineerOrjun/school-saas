"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  GraduationCap,
  Layers,
  PencilLine,
  Save,
  Search,
  Sparkles,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { classesApi, type ClassWithSections } from "@/lib/classes";
import {
  examsApi,
  marksGridApi,
  type ExamDto,
  type GridRosterPayload,
  type GridRosterStudent,
} from "@/lib/exams";
import {
  useMyTeachingAssignments,
  type TeachingAssignmentDto,
} from "@/lib/teaching-assignments";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { LockedBadge } from "@/components/ui/LockedBadge";
import { ArchivedBadge } from "@/components/ui/StatusBadges";
import { AuditStamp } from "@/components/ui/AuditStamp";
import { cn } from "@/lib/utils";

// Sentinel for "Whole class (no section)" in the section dropdown.
const SECTION_WHOLE = "__whole__";

// Mode keys live in `?mode=` so deep links land on the right tab.
type Mode = "bulk" | "individual";
const VALID_MODES: Mode[] = ["bulk", "individual"];
const DEFAULT_MODE: Mode = "bulk";

/**
 * Unified marks-entry page — `/exams/marks`.
 *
 *   • Tab 1 (default) "Bulk Entry"        → fast class-wide grid.
 *   • Tab 2           "Individual Entry"  → handoff to per-student form.
 *
 * Replaces the multi-page maze of `/exams`, `/exams/bulk`, and
 * `/exams/marks-entry`. The bulk grid is the recommended path; the
 * Individual tab is preserved as a fallback for corrections and
 * one-off edits, but it links out to `/exams/individual` rather than
 * embedding the legacy page (the per-student form has its own
 * exam-CRUD scaffolding that doesn't belong on the marks workflow).
 *
 * Mode is reflected in `?mode=bulk|individual` so a teacher can
 * bookmark "individual entry" if they really want to.
 */
export default function MarksEntryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = parseMode(searchParams.get("mode"));

  const setMode = React.useCallback(
    (next: Mode) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_MODE) {
        sp.delete("mode");
      } else {
        sp.set("mode", next);
      }
      const qs = sp.toString();
      router.replace(qs ? `/exams/marks?${qs}` : "/exams/marks", {
        scroll: false,
      });
    },
    [router, searchParams],
  );

  return (
    <div className="space-y-5 animate-fade-in">
      <Header />
      <ModeSwitcher mode={mode} onChange={setMode} />
      {mode === "bulk" ? <BulkEntry /> : <IndividualEntry />}
    </div>
  );
}

function parseMode(raw: string | null): Mode {
  if (!raw) return DEFAULT_MODE;
  return (VALID_MODES as string[]).includes(raw) ? (raw as Mode) : DEFAULT_MODE;
}

// ---------------------------------------------------------------------------
// Header + mode switcher
// ---------------------------------------------------------------------------

function Header() {
  // Read role on each render (cheap localStorage read) so the
  // "Create Exam" affordance is shown only to admins / staff. The
  // backend gates POST /exams the same way; this just keeps the
  // hint out of teacher views where it'd be a dead-end.
  const role =
    typeof window !== "undefined" ? getStoredUser()?.role ?? null : null;
  const canCreateExam = role === "ADMIN" || role === "STAFF";
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Marks entry
      </h1>
      <p className="text-sm text-muted-foreground">
        Enter marks for all students in one go. Pick a class and subject,
        type a column of marks, then save.
      </p>
      {canCreateExam && (
        <p className="text-xs text-muted-foreground mt-1">
          Need to create an exam first?{" "}
          <Link
            href="/exams/create"
            className="font-medium text-primary hover:underline focus-ring rounded-sm"
          >
            Create Exam
          </Link>
        </p>
      )}
    </div>
  );
}

function ModeSwitcher({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Marks entry mode"
      className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/30 p-1"
    >
      <ModeButton
        mode="bulk"
        current={mode}
        onClick={() => onChange("bulk")}
        icon={<Zap className="h-4 w-4" />}
        label="Bulk entry"
        badge="Recommended"
      />
      <ModeButton
        mode="individual"
        current={mode}
        onClick={() => onChange("individual")}
        icon={<PencilLine className="h-4 w-4" />}
        label="Individual entry"
      />
    </div>
  );
}

function ModeButton({
  mode,
  current,
  onClick,
  icon,
  label,
  badge,
}: {
  mode: Mode;
  current: Mode;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}) {
  const isActive = mode === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all focus-ring",
        isActive
          ? "bg-surface text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-surface/60",
      )}
    >
      {icon}
      {label}
      {badge && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            isActive
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ===========================================================================
// Individual entry — handoff card
// ===========================================================================

function IndividualEntry() {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/20">
          <PencilLine className="h-5 w-5" />
        </div>
        <div className="flex-1 space-y-2">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Individual entry
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Use for corrections or individual edits — the per-student
            form lets you grade one student across many subjects, with
            full GPA preview and theory + practical splits intact.
          </p>
          <p className="text-sm text-muted-foreground">
            For day-to-day marks entry, the{" "}
            <span className="font-medium text-foreground">Bulk entry</span>{" "}
            tab is the faster path — it lets you type a column of marks
            for an entire class in seconds.
          </p>
          <div className="pt-2">
            <Link
              href="/exams/individual"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground transition-all hover:border-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400 hover:-translate-y-px focus-ring"
            >
              Open individual entry
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Bulk entry — class × subject grid (lifted from former /exams/marks-entry)
// ===========================================================================

function BulkEntry() {
  const router = useRouter();

  // ----- Reference data -----
  const [exams, setExams] = React.useState<ExamDto[]>([]);
  const [classes, setClasses] = React.useState<ClassWithSections[]>([]);
  const [refLoading, setRefLoading] = React.useState(true);
  const [refError, setRefError] = React.useState<string | null>(null);

  // ----- Selection -----
  const [examId, setExamId] = React.useState("");
  const [classId, setClassId] = React.useState("");
  const [sectionId, setSectionId] = React.useState("");
  const [subjectId, setSubjectId] = React.useState("");

  // ----- Grid -----
  const [rosterLoading, setRosterLoading] = React.useState(false);
  const [rosterError, setRosterError] = React.useState<string | null>(null);
  const [roster, setRoster] = React.useState<GridRosterPayload | null>(null);
  const [inputs, setInputs] = React.useState<Record<
    string,
    { marks: string; absent: boolean }
  >>({});
  const [saving, setSaving] = React.useState(false);

  // Wide-scope (ADMIN/STAFF) skips the assignment-based dropdown filter.
  const isWideScope = React.useMemo(() => {
    const u = getStoredUser();
    return u?.role === "ADMIN" || u?.role === "STAFF";
  }, []);

  // Assignments now flow through the React Query cache. The `enabled`
  // gate keeps admins/staff from firing a request that would always
  // 403 — the original imperative branch checked role === "TEACHER"
  // for the same reason. The downstream `assignments` derivation
  // preserves the previous semantics: null = "no filter (admin)",
  // empty = "teacher with no assignments / 403", populated = scope.
  const {
    data: rawAssignments,
    isLoading: assignmentsLoading,
    error: assignmentsError,
  } = useMyTeachingAssignments({ enabled: !isWideScope });
  const assignments: TeachingAssignmentDto[] | null = React.useMemo(() => {
    if (isWideScope) return null;
    if (
      assignmentsError instanceof ApiError &&
      assignmentsError.status === 403
    ) {
      return [];
    }
    // While loading (or hook hasn't resolved), surface as `[]` so the
    // teacher never momentarily sees the unfiltered admin catalog. The
    // page-level skeleton + the combined refLoading flag keep the body
    // hidden during this window anyway.
    return rawAssignments ?? [];
  }, [isWideScope, rawAssignments, assignmentsError]);

  // ----- Load reference data (exams + classes only — assignments are
  // hooked above) -----
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setRefLoading(true);
      setRefError(null);
      try {
        const [exs, cls] = await Promise.all([
          examsApi.list(),
          classesApi.list(),
        ]);
        if (cancelled) return;
        setExams(exs);
        setClasses(cls);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setRefError(extractMessage(err, "Failed to load reference data."));
      } finally {
        if (!cancelled) setRefLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // ----- Derived: filtered classes + sections + subjects -----
  const allowedClasses = React.useMemo(() => {
    if (isWideScope || !assignments) return classes;
    const ids = new Set(assignments.map((a) => a.classId));
    return classes.filter((c) => ids.has(c.id));
  }, [classes, assignments, isWideScope]);

  const selectedClass = React.useMemo(
    () => classes.find((c) => c.id === classId) ?? null,
    [classes, classId],
  );

  const allowedSectionIds = React.useMemo(() => {
    if (isWideScope || !assignments || !selectedClass) return null;
    const matching = assignments.filter((a) => a.classId === selectedClass.id);
    if (matching.some((a) => a.sectionId === null)) return null; // class-bound = all
    return new Set(
      matching.map((a) => a.sectionId).filter((id): id is string => !!id),
    );
  }, [assignments, isWideScope, selectedClass]);

  const selectedExam = React.useMemo(
    () => exams.find((e) => e.id === examId) ?? null,
    [exams, examId],
  );

  const allowedSubjects = React.useMemo(() => {
    if (!selectedExam) return [];
    if (isWideScope || !assignments) return selectedExam.subjects;
    if (!classId) return [];
    const normalizedSection =
      sectionId === SECTION_WHOLE ? null : sectionId || null;
    const allowedNames = new Set(
      assignments
        .filter((a) => a.classId === classId)
        .filter(
          (a) =>
            a.sectionId === null ||
            (normalizedSection !== null && a.sectionId === normalizedSection),
        )
        .filter((a) => a.subject !== null)
        .map((a) => a.subject!.name.toLowerCase().trim()),
    );
    return selectedExam.subjects.filter((s) =>
      allowedNames.has(s.name.toLowerCase().trim()),
    );
  }, [selectedExam, isWideScope, assignments, classId, sectionId]);

  // Cascade resets so stale ids never sneak through.
  React.useEffect(() => {
    setSectionId("");
    setSubjectId("");
  }, [classId]);
  React.useEffect(() => {
    setSubjectId("");
  }, [sectionId]);
  React.useEffect(() => {
    setRoster(null);
    setInputs({});
    setRosterError(null);
  }, [examId, classId, sectionId, subjectId]);

  // ----- Roster load -----
  const handleLoad = async () => {
    if (!examId || !classId || !subjectId) return;
    setRosterLoading(true);
    setRosterError(null);
    try {
      const r = await marksGridApi.roster({
        examId,
        classId,
        subjectId,
        sectionId:
          sectionId === SECTION_WHOLE || !sectionId ? null : sectionId,
      });
      setRoster(r);
      const next: Record<string, { marks: string; absent: boolean }> = {};
      for (const s of r.students) {
        next[s.id] = {
          marks:
            s.existing && !s.existing.absent && s.existing.obtainedMarks !== null
              ? String(s.existing.obtainedMarks)
              : "",
          absent: s.existing?.absent ?? false,
        };
      }
      setInputs(next);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setRosterError(extractMessage(err, "Failed to load roster."));
    } finally {
      setRosterLoading(false);
    }
  };

  // ----- Save -----
  const handleSave = async () => {
    if (!roster || saving) return;
    setSaving(true);
    try {
      const result = await marksGridApi.save({
        examId: roster.exam.id,
        classId: roster.class.id,
        sectionId: roster.section?.id ?? null,
        subjectId: roster.subject.id,
        marks: roster.students.map((s) => {
          const v = inputs[s.id] ?? { marks: "", absent: false };
          if (v.absent) {
            return { studentId: s.id, obtainedMarks: null, absent: true };
          }
          if (v.marks.trim() === "") {
            return { studentId: s.id, obtainedMarks: null };
          }
          const n = Number(v.marks);
          return {
            studentId: s.id,
            obtainedMarks: Number.isNaN(n) ? null : n,
          };
        }),
      });
      toast.success(
        result.updatedCount === 1
          ? "Saved 1 record"
          : `Saved ${result.updatedCount} records`,
      );
      await handleLoad();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      toast.error(extractMessage(err, "Failed to save marks."));
    } finally {
      setSaving(false);
    }
  };

  // ----- Render gates -----
  // Combined loading flag — page-skeleton stays visible until BOTH
  // exams/classes (imperative) AND assignments (hook) have resolved
  // for teachers. Mirrors the old Promise.all-based UX exactly.
  const referenceLoading =
    refLoading || (!isWideScope && assignmentsLoading);
  if (referenceLoading) return <PageSkeleton />;
  if (refError) return <ErrorBanner message={refError} />;

  // teacherEmpty: only after hook has settled — never during loading,
  // otherwise the empty-state would flash briefly while assignments
  // are still in flight.
  const teacherEmpty =
    !isWideScope &&
    !assignmentsLoading &&
    assignments !== null &&
    assignments.length === 0;
  if (teacherEmpty) return <NoAssignmentEmptyState />;

  return (
    <div className="space-y-4">
      {/* Helper banner — sets the expectation that this is the
          "everyone in the class at once" path. */}
      <div className="flex items-start gap-2.5 rounded-md border border-emerald-300/40 bg-emerald-500/[0.05] px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
        <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
        <span>
          <span className="font-medium">Fast entry for entire class.</span>{" "}
          Enter marks for all students in one go — Tab moves to the next
          row, Enter / arrow keys jump up & down, paste a column from a
          spreadsheet to fill the grid in one shot.
        </span>
      </div>

      <SelectorBar
        exams={exams}
        classes={allowedClasses}
        allowedSubjects={allowedSubjects}
        allowedSectionIds={allowedSectionIds}
        selectedClass={selectedClass}
        examId={examId}
        classId={classId}
        sectionId={sectionId}
        subjectId={subjectId}
        onChangeExam={setExamId}
        onChangeClass={setClassId}
        onChangeSection={setSectionId}
        onChangeSubject={setSubjectId}
        onLoad={handleLoad}
        loading={rosterLoading}
        disabled={saving}
      />

      {rosterError && (
        <ErrorBanner
          message={rosterError}
          note={
            rosterError.toLowerCase().includes("not assigned")
              ? "You can only enter marks for the (class × subject) combinations your admin has assigned to you."
              : undefined
          }
        />
      )}

      {!roster && !rosterLoading && !rosterError && <SelectionEmptyState />}
      {rosterLoading && <GridSkeleton />}

      {/* Phase RELIABILITY-III Part 5 — operator trust strip on the
          marks-entry toolbar. Surfaces the exam's lock + archive
          state BEFORE the operator types anything, so the inevitable
          backend 423/409 doesn't waste typing. Hidden when no exam
          is selected or when neither flag is set. */}
      {selectedExam && (selectedExam.locked || selectedExam.archivedAt) && (
        <ExamStateBanner exam={selectedExam} />
      )}

      {roster && !rosterLoading && (
        <Grid
          roster={roster}
          inputs={inputs}
          onChangeInputs={setInputs}
          onSave={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Selector bar (4 dropdowns + Load students)
// ---------------------------------------------------------------------------

function SelectorBar({
  exams,
  classes,
  allowedSubjects,
  allowedSectionIds,
  selectedClass,
  examId,
  classId,
  sectionId,
  subjectId,
  onChangeExam,
  onChangeClass,
  onChangeSection,
  onChangeSubject,
  onLoad,
  loading,
  disabled,
}: {
  exams: ExamDto[];
  classes: ClassWithSections[];
  allowedSubjects: ExamDto["subjects"];
  allowedSectionIds: Set<string> | null;
  selectedClass: ClassWithSections | null;
  examId: string;
  classId: string;
  sectionId: string;
  subjectId: string;
  onChangeExam: (id: string) => void;
  onChangeClass: (id: string) => void;
  onChangeSection: (id: string) => void;
  onChangeSubject: (id: string) => void;
  onLoad: () => void;
  loading: boolean;
  disabled?: boolean;
}) {
  const canLoad = !!examId && !!classId && !!subjectId && !loading && !disabled;
  const sectionOptions = React.useMemo(() => {
    if (!selectedClass) return [];
    return selectedClass.sections.filter(
      (s) => !allowedSectionIds || allowedSectionIds.has(s.id),
    );
  }, [selectedClass, allowedSectionIds]);
  const allowWholeClass = allowedSectionIds === null;

  return (
    <div className="rounded-xl border border-border bg-surface/80 backdrop-blur p-4 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <IconSelect
          label="Exam"
          icon={<Sparkles className="h-4 w-4" />}
          value={examId}
          onChange={onChangeExam}
          disabled={disabled}
          placeholder="Choose exam…"
          options={exams.map((e) => ({ value: e.id, label: e.name }))}
        />
        <IconSelect
          label="Class"
          icon={<GraduationCap className="h-4 w-4" />}
          value={classId}
          onChange={onChangeClass}
          disabled={disabled || !examId}
          placeholder={examId ? "Choose class…" : "Pick exam first"}
          options={classes.map((c) => ({ value: c.id, label: c.name }))}
        />
        <IconSelect
          label="Section"
          icon={<Layers className="h-4 w-4" />}
          value={sectionId}
          onChange={onChangeSection}
          disabled={disabled || !classId}
          placeholder={classId ? "Choose section…" : "Pick class first"}
          options={[
            ...(allowWholeClass
              ? [{ value: SECTION_WHOLE, label: "Whole class (no section)" }]
              : []),
            ...sectionOptions.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <IconSelect
          label="Subject"
          icon={<BookOpen className="h-4 w-4" />}
          value={subjectId}
          onChange={onChangeSubject}
          disabled={disabled || !classId}
          placeholder={
            !classId
              ? "Pick class first"
              : allowedSubjects.length === 0
                ? "No subjects available"
                : "Choose subject…"
          }
          options={allowedSubjects.map((s) => ({
            value: s.id,
            label: `${s.name}${
              s.practicalFullMarks > 0
                ? ` (theory ${s.theoryFullMarks} + practical ${s.practicalFullMarks})`
                : ` (out of ${s.theoryFullMarks})`
            }`,
          }))}
        />
      </div>
      <div className="flex items-center justify-end">
        <Button
          onClick={onLoad}
          disabled={!canLoad}
          loading={loading}
          leftIcon={!loading ? <Search className="h-4 w-4" /> : undefined}
        >
          Load students
        </Button>
      </div>
    </div>
  );
}

function IconSelect({
  label,
  icon,
  value,
  onChange,
  disabled,
  placeholder,
  options,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          {icon}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
            "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
            "transition-colors",
          )}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function Grid({
  roster,
  inputs,
  onChangeInputs,
  onSave,
  saving,
}: {
  roster: GridRosterPayload;
  inputs: Record<string, { marks: string; absent: boolean }>;
  onChangeInputs: React.Dispatch<
    React.SetStateAction<Record<string, { marks: string; absent: boolean }>>
  >;
  onSave: () => void;
  saving: boolean;
}) {
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const setRef = React.useCallback(
    (idx: number) => (el: HTMLInputElement | null) => {
      inputRefs.current[idx] = el;
    },
    [],
  );

  React.useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      inputRefs.current[0]?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [roster.subject.id]);

  const updateRow = React.useCallback(
    (
      studentId: string,
      patch: Partial<{ marks: string; absent: boolean }>,
    ) => {
      onChangeInputs((prev) => ({
        ...prev,
        [studentId]: {
          marks: prev[studentId]?.marks ?? "",
          absent: prev[studentId]?.absent ?? false,
          ...patch,
        },
      }));
    },
    [onChangeInputs],
  );

  const focusRow = (idx: number) => {
    const el = inputRefs.current[idx];
    if (el) {
      el.focus();
      el.select();
    }
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    idx: number,
  ) => {
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      focusRow(Math.min(idx + 1, roster.students.length - 1));
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      focusRow(Math.max(idx - 1, 0));
    }
  };

  const handlePaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    startIdx: number,
  ) => {
    const text = e.clipboardData.getData("text");
    if (!text || (!text.includes("\n") && !text.includes("\t"))) return;
    e.preventDefault();
    const tokens = text
      .split(/[\r\n\t]+/g)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return;
    onChangeInputs((prev) => {
      const next = { ...prev };
      for (let i = 0; i < tokens.length; i++) {
        const targetIdx = startIdx + i;
        const student = roster.students[targetIdx];
        if (!student) break;
        const tok = tokens[i];
        const numeric = /^-?\d+(\.\d+)?$/.test(tok);
        if (!numeric) continue;
        next[student.id] = { marks: tok, absent: false };
      }
      return next;
    });
    const lastIdx = Math.min(
      startIdx + tokens.length,
      roster.students.length - 1,
    );
    window.requestAnimationFrame(() => focusRow(lastIdx));
  };

  const pendingCount = roster.students.reduce((acc, s) => {
    const v = inputs[s.id];
    if (!v) return acc;
    if (v.absent) return acc + 1;
    if (v.marks.trim() !== "") return acc + 1;
    return acc;
  }, 0);

  return (
    <div className="space-y-3">
      {/* Subject + class context strip — also shows the loaded student
          count, which is the spec's "32 students loaded" feedback. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <BookOpen className="h-4 w-4 text-emerald-600" />
          {roster.subject.name}
        </span>
        <span className="text-muted-foreground">
          out of{" "}
          <span className="font-medium text-foreground tabular-nums">
            {roster.subject.fullMarks}
          </span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <GraduationCap className="h-3.5 w-3.5" />
          {roster.class.name}
          {roster.section ? ` · ${roster.section.name}` : ""}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 tabular-nums">
          <Users className="h-3.5 w-3.5" />
          {roster.students.length} student
          {roster.students.length === 1 ? "" : "s"} loaded
        </span>
      </div>

      {roster.subject.hasPractical && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-medium">{roster.subject.name}</span> has
            a practical component too. The grid only writes the theory
            mark — switch to{" "}
            <Link
              href="/exams/marks?mode=individual"
              className="font-medium underline underline-offset-2"
            >
              Individual entry
            </Link>{" "}
            to grade the practical.
          </span>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-muted/30">
                <Th className="w-[40px] text-center">#</Th>
                <Th>Student</Th>
                <Th className="w-[120px]">Roll / Symbol</Th>
                <Th className="w-[140px]">
                  Marks{" "}
                  <span className="text-[10px] font-normal text-muted-foreground/80 normal-case tabular-nums">
                    /{roster.subject.fullMarks}
                  </span>
                </Th>
                <Th className="w-[90px] text-center">Absent</Th>
              </tr>
            </thead>
            <tbody>
              {roster.students.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No students in this {roster.section ? "section" : "class"}.
                  </td>
                </tr>
              ) : (
                roster.students.map((s, idx) => (
                  <Row
                    key={s.id}
                    idx={idx}
                    student={s}
                    value={inputs[s.id] ?? { marks: "", absent: false }}
                    fullMarks={roster.subject.fullMarks}
                    onChange={(patch) => updateRow(s.id, patch)}
                    onKeyDown={(e) => handleKeyDown(e, idx)}
                    onPaste={(e) => handlePaste(e, idx)}
                    inputRef={setRef(idx)}
                    disabled={saving}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 sticky bottom-2 z-10 rounded-lg border border-border bg-surface/95 backdrop-blur px-4 py-2 shadow-sm">
        <span className="text-xs text-muted-foreground tabular-nums">
          {pendingCount} of {roster.students.length} ready to save
        </span>
        <Button
          onClick={onSave}
          disabled={saving || pendingCount === 0}
          loading={saving}
          leftIcon={!saving ? <Save className="h-4 w-4" /> : undefined}
        >
          Save all
        </Button>
      </div>
    </div>
  );
}

function Row({
  idx,
  student,
  value,
  fullMarks,
  onChange,
  onKeyDown,
  onPaste,
  inputRef,
  disabled,
}: {
  idx: number;
  student: GridRosterStudent;
  value: { marks: string; absent: boolean };
  fullMarks: number;
  onChange: (patch: Partial<{ marks: string; absent: boolean }>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  disabled?: boolean;
}) {
  const numeric = value.marks.trim() === "" ? null : Number(value.marks);
  const outOfRange =
    numeric !== null && (Number.isNaN(numeric) || numeric < 0 || numeric > fullMarks);

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <Td className="text-center text-xs text-muted-foreground tabular-nums">
        {idx + 1}
      </Td>
      <Td>
        <span className="font-medium text-foreground">
          {student.firstName} {student.lastName}
        </span>
      </Td>
      <Td className="text-muted-foreground tabular-nums text-xs">
        {student.symbolNumber ?? "—"}
      </Td>
      <Td>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={value.absent ? "" : value.marks}
          placeholder={value.absent ? "—" : "0"}
          onChange={(e) =>
            onChange({ marks: e.target.value.replace(/[^0-9.]/g, "") })
          }
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={disabled || value.absent}
          aria-label={`Marks for ${student.firstName} ${student.lastName}`}
          className={cn(
            "h-8 w-full rounded-md border bg-surface px-2 text-sm tabular-nums",
            "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
            "disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground",
            outOfRange ? "border-destructive/50 bg-destructive/5" : "border-border",
          )}
        />
      </Td>
      <Td className="text-center">
        <input
          type="checkbox"
          checked={value.absent}
          onChange={(e) => {
            const next = e.target.checked;
            onChange(next ? { absent: true, marks: "" } : { absent: false });
          }}
          disabled={disabled}
          aria-label={`Mark ${student.firstName} ${student.lastName} absent`}
          className="h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500/30"
        />
      </Td>
    </tr>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "h-10 px-3 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle border-b border-border/60",
        className,
      )}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading / error
// ---------------------------------------------------------------------------

function NoAssignmentEmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/10 px-8 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/20">
        <XCircle className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">
        You are not assigned to teach this subject/class.
      </h2>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Ask your admin to grant you a TeachingAssignment for the class
        and subject you need to grade. Once they assign you, this page
        will load the roster automatically.
      </p>
    </div>
  );
}

/**
 * Phase RELIABILITY-III Part 5 — exam-state trust banner.
 *
 * Rendered on the marks-entry page WHENEVER the selected exam is
 * locked or archived. Reuses the existing badge primitives so the
 * operator sees the same visual language they're used to on the
 * marksheet, exam pickers, and student rows.
 *
 * Why above the grid (not inside the SelectorBar):
 *   • The grid renders ONLY after the operator clicks Load students;
 *     a banner inside the selector would clutter the "nothing
 *     loaded yet" state too.
 *   • Placing it directly above the grid means the operator sees
 *     "this exam is locked" right next to the input column they're
 *     about to type into. Maximum hit-rate, minimum surprise.
 */
function ExamStateBanner({ exam }: { exam: ExamDto }) {
  const isArchived = !!exam.archivedAt;
  const isLocked = !!exam.locked;
  // Choose the dominant tone: archive is the more "operator must
  // restore before doing anything else" state, so it takes priority.
  const tone = isArchived ? 'rose' : 'amber';
  const toneClass =
    tone === 'rose'
      ? 'border-rose-300/50 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/5'
      : 'border-amber-300/50 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5';
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-xs',
        toneClass,
      )}
    >
      {isArchived && (
        <ArchivedBadge archivedAt={exam.archivedAt} reason={exam.archiveReason} />
      )}
      {isLocked && (
        <LockedBadge
          tooltip="Marks edits will reject with HTTP 423 until an admin unlocks the exam."
        />
      )}
      {isLocked && exam.lockedAt && (
        <AuditStamp action="Locked" at={exam.lockedAt} tone="warning" />
      )}
      <span className="text-foreground">
        {isArchived
          ? 'This exam is archived. Restore it before editing marks.'
          : 'This exam is locked. Marks edits will reject with 423 until an admin unlocks.'}
      </span>
    </div>
  );
}

function SelectionEmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/10 px-8 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-sm font-semibold text-foreground">
        Pick exam, class, and subject above
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Then click <span className="font-medium text-foreground">Load students</span>{" "}
        to start entering marks.
      </p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-3 w-96" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="bg-muted/30 px-4 py-2">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-4 w-6" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="ml-auto h-8 w-32 rounded-md" />
            <Skeleton className="h-4 w-4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({ message, note }: { message: string; note?: string }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-4 w-4" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{message}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

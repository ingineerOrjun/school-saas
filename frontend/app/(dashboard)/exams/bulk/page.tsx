"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ClipboardList,
  Save,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { useClasses, type ClassWithSections } from "@/lib/classes";
import {
  examsApi,
  resultsApi,
  type ExamDto,
  type ExamSubjectDto,
} from "@/lib/exams";
import { useStudents, type StudentDto } from "@/lib/students";
import {
  useMyTeachingAssignments,
  type TeachingAssignmentDto,
} from "@/lib/teaching-assignments";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  MarksEntryTable,
  parseMarks,
  type MarksMap,
} from "@/components/exams/MarksEntryTable";
import { cn } from "@/lib/utils";

// Sentinel string for "Whole class (no section)" in the section
// dropdown. Empty string means "nothing picked yet".
const SECTION_WHOLE = "__whole__";

/**
 * Bulk marks entry page — `/exams/bulk`.
 *
 * Workflow:
 *   1. Pick Exam, Class, Section, Subject (top bar).
 *   2. Roster appears as soon as all four are selected.
 *   3. Type marks per row (TAB navigates).
 *   4. Click "Save All" → POST /results/bulk-save → toast.
 *
 * Teacher scope is enforced both client-side (dropdowns hide non-
 * assigned items) AND server-side (`assertBulkMarksAccess`).
 *
 * The single-student entry flow at `/exams` is untouched and still
 * the right tool for entering one student's marks across many
 * subjects — bulk is for the inverse: many students, one subject.
 */
export default function BulkMarksPage() {
  const router = useRouter();

  // ----- Reference data -----
  const [exams, setExams] = React.useState<ExamDto[]>([]);
  // Classes via the shared React Query hook (10m staleTime). Was a
  // Promise.all leg in the old useEffect below; splitting it off
  // closes the /classes dupe flagged by the request-pressure panel.
  const classesQuery = useClasses();
  const classes: ClassWithSections[] = classesQuery.data ?? [];
  // null when the caller is ADMIN — no filter applied. Empty array means
  // "TEACHER with zero assignments". A populated array narrows the
  // class + subject dropdowns. Backed by the shared React Query cache
  // via `useMyTeachingAssignments` — admins/staff are gated out via
  // `enabled: isTeacher` so they never burn a request that would 403.
  const isTeacher = React.useMemo(
    () => getStoredUser()?.role === "TEACHER",
    [],
  );
  const {
    data: rawAssignments,
    isLoading: assignmentsLoading,
    error: assignmentsError,
  } = useMyTeachingAssignments({ enabled: isTeacher });
  const assignments: TeachingAssignmentDto[] | null = React.useMemo(() => {
    if (!isTeacher) return null; // ADMIN/STAFF — unfiltered catalog
    if (
      assignmentsError instanceof ApiError &&
      assignmentsError.status === 403
    ) {
      return [];
    }
    // Mid-load: surface as `[]` so we never briefly leak the admin
    // catalog into a teacher's pickers. The combined loading flag
    // below also keeps the page in its disabled state until the
    // hook settles.
    return rawAssignments ?? [];
  }, [isTeacher, rawAssignments, assignmentsError]);
  // `loading` here originally tracked the Promise.all of exams +
  // classes. Now it only tracks the exams fetch; the classes side
  // is reflected via `classesQuery.isLoading` in the combined
  // `refLoading` flag downstream (see the existing reference-not-
  // -ready-yet gate around line 370).
  const [loading, setLoading] = React.useState(true);
  const [refError, setRefError] = React.useState<string | null>(null);

  // ----- Selection (the top-bar pickers) -----
  const [examId, setExamId] = React.useState("");
  const [classId, setClassId] = React.useState("");
  const [sectionId, setSectionId] = React.useState(""); // "" = unset, SECTION_WHOLE = whole class
  const [examSubjectId, setExamSubjectId] = React.useState("");

  // ----- Roster + marks state -----
  // Students now flow through the shared React Query hook. The
  // `enabled` gate preserves the previous early-return semantics
  // (the imperative effect skipped its fetch until all four pickers
  // were settled) — without it, the first render would fire the
  // hook with classId="" and we'd see the same dupe in request-
  // pressure that the rating screen had before Session 6a.
  const allFourReady = !!classId && sectionId !== "" && !!examSubjectId;
  const studentsQuery = useStudents(
    { classId },
    { enabled: allFourReady },
  );
  const [marks, setMarks] = React.useState<MarksMap>({});
  const [saving, setSaving] = React.useState(false);

  // ----- Initial load: exams only. Classes come from useClasses()
  // (10m cache) above; assignments come from the
  // useMyTeachingAssignments hook above. -----
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setRefError(null);
      try {
        const examList = await examsApi.list();
        if (cancelled) return;
        setExams(examList);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setRefError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load reference data.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Bridge classesQuery.error into refError — the previous Promise.all
  // catch funneled BOTH leg failures into refError; preserve that
  // single-error-banner surface so a classes-load failure still
  // shows up here.
  React.useEffect(() => {
    if (classesQuery.error) {
      setRefError((prev) =>
        prev ??
        (classesQuery.error instanceof ApiError
          ? classesQuery.error.message
          : classesQuery.error instanceof Error
            ? classesQuery.error.message
            : "Failed to load classes."),
      );
    }
  }, [classesQuery.error]);

  // ----- Cascade resets -----
  // When any "upstream" picker changes, downstream pickers + state
  // reset so we never end up with a stale combination (e.g., section
  // from the previous class still picked). The roster derives from
  // `studentsQuery` below — once the cascade clears sectionId /
  // examSubjectId, `allFourReady` flips false, the hook is disabled,
  // and the derived `students` returns to null without any imperative
  // reset.
  React.useEffect(() => {
    setSectionId("");
    setExamSubjectId("");
    setMarks({});
  }, [classId]);
  React.useEffect(() => {
    setExamSubjectId("");
    setMarks({});
  }, [sectionId, examId]);

  // ----- Derived: scope-filtered class + section + subject options -----

  /** Classes the teacher is assigned to. Admin → all. */
  const visibleClasses = React.useMemo(() => {
    if (assignments === null) return classes;
    const allowed = new Set(assignments.map((a) => a.classId));
    return classes.filter((c) => allowed.has(c.id));
  }, [classes, assignments]);

  const selectedClass = React.useMemo(
    () => classes.find((c) => c.id === classId) ?? null,
    [classes, classId],
  );

  const selectedExam = React.useMemo(
    () => exams.find((e) => e.id === examId) ?? null,
    [exams, examId],
  );

  /**
   * Effective sectionId for downstream filtering and the API call:
   *   • SECTION_WHOLE → null (whole-class scope)
   *   • specific UUID → the UUID
   *   • "" → null (nothing picked yet)
   */
  const effectiveSectionId =
    sectionId === SECTION_WHOLE || sectionId === "" ? null : sectionId;

  /**
   * Subjects the teacher can grade for the picked (class, section).
   * Admin → all subjects from the picked exam (no filter).
   *
   * Mirrors the backend's `assertBulkMarksAccess` rule exactly:
   *   keep assignments where
   *     classId === selected class
   *     AND (sectionId === selected section OR assignment.sectionId IS NULL)
   *     AND subject !== null
   *   → match by NAME against the exam's subjects (case-insensitive).
   *
   * Returns the subset of `selectedExam.subjects` the teacher is
   * allowed to act on; empty when nothing matches.
   */
  const visibleExamSubjects = React.useMemo(() => {
    if (!selectedExam) return [];
    if (assignments === null) return selectedExam.subjects;
    if (!classId) return selectedExam.subjects;
    // We allow filtering before section is picked too — by then
    // sectionId is "" (which we treat as "no filter narrowed down" on
    // assignment side). Once a section is picked, the rule tightens.
    const allowed = new Set(
      assignments
        .filter(
          (a) =>
            a.classId === classId &&
            // Section rule mirrors the LOOSER bulk policy — class-bound
            // assignments authorize any section (and the "whole class"
            // option), section-bound only their exact section.
            (a.sectionId === null ||
              effectiveSectionId === null ||
              a.sectionId === effectiveSectionId),
        )
        .map((a) => a.subject?.name.toLowerCase().trim() ?? null)
        .filter((n): n is string => n !== null),
    );
    return selectedExam.subjects.filter((s) =>
      allowed.has(s.name.toLowerCase().trim()),
    );
  }, [
    selectedExam,
    assignments,
    classId,
    effectiveSectionId,
  ]);

  const selectedSubject = React.useMemo(
    () =>
      visibleExamSubjects.find((s) => s.id === examSubjectId) ?? null,
    [visibleExamSubjects, examSubjectId],
  );

  // ----- Roster derivation -----
  // The backend `?classId=` query lives in the hook above; section
  // narrowing stays client-side (matches the bulk-save endpoint's
  // expected scope: sectionId set → that section; sectionId null →
  // classId=X AND sectionId IS NULL). The render path distinguishes
  // null (not ready / first load) from [] (loaded empty / errored).
  const loadingStudents = allFourReady && studentsQuery.isLoading;
  const students: StudentDto[] | null = React.useMemo(() => {
    if (!allFourReady) return null;
    // On a real load failure the original code toasted and rendered
    // the "no students" empty state — mirror that here.
    if (studentsQuery.error) return [];
    if (!studentsQuery.data) return null;

    const inScope = studentsQuery.data.filter((s) =>
      effectiveSectionId === null
        ? s.sectionId === null && s.classId === classId
        : s.sectionId === effectiveSectionId,
    );
    // Stable order — symbolNumber asc when present, else name.
    inScope.sort((a, b) => {
      if (a.symbolNumber && b.symbolNumber)
        return a.symbolNumber.localeCompare(b.symbolNumber);
      if (a.symbolNumber) return -1;
      if (b.symbolNumber) return 1;
      const an = `${a.firstName} ${a.lastName}`;
      const bn = `${b.firstName} ${b.lastName}`;
      return an.localeCompare(bn);
    });
    return inScope;
  }, [
    allFourReady,
    studentsQuery.data,
    studentsQuery.error,
    classId,
    effectiveSectionId,
  ]);

  // Bridge studentsQuery.error into the same UX the imperative
  // try/catch produced: 401 → /login, anything else → toast. Runs
  // once per error transition (deps include the error reference).
  React.useEffect(() => {
    if (!studentsQuery.error) return;
    if (
      studentsQuery.error instanceof ApiError &&
      studentsQuery.error.status === 401
    ) {
      router.replace("/login");
      return;
    }
    toast.error(
      studentsQuery.error instanceof ApiError
        ? studentsQuery.error.message
        : "Failed to load students.",
    );
  }, [studentsQuery.error, router]);

  // ----- Save -----
  const handleSaveAll = async () => {
    if (!selectedExam || !selectedSubject || !classId || sectionId === "") {
      return;
    }
    if (!students || students.length === 0) return;

    // Build entries for ONLY students with a usable theory mark. Blank
    // rows are skipped — the parent's "no marks for this student in
    // this batch" intent. Invalid rows abort the save with a toast.
    const entries: Array<{
      studentId: string;
      theoryMarks: number;
      practicalMarks?: number;
    }> = [];
    for (const s of students) {
      const draft = marks[s.id];
      if (!draft) continue;
      const t = parseMarks(draft.theory, selectedSubject.theoryFullMarks);
      const hasPractical = selectedSubject.practicalFullMarks > 0;
      const p = hasPractical
        ? parseMarks(draft.practical, selectedSubject.practicalFullMarks)
        : { value: 0, valid: true, blank: true, error: null };

      // Theory blank → skip the row entirely.
      if (t.blank) continue;
      if (!t.valid || !p.valid) {
        toast.error(
          `Fix the highlighted marks before saving. (${s.firstName} ${s.lastName})`,
        );
        return;
      }
      entries.push({
        studentId: s.id,
        theoryMarks: t.value,
        practicalMarks: hasPractical ? p.value : undefined,
      });
    }

    if (entries.length === 0) {
      toast.error("Enter at least one student's marks before saving.");
      return;
    }

    setSaving(true);
    try {
      const result = await resultsApi.bulkSave({
        examId: selectedExam.id,
        classId,
        sectionId: effectiveSectionId,
        subjectId: selectedSubject.id,
        entries,
      });
      toast.success("Marks saved successfully", {
        description: `Saved ${result.successCount} ${
          result.successCount === 1 ? "row" : "rows"
        } for ${selectedSubject.name}.`,
      });
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Save failed.",
      );
    } finally {
      setSaving(false);
    }
  };

  // ----- Render -----
  // Combined "reference data not ready yet" flag — exams/classes
  // come from the imperative fetch above and assignments come from
  // the React Query hook. Gate the pickers on BOTH so a teacher
  // never momentarily sees the unfiltered admin catalog while the
  // assignments cache is hydrating.
  const referenceLoading =
    loading || classesQuery.isLoading || (isTeacher && assignmentsLoading);
  const allSelected =
    !!examId && !!classId && sectionId !== "" && !!examSubjectId;

  return (
    <div className="space-y-6">
      <Header />

      {refError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Couldn&apos;t load reference data
            </p>
            <p className="mt-1 text-sm text-destructive/90">{refError}</p>
          </div>
        </div>
      )}

      {/* Picker bar */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PickerField label="Exam">
            <select
              value={examId}
              onChange={(e) => {
                setExamId(e.target.value);
                setClassId("");
              }}
              disabled={referenceLoading || saving}
              className={selectClasses}
            >
              <option value="">
                {referenceLoading ? "Loading…" : "Choose exam…"}
              </option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </PickerField>

          <PickerField label="Class">
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={referenceLoading || saving || !examId}
              className={selectClasses}
            >
              <option value="">
                {!examId
                  ? "Pick an exam first"
                  : visibleClasses.length === 0
                    ? "No classes assigned to you"
                    : "Choose class…"}
              </option>
              {visibleClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </PickerField>

          <PickerField label="Section">
            <select
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={referenceLoading || saving || !classId}
              className={selectClasses}
            >
              <option value="">
                {!classId ? "Pick a class first" : "Choose section…"}
              </option>
              <option value={SECTION_WHOLE}>Whole class (no section)</option>
              {selectedClass?.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  Section {s.name}
                </option>
              ))}
            </select>
          </PickerField>

          <PickerField label="Subject">
            <select
              value={examSubjectId}
              onChange={(e) => setExamSubjectId(e.target.value)}
              disabled={referenceLoading || saving || !classId || sectionId === ""}
              className={selectClasses}
            >
              <option value="">
                {!classId || sectionId === ""
                  ? "Pick class & section first"
                  : visibleExamSubjects.length === 0
                    ? "No subjects assigned for this class"
                    : "Choose subject…"}
              </option>
              {visibleExamSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </PickerField>
        </div>
      </div>

      {/* Body */}
      {!allSelected ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Sparkles className="h-10 w-10" strokeWidth={1.5} />}
            title="Pick exam, class, section, and subject to start"
            description="Once all four are set, the roster appears below and you can enter marks for the whole class."
          />
        </div>
      ) : loadingStudents ? (
        <RosterSkeleton />
      ) : students && students.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Users className="h-10 w-10" strokeWidth={1.5} />}
            title="No students found"
            description={
              effectiveSectionId === null
                ? "No students are linked directly to this class without a section. Pick a section instead, or assign students from the Students page."
                : "No students are placed in this section yet. Assign students from the Students page."
            }
          />
        </div>
      ) : students && selectedSubject ? (
        <div className="space-y-4">
          {/* Status strip — confirms scope + total before the user
              dives in. Helps catch "wrong subject picked" before
              entering marks. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <ClipboardList className="h-4 w-4" />
              Entering marks for{" "}
              <span className="font-semibold">{selectedSubject.name}</span>{" "}
              — {students.length}{" "}
              {students.length === 1 ? "student" : "students"}
            </div>
            <Button
              onClick={handleSaveAll}
              loading={saving}
              leftIcon={!saving ? <Save className="h-4 w-4" /> : undefined}
            >
              Save All
            </Button>
          </div>

          <MarksEntryTable
            students={students}
            subject={selectedSubject}
            marks={marks}
            onChange={(studentId, patch) =>
              setMarks((prev) => ({
                ...prev,
                [studentId]: {
                  theory: prev[studentId]?.theory ?? "",
                  practical: prev[studentId]?.practical ?? "",
                  ...patch,
                },
              }))
            }
            saving={saving}
          />

          {/* Footer save — duplicate of the top one so the user doesn't
              have to scroll up after entering many rows. */}
          <div className="flex justify-end">
            <Button
              onClick={handleSaveAll}
              loading={saving}
              leftIcon={!saving ? <Save className="h-4 w-4" /> : undefined}
            >
              Save All
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <Link
          href="/exams"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors focus-ring rounded-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to per-student entry
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Bulk marks entry
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter marks for an entire class in one go — pick the scope,
          type the marks, save once.
        </p>
      </div>
    </div>
  );
}

function PickerField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const selectClasses = cn(
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground",
  "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25",
  "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
  "transition-colors",
);

function RosterSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
            <div className="ml-auto flex items-center gap-2">
              <Skeleton className="h-9 w-24 rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

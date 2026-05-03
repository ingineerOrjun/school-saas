"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  ClipboardList,
  X,
  Save,
  Sparkles,
  Trophy,
  RotateCw,
  AlertCircle,
  AlertTriangle,
  BookOpen,
  FileText,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import {
  examsApi,
  resultsApi,
  type ExamDto,
  type ExamSubjectDto,
  type StudentReport,
} from "@/lib/exams";
import { studentsApi, type StudentDto } from "@/lib/students";
import { getStoredUser } from "@/lib/auth";
import {
  teachingAssignmentsApi,
  type TeachingAssignmentDto,
} from "@/lib/teaching-assignments";
import { useAcademicSession } from "@/components/academic-session/AcademicSessionProvider";
import { gpa, gradeWithSplit, overallGrade } from "@/lib/grading";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

export default function ExamsPage() {
  const router = useRouter();
  const [exams, setExams] = React.useState<ExamDto[] | null>(null);
  const [students, setStudents] = React.useState<StudentDto[]>([]);
  // Teacher-only filter set. ADMIN keeps it null → no filtering applied.
  const [assignments, setAssignments] = React.useState<
    TeachingAssignmentDto[] | null
  >(null);
  const [selectedExamId, setSelectedExamId] = React.useState<string>("");
  const [selectedStudentId, setSelectedStudentId] = React.useState<string>("");
  const [marksByStudent, setMarksByStudent] = React.useState<
    Record<string, Record<string, { theory: string; practical: string }>>
  >({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [savedReport, setSavedReport] = React.useState<StudentReport | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Selected session — passed to examsApi.list so switching sessions
  // in the topbar refetches a different academic year's exams.
  const { selected: selectedSession } = useAcademicSession();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // For TEACHER users, also pull their assignments so the student
      // picker and exam-subject list collapse to what they're allowed
      // to grade. Admins skip the request entirely.
      const role = getStoredUser()?.role ?? null;
      const [examList, studentList, myAssignments] = await Promise.all([
        examsApi.list(selectedSession?.id),
        studentsApi.list(),
        role === "TEACHER"
          ? teachingAssignmentsApi.listMine().catch((err) => {
              // 403 means "not a teacher row yet" — treat as no scope.
              if (err instanceof ApiError && err.status === 403) return [];
              throw err;
            })
          : Promise.resolve(null),
      ]);
      setExams(examList);
      setStudents(studentList);
      setAssignments(myAssignments);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setError(
        err instanceof ApiError ? err.message : "Failed to load exams.",
      );
      setExams([]);
    } finally {
      setLoading(false);
    }
    // selectedSession.id in deps so the user switching academic
    // session in the topbar triggers a fresh fetch.
  }, [router, selectedSession?.id]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedExam = React.useMemo(
    () => exams?.find((e) => e.id === selectedExamId) ?? null,
    [exams, selectedExamId],
  );

  // Filter students to those a TEACHER can grade. Admin → no filter.
  const visibleStudents = React.useMemo(
    () => filterStudentsByAssignments(students, assignments),
    [students, assignments],
  );

  const selectedStudent = React.useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId],
  );

  /**
   * Subject filter — narrows the exam's subject list to ones the
   * teacher is allowed to grade FOR THE PICKED STUDENT'S CLASS.
   *
   * Mirrors the backend's strict rule in `assertResultsEntryAccess`:
   *   • assignment.classId === student's effective classId
   *   • AND (assignment.sectionId === student's sectionId OR both null)
   *   • AND assignment has a subject (subject-less rows can't grade)
   *   • AND assignment.subject.name (lowercase, trimmed) matches the
   *     ExamSubject.name
   *
   * When no student is picked yet we DON'T filter — the table isn't
   * rendered until a student is chosen, and showing an unhelpful
   * "no subjects" message before that step is confusing.
   *
   * Admins (assignments === null) always see every subject.
   */
  const visibleExamSubjects = React.useMemo(() => {
    if (!selectedExam) return [];
    if (assignments === null) return selectedExam.subjects;
    if (!selectedStudent) return selectedExam.subjects;
    const allowed = allowedSubjectNamesForStudent(
      assignments,
      selectedStudent,
    );
    return selectedExam.subjects.filter((s) =>
      allowed.has(s.name.toLowerCase().trim()),
    );
  }, [selectedExam, assignments, selectedStudent]);

  // When exam or student changes, fetch any existing report so saved marks
  // pre-fill the inputs.
  React.useEffect(() => {
    if (!selectedExamId || !selectedStudentId) return;
    let cancelled = false;
    (async () => {
      try {
        const report = await resultsApi.get(selectedExamId, selectedStudentId);
        if (cancelled) return;
        setSavedReport(report);
        const marks: Record<string, { theory: string; practical: string }> = {};
        for (const r of report.results) {
          marks[r.subjectId] = {
            theory: r.theoryMarks.toString(),
            practical: r.practicalMarks.toString(),
          };
        }
        setMarksByStudent((prev) => ({ ...prev, [selectedStudentId]: marks }));
      } catch {
        // 404 = no results yet; that's fine, leave inputs empty.
        if (!cancelled) setSavedReport(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedExamId, selectedStudentId]);

  const currentMarks = marksByStudent[selectedStudentId] ?? {};

  const setMark = (
    subjectId: string,
    component: "theory" | "practical",
    value: string,
  ) => {
    setMarksByStudent((prev) => {
      const forStudent = prev[selectedStudentId] ?? {};
      const forSubject = forStudent[subjectId] ?? { theory: "", practical: "" };
      return {
        ...prev,
        [selectedStudentId]: {
          ...forStudent,
          [subjectId]: { ...forSubject, [component]: value },
        },
      };
    });
  };

  const handleCreateExam = async (name: string) => {
    try {
      const created = await examsApi.create({ name });
      setExams((prev) => (prev ? [{ ...created, subjects: [] }, ...prev] : [{ ...created, subjects: [] }]));
      setSelectedExamId(created.id);
      toast.success(`Created "${created.name}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create exam.");
    }
  };

  const handleAddSubject = async (
    examId: string,
    name: string,
    theoryFullMarks: number,
    practicalFullMarks: number,
  ) => {
    try {
      const created = await examsApi.addSubject(examId, {
        name,
        theoryFullMarks,
        practicalFullMarks,
      });
      setExams((prev) =>
        prev
          ? prev.map((e) =>
              e.id === examId
                ? {
                    ...e,
                    subjects: [...e.subjects, created].sort((a, b) =>
                      a.name.localeCompare(b.name),
                    ),
                  }
                : e,
            )
          : prev,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to add subject.");
    }
  };

  const handleRemoveSubject = async (subject: ExamSubjectDto) => {
    try {
      await examsApi.removeSubject(subject.id);
      setExams((prev) =>
        prev
          ? prev.map((e) =>
              e.id === subject.examId
                ? { ...e, subjects: e.subjects.filter((s) => s.id !== subject.id) }
                : e,
            )
          : prev,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove subject.");
    }
  };

  const handleSave = async () => {
    if (!selectedExam || !selectedStudentId) return;
    // Only submit marks for subjects the teacher is allowed to grade.
    // Admins see every subject (visibleExamSubjects === selectedExam.subjects).
    const entries = visibleExamSubjects
      .map((s) => {
        const raw = currentMarks[s.id];
        if (!raw) return null;
        const theory = raw.theory === "" ? null : Number(raw.theory);
        const practical = raw.practical === "" ? 0 : Number(raw.practical);
        if (theory === null || Number.isNaN(theory) || Number.isNaN(practical)) {
          return null;
        }
        return {
          subjectId: s.id,
          theoryMarks: theory,
          practicalMarks: practical,
        };
      })
      .filter(
        (x): x is { subjectId: string; theoryMarks: number; practicalMarks: number } =>
          x !== null,
      );

    if (entries.length === 0) {
      toast.error("Enter at least one subject's theory marks before saving.");
      return;
    }

    setSaving(true);
    try {
      const report = await resultsApi.save({
        examId: selectedExam.id,
        studentId: selectedStudentId,
        entries,
      });
      setSavedReport(report);
      toast.success(
        `Saved — GPA ${report.gpa.toFixed(2)} (${report.overallLetterGradeLabel})`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save marks.");
    } finally {
      setSaving(false);
    }
  };

  // Live preview computed client-side from the marks currently in inputs.
  // Iterates only the subjects the teacher is allowed to grade — same
  // set the save action will submit.
  const livePreview = React.useMemo(() => {
    if (!selectedExam) return null;
    const rows = visibleExamSubjects.map((s) => {
      const raw = currentMarks[s.id] ?? { theory: "", practical: "" };
      const theoryStr = raw.theory;
      const practicalStr = raw.practical;

      const hasTheory = theoryStr !== "";
      const theoryN = hasTheory ? Number(theoryStr) : NaN;
      const practicalN = practicalStr === "" ? 0 : Number(practicalStr);

      const theoryValid =
        hasTheory &&
        !Number.isNaN(theoryN) &&
        theoryN >= 0 &&
        theoryN <= s.theoryFullMarks;
      const practicalValid =
        !Number.isNaN(practicalN) &&
        practicalN >= 0 &&
        practicalN <= s.practicalFullMarks;

      const theoryError =
        hasTheory && !theoryValid ? `0–${s.theoryFullMarks}` : undefined;
      const practicalError =
        practicalStr !== "" && !practicalValid
          ? `0–${s.practicalFullMarks}`
          : undefined;

      if (!theoryValid) {
        return {
          subject: s,
          theory: theoryStr,
          practical: practicalStr,
          percentage: null as number | null,
          letterLabel: "—",
          gradePoint: null as number | null,
          failedComponent: false,
          theoryError,
          practicalError,
        };
      }

      const g = gradeWithSplit(
        theoryN,
        s.theoryFullMarks,
        practicalValid ? practicalN : 0,
        s.practicalFullMarks,
      );
      return {
        subject: s,
        theory: theoryStr,
        practical: practicalStr,
        percentage: g.percentage,
        letterLabel: g.letterGradeLabel,
        gradePoint: g.gradePoint,
        failedComponent: g.failedComponent,
        theoryError,
        practicalError,
      };
    });
    const validPoints = rows
      .map((r) => r.gradePoint)
      .filter((gp): gp is number => gp !== null);
    const gpaValue = gpa(validPoints);
    const gpaOverall = overallGrade(gpaValue);
    // NEB rule: any NG subject forces the final result to NG, regardless of GPA.
    const hasFailingSubject = rows.some((r) => r.letterLabel === "NG");
    const overallLabel = hasFailingSubject ? "NG" : gpaOverall.letterGradeLabel;
    return {
      rows,
      gpa: gpaValue,
      overallLabel,
      hasAnyMarks: validPoints.length > 0,
      hasFailingSubject,
    };
  }, [selectedExam, currentMarks]);

  const studentName = React.useMemo(() => {
    const s = students.find((s) => s.id === selectedStudentId);
    return s ? `${s.firstName} ${s.lastName}` : "";
  }, [students, selectedStudentId]);

  const noStudents = !loading && students.length === 0;
  const noExams = !loading && exams?.length === 0;

  return (
    <div className="space-y-6">
      <Header onRefresh={refresh} />

      {loading ? (
        <ExamsSkeleton />
      ) : error ? (
        <ErrorBanner message={error} onRetry={refresh} />
      ) : (
        <>
          <QuickCreateExam onSubmit={handleCreateExam} />

          {noExams ? (
            <div className="glass rounded-xl">
              <EmptyState
                icon={<ClipboardList className="h-10 w-10" strokeWidth={1.5} />}
                title="Create your first exam"
                description="Add an exam (e.g. Mid-term 2025), define its subjects, then enter marks to see NEB letter grades and GPA instantly."
              />
            </div>
          ) : (
            <>
              {/* Pickers */}
              <div className="glass rounded-xl p-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <PickerField label="Exam">
                  <select
                    value={selectedExamId}
                    onChange={(e) => setSelectedExamId(e.target.value)}
                    className={pickerClasses}
                  >
                    <option value="">Choose an exam…</option>
                    {exams!.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </PickerField>
                <PickerField label="Student">
                  <select
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    disabled={visibleStudents.length === 0}
                    className={pickerClasses}
                  >
                    <option value="">
                      {visibleStudents.length === 0
                        ? noStudents
                          ? "No students yet"
                          : "No students in your assigned classes"
                        : "Choose a student…"}
                    </option>
                    {visibleStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.firstName} {s.lastName}
                      </option>
                    ))}
                  </select>
                </PickerField>
              </div>

              {!selectedExam ? (
                <div className="glass rounded-xl">
                  <EmptyState
                    icon={<Sparkles className="h-10 w-10" strokeWidth={1.5} />}
                    title="Pick an exam to start"
                    description="Subject list, marks entry, and GPA calculator all show up once an exam is selected."
                  />
                </div>
              ) : (
                <>
                  <SubjectManager
                    exam={selectedExam}
                    onAdd={(name, theoryFullMarks, practicalFullMarks) =>
                      handleAddSubject(
                        selectedExam.id,
                        name,
                        theoryFullMarks,
                        practicalFullMarks,
                      )
                    }
                    onRemove={handleRemoveSubject}
                  />

                  {visibleExamSubjects.length > 0 && !selectedStudentId && (
                    <div className="glass rounded-xl">
                      <EmptyState
                        icon={<BookOpen className="h-10 w-10" strokeWidth={1.5} />}
                        title="Choose a student"
                        description="Pick a student above to enter marks for each subject."
                      />
                    </div>
                  )}

                  {/* When the exam HAS subjects but the teacher's filter
                      removes them all FOR THE PICKED STUDENT'S CLASS,
                      show a class-specific message instead of a blank
                      marks pane. Only fires once a student is selected
                      — before that the "Choose a student" empty state
                      above is the right call. Admins never hit this. */}
                  {selectedStudentId &&
                    selectedExam.subjects.length > 0 &&
                    visibleExamSubjects.length === 0 && (
                      <div className="glass rounded-xl">
                        <EmptyState
                          icon={
                            <AlertCircle
                              className="h-10 w-10"
                              strokeWidth={1.5}
                            />
                          }
                          title="No subjects assigned for this class"
                          description="You don't have a subject assignment that covers this student's class and section. Ask your admin to assign you the subject(s) you teach for this class."
                        />
                      </div>
                    )}

                  {visibleExamSubjects.length > 0 &&
                    selectedStudentId &&
                    livePreview && (
                      <MarksTable
                        studentName={studentName}
                        rows={livePreview.rows}
                        setMark={setMark}
                        gpa={livePreview.gpa}
                        overallLabel={livePreview.overallLabel}
                        hasAnyMarks={livePreview.hasAnyMarks}
                        hasFailingSubject={livePreview.hasFailingSubject}
                        saving={saving}
                        onSave={handleSave}
                        savedReport={savedReport}
                      />
                    )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Exams
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter marks and see Nepal NEB letter grades and GPA instantly.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Bulk marks entry — alternative workflow for entering one
            subject across an entire class at once. Per-student entry
            on this page is unchanged. */}
        <Link
          href="/exams/bulk"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100 transition-colors focus-ring"
        >
          <Users className="h-3.5 w-3.5" />
          Bulk marks entry
        </Link>
        {/* Class result sheet — printable A4 landscape ledger of every
            student in a class for a given exam. Opens in a new tab so
            unsaved marks on this page aren't lost. */}
        <Link
          href="/results/ledger"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground shadow-xs hover:border-primary/40 hover:text-primary transition-colors focus-ring"
        >
          <FileText className="h-3.5 w-3.5" />
          Result Sheet
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}

function QuickCreateExam({
  onSubmit,
}: {
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const [value, setValue] = React.useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const name = value.trim();
        if (!name) return;
        setValue("");
        void onSubmit(name);
      }}
      className="relative max-w-xl animate-fade-in"
    >
      <Plus
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary"
        strokeWidth={2.5}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="New exam, e.g. Mid-term 2025…"
        className={cn(
          "h-11 w-full rounded-lg border border-border/80 bg-surface/80 backdrop-blur-md",
          "pl-9 pr-28 text-sm font-medium text-foreground",
          "placeholder:text-muted-foreground/80 placeholder:font-normal",
          "transition-all duration-150 shadow-xs",
          "hover:border-border",
          "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary focus:bg-surface",
        )}
      />
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>Press</span>
        <kbd className="inline-flex items-center rounded border border-border bg-surface px-1.5 py-0.5 font-medium shadow-xs">
          ↵
        </kbd>
      </div>
    </form>
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
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

const pickerClasses = cn(
  "h-10 w-full rounded-md border border-border bg-surface px-3 text-sm",
  "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
  "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
  "transition-colors",
);

// ---------------------------------------------------------------------------

function SubjectManager({
  exam,
  onAdd,
  onRemove,
}: {
  exam: ExamDto;
  onAdd: (
    name: string,
    theoryFullMarks: number,
    practicalFullMarks: number,
  ) => void | Promise<void>;
  onRemove: (subject: ExamSubjectDto) => void | Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [theory, setTheory] = React.useState("75");
  const [practical, setPractical] = React.useState("25");

  const submit = () => {
    const n = name.trim();
    const t = Number(theory);
    const p = Number(practical);
    if (!n || !Number.isFinite(t) || t < 1) return;
    if (!Number.isFinite(p) || p < 0) return;
    setName("");
    setTheory("75");
    setPractical("25");
    void onAdd(n, t, p);
  };

  return (
    <div className="glass rounded-xl p-5 animate-fade-in-up">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-md font-semibold tracking-tight text-foreground">
          Subjects in {exam.name}
        </h3>
        <p className="text-sm text-muted-foreground">
          {exam.subjects.length} subject{exam.subjects.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {exam.subjects.map((s) => (
          <span
            key={s.id}
            className="group inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-xs"
          >
            <span className="flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
              <span>Th/{s.theoryFullMarks}</span>
              {s.practicalFullMarks > 0 && (
                <>
                  <span className="text-primary/40">+</span>
                  <span>Pr/{s.practicalFullMarks}</span>
                </>
              )}
            </span>
            {s.name}
            <button
              type="button"
              onClick={() => onRemove(s)}
              aria-label={`Remove ${s.name}`}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="inline-flex flex-wrap items-center gap-2"
        >
          <input
            type="text"
            placeholder="Subject name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 w-40 rounded-full border border-primary/40 bg-surface px-2.5 text-xs font-medium text-foreground placeholder:text-muted-foreground/70 placeholder:font-normal shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          />
          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 shadow-xs">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Th</span>
            <input
              type="number"
              min={1}
              max={1000}
              placeholder="75"
              value={theory}
              onChange={(e) => setTheory(e.target.value)}
              aria-label="Theory full marks"
              className="h-6 w-12 bg-transparent text-center text-xs font-medium text-foreground focus:outline-none"
            />
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pr</span>
            <input
              type="number"
              min={0}
              max={1000}
              placeholder="25"
              value={practical}
              onChange={(e) => setPractical(e.target.value)}
              aria-label="Practical full marks"
              className="h-6 w-12 bg-transparent text-center text-xs font-medium text-foreground focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary transition-all focus-ring"
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} />
            Add
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface MarksRow {
  subject: ExamSubjectDto;
  theory: string;
  practical: string;
  percentage: number | null;
  letterLabel: string;
  gradePoint: number | null;
  failedComponent: boolean;
  theoryError?: string;
  practicalError?: string;
}

function SplitMarksInput({
  value,
  max,
  full,
  onChange,
  error,
}: {
  value: string;
  max: number;
  full: number;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <div className="inline-flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className={cn(
            "h-9 w-16 rounded-md border bg-surface px-2 text-center text-sm font-medium tabular-nums",
            "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
            "transition-all duration-150",
            error ? "border-destructive/60" : "border-border",
          )}
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          / {full}
        </span>
      </div>
      {error && <div className="text-[10px] text-destructive">{error}</div>}
    </div>
  );
}

function MarksTable({
  studentName,
  rows,
  setMark,
  gpa: gpaValue,
  overallLabel,
  hasAnyMarks,
  hasFailingSubject,
  saving,
  onSave,
  savedReport,
}: {
  studentName: string;
  rows: MarksRow[];
  setMark: (
    subjectId: string,
    component: "theory" | "practical",
    value: string,
  ) => void;
  gpa: number;
  overallLabel: string;
  hasAnyMarks: boolean;
  hasFailingSubject: boolean;
  saving: boolean;
  onSave: () => void | Promise<void>;
  savedReport: StudentReport | null;
}) {
  return (
    <div className="animate-fade-in-up space-y-4">
      <div className="glass rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-3">
          <div>
            <h3 className="text-md font-semibold tracking-tight text-foreground">
              Marks for {studentName}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Grades update as you type. Save to persist.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {savedReport && (
              <>
                <Link
                  href={`/marksheet/${savedReport.examId}/${savedReport.studentId}`}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary/40 hover:text-primary transition-colors shadow-xs"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View marksheet
                </Link>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                  Last saved · GPA {savedReport.gpa.toFixed(2)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="bg-muted/30">
                <Th className="rounded-tl-xl">Subject</Th>
                <Th className="text-center">
                  Theory
                  <div className="text-[9px] font-normal normal-case tracking-normal text-muted-foreground/80">
                    marks / full
                  </div>
                </Th>
                <Th className="text-center">
                  Practical
                  <div className="text-[9px] font-normal normal-case tracking-normal text-muted-foreground/80">
                    marks / full
                  </div>
                </Th>
                <Th className="text-center">Combined %</Th>
                <Th className="text-center">Grade</Th>
                <Th className="text-center rounded-tr-xl">Grade point</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const isLast = idx === rows.length - 1;
                const hasPractical = r.subject.practicalFullMarks > 0;
                const gradeClass =
                  r.letterLabel === "NG"
                    ? "text-destructive"
                    : r.letterLabel === "—"
                      ? "text-muted-foreground/50"
                      : "text-foreground";
                return (
                  <tr
                    key={r.subject.id}
                    className={cn(
                      r.failedComponent && "bg-destructive/[0.03]",
                    )}
                  >
                    <Td
                      className={cn(
                        "border-t border-border/50",
                        isLast && "rounded-bl-xl",
                      )}
                    >
                      <span className="font-medium">{r.subject.name}</span>
                      {!hasPractical && (
                        <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          theory-only
                        </span>
                      )}
                    </Td>
                    <Td className="border-t border-border/50 text-center">
                      <SplitMarksInput
                        value={r.theory}
                        max={r.subject.theoryFullMarks}
                        full={r.subject.theoryFullMarks}
                        onChange={(v) => setMark(r.subject.id, "theory", v)}
                        error={r.theoryError}
                      />
                    </Td>
                    <Td className="border-t border-border/50 text-center">
                      {hasPractical ? (
                        <SplitMarksInput
                          value={r.practical}
                          max={r.subject.practicalFullMarks}
                          full={r.subject.practicalFullMarks}
                          onChange={(v) =>
                            setMark(r.subject.id, "practical", v)
                          }
                          error={r.practicalError}
                        />
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </Td>
                    <Td className="border-t border-border/50 text-center text-muted-foreground tabular-nums">
                      {r.percentage !== null
                        ? `${r.percentage.toFixed(1)}%`
                        : "—"}
                    </Td>
                    <Td
                      className={cn(
                        "border-t border-border/50 text-center font-semibold",
                        gradeClass,
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {r.letterLabel}
                        {r.failedComponent && (
                          <span
                            title="Failed a component (below 35%)"
                            className="text-[10px] font-normal normal-case tracking-normal text-destructive/80"
                          >
                            — failed component
                          </span>
                        )}
                      </span>
                    </Td>
                    <Td
                      className={cn(
                        "border-t border-border/50 text-center tabular-nums",
                        isLast && "rounded-br-xl",
                        r.gradePoint === null
                          ? "text-muted-foreground/50"
                          : "text-foreground",
                      )}
                    >
                      {r.gradePoint !== null ? r.gradePoint.toFixed(1) : "—"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* NEB failing-subject banner */}
      {hasFailingSubject && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/[0.08] p-4 flex items-start gap-3 animate-fade-in-up">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <div>
            <p className="text-sm font-semibold text-destructive">
              Result not graded due to failing subject
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Student has not passed all subjects. Under NEB rules, the final
              result is <span className="font-semibold text-destructive">NG</span>{" "}
              regardless of GPA.
            </p>
          </div>
        </div>
      )}

      {/* GPA / Final result footer */}
      <div
        className={cn(
          "glass rounded-xl p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
          "transition-colors duration-500",
          hasFailingSubject
            ? "border-destructive/30 bg-destructive/[0.04]"
            : hasAnyMarks &&
                "border-primary/30 bg-gradient-to-br from-primary/[0.06] to-purple-500/[0.04]",
        )}
      >
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-xl transition-colors",
              hasFailingSubject
                ? "bg-destructive text-destructive-foreground shadow-md shadow-destructive/20"
                : hasAnyMarks
                  ? "bg-gradient-to-br from-primary-500 to-purple-500 text-white shadow-md shadow-primary/20"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {hasFailingSubject ? (
              <AlertTriangle className="h-6 w-6" strokeWidth={2.25} />
            ) : (
              <Trophy className="h-6 w-6" strokeWidth={2.25} />
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {hasFailingSubject ? "Final result" : "Grade point average"}
            </p>
            <p className="flex items-baseline gap-2.5">
              {hasFailingSubject ? (
                <>
                  <span className="text-3xl font-semibold tracking-tight text-destructive">
                    NG
                  </span>
                  <span className="text-sm text-muted-foreground line-through tabular-nums">
                    GPA {gpaValue.toFixed(2)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                    {hasAnyMarks ? gpaValue.toFixed(2) : "—"}
                  </span>
                  {hasAnyMarks && (
                    <span className="text-sm font-semibold text-primary">
                      {overallLabel}
                    </span>
                  )}
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasFailingSubject
                ? "GPA shown for reference only — not a passing result."
                : "Simple average of subject grade points."}
            </p>
          </div>
        </div>

        <Button
          onClick={onSave}
          loading={saving}
          leftIcon={<Save className="h-4 w-4" />}
          className={cn(
            "transition-all hover:-translate-y-px",
            hasFailingSubject
              ? "shadow-md shadow-destructive/10 hover:shadow-lg hover:shadow-destructive/20"
              : "shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30",
          )}
          size="lg"
        >
          Save marks
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

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

function ExamsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-11 w-80 rounded-lg" />
      <div className="glass rounded-xl p-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <div className="glass rounded-xl p-5 space-y-3">
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
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
    <div className="glass rounded-xl p-6 flex items-start gap-4 border-destructive/20">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <h3 className="text-md font-semibold tracking-tight text-foreground">
          Couldn&apos;t load exams
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

// ---------------------------------------------------------------------------
// Teacher-scope filtering helpers
// ---------------------------------------------------------------------------

/**
 * Restrict the student list to those a TEACHER can grade. ADMIN passes
 * `assignments = null` to get the unfiltered list. A student is in
 * scope when they're covered by at least one of the teacher's
 * assignments using the same coverage rule the backend enforces:
 *   • section-bound assignment → student.sectionId must match
 *   • class-bound assignment   → student.classId === assignment.classId
 *                                OR student.section.class.id === ...
 */
function filterStudentsByAssignments(
  students: StudentDto[],
  assignments: TeachingAssignmentDto[] | null,
): StudentDto[] {
  if (assignments === null) return students;
  if (assignments.length === 0) return [];

  const sectionIds = new Set<string>();
  const classIds = new Set<string>();
  for (const a of assignments) {
    if (a.sectionId) sectionIds.add(a.sectionId);
    else classIds.add(a.classId);
  }

  return students.filter((s) => {
    if (s.sectionId && sectionIds.has(s.sectionId)) return true;
    if (s.classId && classIds.has(s.classId)) return true;
    if (s.section && classIds.has(s.section.class.id)) return true;
    return false;
  });
}

/**
 * Set of subject names the teacher is allowed to grade FOR THIS
 * SPECIFIC STUDENT. Mirrors the backend's `assertResultsEntryAccess`
 * rule exactly — anything the UI surfaces here will pass server-side
 * validation; anything stripped here would 403 on save.
 *
 * Rule:
 *   keep assignments where
 *     classId === student's effective classId
 *     AND (sectionId === student.sectionId OR BOTH null)
 *     AND subject !== null
 *
 * Then return the lowercase-trimmed set of subject names. Empty set
 * means "no subjects allowed for this class+section" — the UI shows
 * the "No subjects assigned for this class" empty state.
 *
 * Caller is responsible for skipping this when no student is picked
 * (we'd return an empty set, which is misleading).
 */
function allowedSubjectNamesForStudent(
  assignments: TeachingAssignmentDto[],
  student: StudentDto,
): Set<string> {
  // Effective class: prefer direct classId, fall back to the section's
  // parent class. Mirrors the backend's resolution.
  const studentClassId =
    student.classId ?? student.section?.class.id ?? null;
  if (!studentClassId) return new Set();
  const studentSectionId = student.sectionId ?? null;

  const matching = assignments.filter(
    (a) =>
      a.classId === studentClassId &&
      (a.sectionId ?? null) === studentSectionId &&
      a.subject !== null,
  );

  return new Set(
    matching.map((a) => a.subject!.name.toLowerCase().trim()),
  );
}

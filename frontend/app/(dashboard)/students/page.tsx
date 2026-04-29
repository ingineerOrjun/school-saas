"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, UserPlus, RotateCw, AlertCircle, Filter, Upload } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { studentsApi, type StudentDto } from "@/lib/students";
import { classesApi, type ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { StudentTable } from "@/components/students/StudentTable";
import { AddStudentDialog } from "@/components/students/AddStudentDialog";
import { EditStudentDialog } from "@/components/students/EditStudentDialog";
import { DeleteStudentDialog } from "@/components/students/DeleteStudentDialog";
import { QuickAddStudent } from "@/components/students/QuickAddStudent";
import { ImportStudentsDialog } from "@/components/students/ImportStudentsDialog";
import {
  formatStudentAssignment,
  type Assignment,
} from "@/components/students/SectionSelect";
import { cn } from "@/lib/utils";

/** Sentinel value for "all classes" in the filter dropdown. */
const CLASS_FILTER_ALL = "__all__";
/** Sentinel value for "no class assigned" in the filter dropdown. */
const CLASS_FILTER_UNASSIGNED = "__unassigned__";

const HIGHLIGHT_MS = 1800;
// Must match `animate-row-remove` duration in tailwind config.
const ROW_REMOVE_MS = 180;
// How long the user has to click "Undo" before the deletion hits the backend.
const UNDO_WINDOW_MS = 5000;

interface PendingDeletion {
  student: StudentDto;
  /** Removes the row from the list after the exit animation. */
  animTimeoutId: number;
  /** Fires the actual DELETE /students/:id after the undo window. */
  apiTimeoutId: number;
}

export default function StudentsPage() {
  const router = useRouter();
  const [list, setList] = React.useState<StudentDto[] | null>(null);
  const [classes, setClasses] = React.useState<ClassWithSections[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [classFilter, setClassFilter] = React.useState<string>(CLASS_FILTER_ALL);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<StudentDto | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<StudentDto | null>(null);
  const [highlightIds, setHighlightIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [assigningIds, setAssigningIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const pendingDeletesRef = React.useRef<Map<string, PendingDeletion>>(
    new Map(),
  );

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [students, classList] = await Promise.all([
        studentsApi.list(),
        classesApi.list(),
      ]);
      setList(students);
      setClasses(classList);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load students.";
      setError(msg);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = React.useMemo(() => {
    if (!list) return [];
    const q = query.trim().toLowerCase();

    return list.filter((s) => {
      // Class filter is applied client-side so switching between classes
      // is instant. For very large rosters we could switch to refetching
      // the list with `?classId=` instead — the API already supports it.
      if (classFilter === CLASS_FILTER_UNASSIGNED) {
        if (s.classId !== null) return false;
      } else if (classFilter !== CLASS_FILTER_ALL) {
        if (s.classId !== classFilter) return false;
      }

      if (!q) return true;
      return `${s.firstName} ${s.lastName}`.toLowerCase().includes(q);
    });
  }, [list, query, classFilter]);

  const isEmpty = !loading && !error && (list?.length ?? 0) === 0;
  const hasItems = !loading && !error && (list?.length ?? 0) > 0;
  const noResults = hasItems && filtered.length === 0;

  // Optimistic local mutations — keep the UI snappy without waiting for refetch
  const upsertLocal = (s: StudentDto) =>
    setList((prev) => {
      if (!prev) return [s];
      const idx = prev.findIndex((p) => p.id === s.id);
      if (idx === -1) return [s, ...prev];
      const next = prev.slice();
      next[idx] = s;
      return next;
    });

  // Flash a row's background briefly after create/update.
  const markAsNew = React.useCallback((id: string) => {
    setHighlightIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setHighlightIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, HIGHLIGHT_MS);
  }, []);

  // Restore a student after undo (or after a post-window API failure).
  // Re-inserts into the list at the correct position and flashes the row.
  const restoreStudent = React.useCallback(
    (student: StudentDto) => {
      setList((prev) => {
        if (!prev) return [student];
        if (prev.some((s) => s.id === student.id)) return prev;
        return [...prev, student].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      });
      // If undo happened mid-exit-animation, stop the exit state.
      setRemovingIds((prev) => {
        if (!prev.has(student.id)) return prev;
        const next = new Set(prev);
        next.delete(student.id);
        return next;
      });
      markAsNew(student.id);
    },
    [markAsNew],
  );

  // Kick off a deletion: exit animation now, API call after the undo window.
  const scheduleDelete = React.useCallback(
    (student: StudentDto) => {
      const id = student.id;

      // Phase 1: exit animation begins immediately.
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      // Phase 2: after animation completes, drop the row from local state.
      const animTimeoutId = window.setTimeout(() => {
        setList((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
        setRemovingIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, ROW_REMOVE_MS);

      // Phase 3: after the undo window, call the backend for real.
      const apiTimeoutId = window.setTimeout(() => {
        pendingDeletesRef.current.delete(id);
        studentsApi.remove(id).catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            router.replace("/login");
            return;
          }
          // Backend failed after the undo window — restore the row so the user
          // doesn't lose data silently.
          restoreStudent(student);
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to delete student.";
          toast.error(
            `${student.firstName} ${student.lastName} restored — ${msg}`,
          );
        });
      }, UNDO_WINDOW_MS);

      pendingDeletesRef.current.set(id, {
        student,
        animTimeoutId,
        apiTimeoutId,
      });

      toast(`${student.firstName} ${student.lastName} deleted`, {
        description: "Tap undo to bring them back.",
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => undoDelete(id),
        },
      });
    },
    // `undoDelete` is intentionally referenced from the same render scope here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, restoreStudent],
  );

  // Cancel a pending deletion within the undo window.
  const undoDelete = React.useCallback(
    (id: string) => {
      const pending = pendingDeletesRef.current.get(id);
      if (!pending) return;
      clearTimeout(pending.animTimeoutId);
      clearTimeout(pending.apiTimeoutId);
      pendingDeletesRef.current.delete(id);
      restoreStudent(pending.student);
      toast.success(
        `${pending.student.firstName} ${pending.student.lastName} restored`,
      );
    },
    [restoreStudent],
  );

  // On unmount: flush pending deletes so the user's intent isn't dropped.
  React.useEffect(() => {
    const pending = pendingDeletesRef.current;
    return () => {
      pending.forEach(({ student, animTimeoutId, apiTimeoutId }) => {
        clearTimeout(animTimeoutId);
        clearTimeout(apiTimeoutId);
        studentsApi.remove(student.id).catch(() => {
          /* fire-and-forget on unmount */
        });
      });
      pending.clear();
    };
  }, []);

  const handleCreated = (s: StudentDto) => {
    upsertLocal(s);
    markAsNew(s.id);
  };

  const handleUpdated = (s: StudentDto) => {
    upsertLocal(s);
    markAsNew(s.id);
  };

  const resolveAssignment = React.useCallback(
    (assignment: Assignment) => {
      const klass = assignment.classId
        ? classes.find((c) => c.id === assignment.classId) ?? null
        : null;
      const section =
        klass && assignment.sectionId
          ? klass.sections.find((s) => s.id === assignment.sectionId) ?? null
          : null;
      return {
        class: klass
          ? {
              id: klass.id,
              name: klass.name,
              schoolId: klass.schoolId,
              createdAt: klass.createdAt,
              updatedAt: klass.updatedAt,
            }
          : null,
        section:
          section && klass
            ? {
                ...section,
                class: {
                  id: klass.id,
                  name: klass.name,
                  schoolId: klass.schoolId,
                  createdAt: klass.createdAt,
                  updatedAt: klass.updatedAt,
                },
              }
            : null,
      };
    },
    [classes],
  );

  const handleAssignSection = React.useCallback(
    async (student: StudentDto, assignment: Assignment) => {
      const previousStudent = list?.find((item) => item.id === student.id) ?? null;
      const optimistic = resolveAssignment(assignment);

      setAssigningIds((prev) => {
        const next = new Set(prev);
        next.add(student.id);
        return next;
      });

      setList((prev) =>
        prev
          ? prev.map((item) =>
              item.id === student.id
                ? {
                    ...item,
                    classId: assignment.classId,
                    class: optimistic.class,
                    sectionId: assignment.sectionId,
                    section: optimistic.section,
                  }
                : item,
            )
          : prev,
      );

      try {
        const updated = await studentsApi.update(student.id, {
          classId: assignment.classId,
          sectionId: assignment.sectionId,
        });
        upsertLocal(updated);
        toast.success(`${updated.firstName} ${updated.lastName} reassigned`, {
          description: `Assignment: ${formatStudentAssignment(updated)}`,
        });
      } catch (err) {
        if (previousStudent) {
          setList((prev) =>
            prev
              ? prev.map((item) =>
                  item.id === previousStudent.id ? previousStudent : item,
                )
              : prev,
          );
        }
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to update section.";
        toast.error(msg);
      } finally {
        setAssigningIds((prev) => {
          if (!prev.has(student.id)) return prev;
          const next = new Set(prev);
          next.delete(student.id);
          return next;
        });
      }
    },
    [list, resolveAssignment, router],
  );

  // Quick-add now ROUTES into the full Add Student dialog with the
  // typed name pre-filled. We can't optimistic-create anymore because
  // the schema requires gender / DOB / parent name / contact, which we
  // can only collect through the full form. The dialog still feels fast
  // because the names are already typed.
  const [quickAddPrefill, setQuickAddPrefill] = React.useState<{
    firstName: string;
    lastName: string;
  } | null>(null);
  const handleQuickAdd = async (firstName: string, lastName: string) => {
    setQuickAddPrefill({ firstName, lastName });
    setAddOpen(true);
  };

  // Legacy optimistic-create implementation, kept as a no-op so the rest
  // of the file compiles unchanged. The block below is intentionally
  // unreachable — it documents what the previous flow did.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _legacyQuickAdd = async (firstName: string, lastName: string) => {
    const tempId = `temp_${makeTempSuffix()}`;
    const now = new Date().toISOString();
    const optimistic: StudentDto = {
      id: tempId,
      firstName,
      lastName,
      symbolNumber: null,
      schoolId: "",
      userId: null,
      classId: null,
      class: null,
      sectionId: null,
      section: null,
      gender: "OTHER",
      dateOfBirth: now,
      parentName: "",
      contactNumber: "",
      address: null,
      admissionDate: null,
      createdAt: now,
      updatedAt: now,
    };

    setList((prev) => (prev ? [optimistic, ...prev] : [optimistic]));

    try {
      // This call would now fail — required fields missing. Kept here
      // only so the larger function remains structurally untouched.
      const real = await studentsApi.create({
        firstName,
        lastName,
        gender: "OTHER",
        dateOfBirth: now,
        parentName: "",
        contactNumber: "",
      });
      setList((prev) =>
        prev ? prev.map((s) => (s.id === tempId ? real : s)) : [real],
      );
      markAsNew(real.id);
      toast.success(`${real.firstName} ${real.lastName} enrolled`, {
        description: "Open the row to add class, parent email, and more.",
      });
    } catch (err) {
      // Rollback the optimistic row
      setList((prev) => (prev ? prev.filter((s) => s.id !== tempId) : prev));
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to add student.";
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-6">
      <Header
        count={list?.length ?? 0}
        loading={loading}
        onAdd={() => setAddOpen(true)}
        onImport={() => setImportOpen(true)}
        onRefresh={refresh}
      />

      {/* Quick add + search + filter — only visible when we have students */}
      {hasItems && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_320px]">
          <QuickAddStudent onSubmit={handleQuickAdd} />
          <div className="flex items-center gap-2 animate-fade-in">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search by name…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn(
                  "h-11 w-full rounded-lg border border-border bg-surface/80 backdrop-blur-md pl-9 pr-3 text-sm",
                  "placeholder:text-muted-foreground/80",
                  "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
                  "transition-colors",
                )}
              />
            </div>
            <ClassFilter
              classes={classes}
              value={classFilter}
              onChange={setClassFilter}
            />
          </div>
        </div>
      )}

      {/* Content — keyed wrapper so state changes crossfade via animate-fade-in-up */}
      <div
        key={
          loading
            ? "loading"
            : error
              ? "error"
              : isEmpty
                ? "empty"
                : noResults
                  ? "no-results"
                  : "ready"
        }
        className="animate-fade-in-up"
      >
        {loading && <TableLoading />}

        {!loading && error && (
          <ErrorBanner message={error} onRetry={refresh} />
        )}

        {isEmpty && (
          <div className="glass rounded-xl">
            <EmptyState
              icon={<UserPlus className="h-10 w-10" strokeWidth={1.5} />}
              title="Add your first student"
              description="Bring your roster online. Students appear here the moment you enroll them — you can update or remove them any time."
              action={{
                label: "Add your first student",
                icon: <Plus className="h-4 w-4" />,
                onClick: () => setAddOpen(true),
              }}
            />
          </div>
        )}

        {hasItems && !noResults && (
          <StudentTable
            students={filtered}
            classes={classes}
            onEdit={setEditTarget}
            onDelete={setDeleteTarget}
            onAssignSection={handleAssignSection}
            highlightIds={highlightIds}
            removingIds={removingIds}
            assigningIds={assigningIds}
          />
        )}

        {noResults && (
          <div className="glass rounded-xl">
            <EmptyState
              icon={<Search className="h-10 w-10" strokeWidth={1.5} />}
              title="No matches"
              description={describeNoResults(query, classFilter, classes)}
              action={{
                label:
                  classFilter !== CLASS_FILTER_ALL
                    ? "Clear filters"
                    : "Clear search",
                onClick: () => {
                  setQuery("");
                  setClassFilter(CLASS_FILTER_ALL);
                },
              }}
            />
          </div>
        )}
      </div>

      <AddStudentDialog
        open={addOpen}
        classes={classes}
        initialFirstName={quickAddPrefill?.firstName}
        initialLastName={quickAddPrefill?.lastName}
        onClose={() => {
          setAddOpen(false);
          setQuickAddPrefill(null);
        }}
        onCreated={(s) => {
          setQuickAddPrefill(null);
          handleCreated(s);
        }}
      />
      <EditStudentDialog
        student={editTarget}
        classes={classes}
        onClose={() => setEditTarget(null)}
        onUpdated={handleUpdated}
      />
      <DeleteStudentDialog
        student={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={scheduleDelete}
      />
      <ImportStudentsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(r) => {
          // Refresh the roster after even one row lands. Leave the
          // dialog open so the user can review the per-row outcome
          // before closing manually.
          if (r.success > 0) refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({
  count,
  loading,
  onAdd,
  onImport,
  onRefresh,
}: {
  count: number;
  loading: boolean;
  onAdd: () => void;
  onImport: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Students
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Skeleton className="inline-block h-3 w-28" />
            </span>
          ) : count === 0 ? (
            "Your roster is empty — let's change that."
          ) : (
            <>
              Manage all{" "}
              <span className="font-medium text-foreground">{count}</span>{" "}
              {count === 1 ? "student" : "students"} enrolled in your school.
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
        <Button
          variant="outline"
          onClick={onImport}
          leftIcon={<Upload className="h-4 w-4" />}
        >
          Import students
        </Button>
        <Button
          onClick={onAdd}
          leftIcon={<Plus className="h-4 w-4" />}
          className="shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-px transition-all"
        >
          Add student
        </Button>
      </div>
    </div>
  );
}

function ClassFilter({
  classes,
  value,
  onChange,
}: {
  classes: ClassWithSections[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative shrink-0">
      <Filter className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
      <select
        aria-label="Filter by class"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-11 w-[170px] appearance-none rounded-lg border border-border bg-surface/80 backdrop-blur-md pl-8 pr-3 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
          "transition-colors cursor-pointer",
        )}
      >
        <option value={CLASS_FILTER_ALL}>All classes</option>
        <option value={CLASS_FILTER_UNASSIGNED}>Unassigned</option>
        {classes.length > 0 && (
          <optgroup label="Classes">
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

function describeNoResults(
  query: string,
  classFilter: string,
  classes: ClassWithSections[],
): string {
  const trimmed = query.trim();
  const selectedClass =
    classFilter !== CLASS_FILTER_ALL &&
    classFilter !== CLASS_FILTER_UNASSIGNED
      ? classes.find((c) => c.id === classFilter)?.name
      : null;

  if (trimmed && classFilter === CLASS_FILTER_UNASSIGNED) {
    return `No unassigned students match "${trimmed}".`;
  }
  if (trimmed && selectedClass) {
    return `No students named "${trimmed}" in ${selectedClass}.`;
  }
  if (trimmed) {
    return `No students match "${trimmed}". Try a different name or clear the search.`;
  }
  if (classFilter === CLASS_FILTER_UNASSIGNED) {
    return "All your students have been assigned to a class.";
  }
  if (selectedClass) {
    return `No students have been assigned to ${selectedClass} yet.`;
  }
  return "No students match the current filters.";
}

function makeTempSuffix(): string {
  // `crypto.randomUUID` is stable in modern browsers and Node 19+.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function TableLoading() {
  return (
    <div className="glass rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50 bg-muted/30 grid grid-cols-[1fr_140px_140px_80px] gap-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-12 justify-self-end" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="px-4 py-4 border-b border-border/40 last:border-0 grid grid-cols-[1fr_140px_140px_80px] gap-4 items-center"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-16" />
          <div className="flex items-center gap-1 justify-self-end">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
      ))}
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
          Couldn&apos;t load students
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

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  GraduationCap,
  RotateCw,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { teachersApi, useTeachers, type TeacherDto } from "@/lib/teachers";
import { useClasses, type ClassWithSections } from "@/lib/classes";
import { useSubjects, type SubjectDto } from "@/lib/subjects";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/query-keys";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { TeacherTable } from "@/components/teachers/TeacherTable";
import { AddTeacherDialog } from "@/components/teachers/AddTeacherDialog";
import { EditTeacherDialog } from "@/components/teachers/EditTeacherDialog";
import { DeleteTeacherDialog } from "@/components/teachers/DeleteTeacherDialog";
import { AssignmentsDialog } from "@/components/teachers/AssignmentsDialog";
import { cn } from "@/lib/utils";

const HIGHLIGHT_MS = 1800;
const ROW_REMOVE_MS = 180;
const UNDO_WINDOW_MS = 5000;

interface PendingDeletion {
  teacher: TeacherDto;
  animTimeoutId: number;
  apiTimeoutId: number;
}

export default function TeachersPage() {
  const router = useRouter();
  const qc = useQueryClient();
  // Phase γ — three reference datasets via shared hooks. Mounting
  // this page no longer triggers Promise.all of three fetches; the
  // cache (10m+ stale) serves repeat visits + dialog mounts.
  const teachersQuery = useTeachers();
  const classesQuery = useClasses();
  const subjectsQuery = useSubjects();
  const [list, setList] = React.useState<TeacherDto[] | null>(null);
  const classes: ClassWithSections[] = classesQuery.data ?? [];
  const subjects: SubjectDto[] = subjectsQuery.data ?? [];
  const loading = teachersQuery.isLoading;
  const error =
    teachersQuery.error instanceof ApiError
      ? teachersQuery.error.message
      : teachersQuery.error
        ? "Failed to load teachers."
        : null;
  // Mirror query data into local list state for the existing
  // optimistic delete + add-highlight machinery.
  React.useEffect(() => {
    if (teachersQuery.data) setList(teachersQuery.data);
  }, [teachersQuery.data]);
  React.useEffect(() => {
    if (teachersQuery.error instanceof ApiError && teachersQuery.error.status === 401) {
      router.replace("/login");
    }
  }, [teachersQuery.error, router]);
  const [query, setQuery] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<TeacherDto | null>(null);
  // Separate "manage assignments" dialog target — opening this is the
  // multi-row entry point; the Edit dialog still handles the legacy
  // single-class field (used by the login routing flow).
  const [assignmentsTarget, setAssignmentsTarget] =
    React.useState<TeacherDto | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<TeacherDto | null>(
    null,
  );
  const [highlightIds, setHighlightIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const pendingDeletesRef = React.useRef<Map<string, PendingDeletion>>(
    new Map(),
  );

  // Phase γ — refresh now invalidates the shared cache. Other
  // consumers of these query keys (sidebar pickers, assignment
  // dialogs) stay in sync automatically.
  const refresh = React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.teachers() }),
      qc.invalidateQueries({ queryKey: qk.classes() }),
      qc.invalidateQueries({ queryKey: qk.subjects() }),
    ]);
  }, [qc]);

  const filtered = React.useMemo(() => {
    if (!list) return [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => t.name.toLowerCase().includes(q));
  }, [list, query]);

  const isEmpty = !loading && !error && (list?.length ?? 0) === 0;
  const hasItems = !loading && !error && (list?.length ?? 0) > 0;
  const noResults = hasItems && filtered.length === 0;

  const upsertLocal = (t: TeacherDto) =>
    setList((prev) => {
      if (!prev) return [t];
      const idx = prev.findIndex((p) => p.id === t.id);
      if (idx === -1) return [t, ...prev];
      const next = prev.slice();
      next[idx] = t;
      return next;
    });

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

  const restoreTeacher = React.useCallback(
    (teacher: TeacherDto) => {
      setList((prev) => {
        if (!prev) return [teacher];
        if (prev.some((t) => t.id === teacher.id)) return prev;
        return [...prev, teacher].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      });
      setRemovingIds((prev) => {
        if (!prev.has(teacher.id)) return prev;
        const next = new Set(prev);
        next.delete(teacher.id);
        return next;
      });
      markAsNew(teacher.id);
    },
    [markAsNew],
  );

  const scheduleDelete = React.useCallback(
    (teacher: TeacherDto) => {
      const id = teacher.id;

      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      const animTimeoutId = window.setTimeout(() => {
        setList((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
        setRemovingIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, ROW_REMOVE_MS);

      const apiTimeoutId = window.setTimeout(() => {
        pendingDeletesRef.current.delete(id);
        teachersApi.remove(id).catch((err) => {
          if (err instanceof ApiError && err.status === 401) {
            router.replace("/login");
            return;
          }
          restoreTeacher(teacher);
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to delete teacher.";
          toast.error(`${teacher.name} restored — ${msg}`);
        });
      }, UNDO_WINDOW_MS);

      pendingDeletesRef.current.set(id, {
        teacher,
        animTimeoutId,
        apiTimeoutId,
      });

      toast(`${teacher.name} deleted`, {
        description: "Tap undo to bring them back.",
        duration: UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => undoDelete(id),
        },
      });
    },
    [router, restoreTeacher],
  );

  const undoDelete = React.useCallback(
    (id: string) => {
      const pending = pendingDeletesRef.current.get(id);
      if (!pending) return;
      clearTimeout(pending.animTimeoutId);
      clearTimeout(pending.apiTimeoutId);
      pendingDeletesRef.current.delete(id);
      restoreTeacher(pending.teacher);
      toast.success(`${pending.teacher.name} restored`);
    },
    [restoreTeacher],
  );

  React.useEffect(() => {
    const pending = pendingDeletesRef.current;
    return () => {
      pending.forEach(({ teacher, animTimeoutId, apiTimeoutId }) => {
        clearTimeout(animTimeoutId);
        clearTimeout(apiTimeoutId);
        teachersApi.remove(teacher.id).catch(() => {
          /* fire-and-forget on unmount */
        });
      });
      pending.clear();
    };
  }, []);

  const handleCreated = (t: TeacherDto) => {
    upsertLocal(t);
    markAsNew(t.id);
  };

  const handleUpdated = (t: TeacherDto) => {
    upsertLocal(t);
    markAsNew(t.id);
  };

  // QuickAdd has been removed — every teacher must be created via the
  // full Add Teacher dialog so they get a linked User account
  // (createWithUser). Without that link the teacher's dashboard can't
  // resolve their assignments and they're effectively unreachable.

  return (
    <div className="space-y-6">
      <Header
        count={list?.length ?? 0}
        loading={loading}
        onAdd={() => setAddOpen(true)}
        onRefresh={refresh}
      />

      {hasItems && (
        <div className="animate-fade-in">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search faculty…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cn(
                "h-11 w-full rounded-lg border border-border bg-surface/80 backdrop-blur-md pl-9 pr-3 text-sm",
                "placeholder:text-muted-foreground/80",
                "focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500",
                "transition-colors",
              )}
            />
          </div>
        </div>
      )}

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

        {!loading && error && <ErrorBanner message={error} onRetry={refresh} />}

        {isEmpty && (
          <div className="glass rounded-xl">
            <EmptyState
              icon={<GraduationCap className="h-10 w-10" strokeWidth={1.5} />}
              title="Bring your faculty onboard"
              description="Add the teachers who'll run classes, take attendance, and post announcements. You can link login accounts anytime."
              action={{
                label: "Add your first teacher",
                icon: <Plus className="h-4 w-4" />,
                onClick: () => setAddOpen(true),
              }}
            />
          </div>
        )}

        {hasItems && !noResults && (
          <TeacherTable
            teachers={filtered}
            onEdit={setEditTarget}
            onDelete={setDeleteTarget}
            onManageAssignments={setAssignmentsTarget}
            highlightIds={highlightIds}
            removingIds={removingIds}
          />
        )}

        {noResults && (
          <div className="glass rounded-xl">
            <EmptyState
              icon={<Search className="h-10 w-10" strokeWidth={1.5} />}
              title="No matches"
              description={`No faculty match "${query}". Try a different name or clear the search.`}
              action={{
                label: "Clear search",
                onClick: () => setQuery(""),
              }}
            />
          </div>
        )}
      </div>

      <AddTeacherDialog
        open={addOpen}
        classes={classes}
        onClose={() => setAddOpen(false)}
        onCreated={handleCreated}
      />
      <EditTeacherDialog
        teacher={editTarget}
        classes={classes}
        onClose={() => setEditTarget(null)}
        onUpdated={handleUpdated}
      />
      <DeleteTeacherDialog
        teacher={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={scheduleDelete}
      />
      <AssignmentsDialog
        teacher={assignmentsTarget}
        classes={classes}
        subjects={subjects}
        onClose={() => setAssignmentsTarget(null)}
        // Re-pull teachers so each row's `assignmentCounts` (which
        // drives the "X Classes · Y Subjects" / "Unassigned" pill in
        // the table) reflects the just-saved state. Fires after every
        // successful bulk save inside the dialog — admins making
        // several saves before closing get a fresh row each time.
        onSaved={refresh}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({
  count,
  loading,
  onAdd,
  onRefresh,
}: {
  count: number;
  loading: boolean;
  onAdd: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Teachers
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading ? (
            <Skeleton className="inline-block h-3 w-28" />
          ) : count === 0 ? (
            "Your faculty list is empty — bring your staff onboard."
          ) : (
            <>
              Manage your faculty of{" "}
              <span className="font-medium text-foreground">{count}</span>{" "}
              {count === 1 ? "member" : "members"}.
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
        <Button
          onClick={onAdd}
          leftIcon={<Plus className="h-4 w-4" />}
          className="shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-px transition-all"
        >
          Add teacher
        </Button>
      </div>
    </div>
  );
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
          Couldn&apos;t load your faculty
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

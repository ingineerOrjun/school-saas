"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  GraduationCap,
  Layers,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  teachingAssignmentsApi,
  type BulkAssignmentTuple,
  type TeachingAssignmentDto,
} from "@/lib/teaching-assignments";
import type { ClassWithSections } from "@/lib/classes";
import type { SubjectDto } from "@/lib/subjects";
import type { TeacherDto } from "@/lib/teachers";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

export interface AssignmentsDialogProps {
  /** Teacher whose assignments are being managed. Null = dialog closed. */
  teacher: TeacherDto | null;
  classes: ClassWithSections[];
  subjects: SubjectDto[];
  onClose: () => void;
  /**
   * Fired after every successful bulk save so the parent (the
   * `/teachers` table) can refresh its row data and pick up the
   * new `assignmentCounts`. Without this, the table's "Unassigned"
   * red pill stays stuck on the value from the initial list fetch
   * even after the admin ticks cells and saves.
   */
  onSaved?: () => void;
}

/**
 * Class-first assignment editor for a single teacher.
 *
 * Replaces the old "pick subject + class + section, click Add, repeat"
 * form with a visual grid the admin can tick through in seconds:
 *
 *   • Top: chips showing which classes the teacher already touches
 *     (also act as quick-jumps to that class's grid).
 *   • Middle: a class picker + a (subjects × sections) checkbox grid
 *     for the selected class. The first row covers "Whole class (no
 *     subject)"; the first column covers "Whole class (any subject)".
 *     Cells start checked if a matching TeachingAssignment exists.
 *   • Bottom: sticky Save bar that shows the pending diff count and
 *     commits adds + removes in a single transactional bulk call.
 *
 * The grid only edits ONE class at a time. Other classes' assignments
 * are preserved untouched on save — the diff is scoped to the cells
 * the admin actually saw.
 */
export function AssignmentsDialog({
  teacher,
  classes,
  subjects,
  onClose,
  onSaved,
}: AssignmentsDialogProps) {
  const open = teacher !== null;
  const [assignments, setAssignments] = React.useState<
    TeachingAssignmentDto[] | null
  >(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Which class the grid is currently editing. Defaults to the first
  // class the teacher already has assignments in (or the first school
  // class if none) once the load completes.
  const [selectedClassId, setSelectedClassId] = React.useState<string | null>(
    null,
  );

  // Live cell state for the rendered grid: cellKey → checked. Seeded
  // from `assignments` whenever the selected class changes; mutated
  // by the cell checkboxes; diffed against `initialCellState` on save.
  const [cellState, setCellState] = React.useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [initialCellState, setInitialCellState] = React.useState<
    Map<string, boolean>
  >(() => new Map());

  // ---- Initial load when the dialog opens for a new teacher ----
  React.useEffect(() => {
    if (!teacher) {
      setAssignments(null);
      setError(null);
      setSelectedClassId(null);
      setCellState(new Map());
      setInitialCellState(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await teachingAssignmentsApi.listForTeacher(teacher.id);
        if (cancelled) return;
        setAssignments(list);
        // Pick the first class with existing assignments; fall back to
        // the first school class so the grid is never empty when there
        // are classes available.
        const firstAssignedClassId = list[0]?.classId ?? null;
        const firstSchoolClassId = classes[0]?.id ?? null;
        setSelectedClassId(firstAssignedClassId ?? firstSchoolClassId);
      } catch (err) {
        if (cancelled) return;
        setError(extractErrorMessage(err, "Failed to load assignments."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `classes` is intentionally excluded — we only want to seed the
    // class selection on the initial open, not bounce it around if the
    // parent's class list re-renders mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacher]);

  // ---- Re-seed cell state whenever the selected class changes ----
  React.useEffect(() => {
    if (!assignments || !selectedClassId) {
      setCellState(new Map());
      setInitialCellState(new Map());
      return;
    }
    const seed = buildCellMap(assignments, selectedClassId);
    setCellState(new Map(seed));
    setInitialCellState(new Map(seed));
  }, [assignments, selectedClassId]);

  // ---- Derived: counts per class for the chip strip ----
  const countsByClass = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const a of assignments ?? []) {
      m.set(a.classId, (m.get(a.classId) ?? 0) + 1);
    }
    return m;
  }, [assignments]);

  // ---- Derived: the class object currently being edited ----
  const selectedClass = React.useMemo(
    () => classes.find((c) => c.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  // ---- Derived: pending diff (add[] / remove[]) ----
  const diff = React.useMemo(
    () => computeDiff(initialCellState, cellState, selectedClassId),
    [initialCellState, cellState, selectedClassId],
  );
  const pendingCount = diff.add.length + diff.remove.length;
  const isDirty = pendingCount > 0;

  // ---- Handlers ----
  const handleClose = () => {
    if (saving) return;
    if (
      isDirty &&
      !window.confirm(
        `You have ${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"}. Discard and close?`,
      )
    ) {
      return;
    }
    onClose();
  };

  const handleSelectClass = (classId: string) => {
    if (classId === selectedClassId) return;
    if (
      isDirty &&
      !window.confirm(
        `You have ${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"} for the current class. Discard and switch?`,
      )
    ) {
      return;
    }
    setSelectedClassId(classId);
  };

  const toggleCell = (subjectId: string | null, sectionId: string | null) => {
    if (saving) return;
    const key = cellKey(subjectId, sectionId);
    setCellState((prev) => {
      const next = new Map(prev);
      next.set(key, !prev.get(key));
      return next;
    });
  };

  const handleDiscard = () => {
    setCellState(new Map(initialCellState));
  };

  const handleSave = async () => {
    if (!teacher || !isDirty) return;
    setSaving(true);
    try {
      const updated = await teachingAssignmentsApi.bulk(teacher.id, {
        add: diff.add,
        remove: diff.remove,
      });
      setAssignments(updated);
      // Diagnostic — surfaces what the admin's perspective just
      // wrote. Pair this with the teacher-dashboard log to spot
      // mismatches between "what I saved" and "what the teacher's
      // dashboard reads back". Dev-only — silent in production so
      // operator consoles stay clean.
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("Assignments (admin save result):", updated);
      }
      // Re-seed initial state from the just-saved cells so isDirty
      // flips back to false. Server is the source of truth, so we
      // also rebuild from `updated` rather than from cellState — that
      // way any server-side normalization (e.g., dropping stale rows)
      // shows up immediately.
      const fresh = selectedClassId
        ? buildCellMap(updated, selectedClassId)
        : new Map<string, boolean>();
      setCellState(new Map(fresh));
      setInitialCellState(new Map(fresh));
      toast.success(
        pendingCount === 1
          ? "1 change saved"
          : `${pendingCount} changes saved`,
      );

      // Tell the parent so the /teachers table can re-pull and
      // refresh the per-row "X Classes · Y Subjects" pill. Without
      // this the pill stays stuck on the count captured at initial
      // page-load time — admins ticked cells, saved successfully,
      // closed the dialog, and STILL saw the red "Unassigned" pill
      // on the row they'd just assigned.
      onSaved?.();

      // (The diagnostic listMine() call that lived here was removed:
      // api.ts now turns any 403 into a hard logout + redirect, and
      // an admin hitting /teachers/me/assignments would always 403,
      // which would silently sign the admin out the moment they
      // saved any teacher's assignments. The teacher-side dashboard
      // log + the backend [listMine] log together cover the same
      // diagnostic without the side effect.)
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to save assignments."));
    } finally {
      setSaving(false);
    }
  };

  const totalCount = assignments?.length ?? 0;
  const hasNoClasses = classes.length === 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={teacher ? `Assignments — ${teacher.name}` : "Assignments"}
      description="Pick a class and tick the (subject × section) cells the teacher should cover. Save commits all changes at once."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              isDirty
                ? "text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            {isDirty
              ? `${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"}`
              : "All changes saved"}
          </span>
          <div className="flex items-center gap-2">
            {isDirty && (
              <Button
                variant="ghost"
                type="button"
                onClick={handleDiscard}
                disabled={saving}
              >
                Discard
              </Button>
            )}
            <Button
              variant="ghost"
              type="button"
              onClick={handleClose}
              disabled={saving}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saving}
              loading={saving}
              leftIcon={!saving ? <Check className="h-4 w-4" /> : undefined}
            >
              Save changes
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Orphan-teacher warning is gone in 20260511 — every Teacher row
            now has a NOT NULL `userId` (createWithUser is the only
            allowed creation path), so the orphan case can no longer
            exist. The login hard-guard on the backend additionally
            rejects unassigned teachers, so this dialog is the
            unambiguous source of "is this teacher set up?" — admins act
            on the cells, no extra warnings needed. */}

        {/* Inline error from the initial load. Save errors go via toast. */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---- Summary chips: classes the teacher already touches ----
            Each chip is also a quick-jump button into that class's grid.
            Distinct color tints separate "currently editing this one"
            from "exists but not selected". */}
        {!loading && (
          <ClassSummaryStrip
            classes={classes}
            countsByClass={countsByClass}
            selectedClassId={selectedClassId}
            onSelect={handleSelectClass}
            totalCount={totalCount}
          />
        )}

        {/* ---- Class picker + grid ---- */}
        {hasNoClasses ? (
          <NoClassesState />
        ) : loading ? (
          <GridSkeleton />
        ) : (
          <>
            <ClassPicker
              classes={classes}
              countsByClass={countsByClass}
              selectedClassId={selectedClassId}
              onChange={handleSelectClass}
              disabled={saving}
            />

            {selectedClass && (
              <AssignmentGrid
                klass={selectedClass}
                subjects={subjects}
                cellState={cellState}
                initialCellState={initialCellState}
                onToggle={toggleCell}
                disabled={saving}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Class summary chip strip
// ---------------------------------------------------------------------------

function ClassSummaryStrip({
  classes,
  countsByClass,
  selectedClassId,
  onSelect,
  totalCount,
}: {
  classes: ClassWithSections[];
  countsByClass: Map<string, number>;
  selectedClassId: string | null;
  onSelect: (classId: string) => void;
  totalCount: number;
}) {
  // Surface ONLY classes that already have assignments — this is a
  // "where are they currently teaching" overview, not a full school
  // class browser. (The picker dropdown below covers the full list.)
  const assignedClasses = classes.filter((c) => countsByClass.has(c.id));

  if (assignedClasses.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
        No assignments yet. Pick a class below and tick what they teach.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        Teaches in:
      </span>
      {assignedClasses.map((c) => {
        const isActive = c.id === selectedClassId;
        const count = countsByClass.get(c.id) ?? 0;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all focus-ring",
              isActive
                ? "border-emerald-300 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : "border-border bg-surface text-foreground hover:border-emerald-300 hover:bg-emerald-500/5",
            )}
            title={`Edit assignments for ${c.name}`}
          >
            <GraduationCap className="h-3.5 w-3.5" />
            {c.name}
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] tabular-nums",
                isActive
                  ? "bg-emerald-500/20 text-emerald-900 dark:text-emerald-200"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {count}
            </span>
          </button>
        );
      })}
      <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
        {totalCount} total
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Class picker (full school list)
// ---------------------------------------------------------------------------

function ClassPicker({
  classes,
  countsByClass,
  selectedClassId,
  onChange,
  disabled,
}: {
  classes: ClassWithSections[];
  countsByClass: Map<string, number>;
  selectedClassId: string | null;
  onChange: (classId: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Edit assignments for
      </span>
      <div className="relative">
        <GraduationCap className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <select
          value={selectedClassId ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm font-medium text-foreground",
            "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {classes.map((c) => {
            const count = countsByClass.get(c.id) ?? 0;
            return (
              <option key={c.id} value={c.id}>
                {c.name}
                {count > 0 ? ` — ${count} assigned` : ""}
              </option>
            );
          })}
        </select>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// The assignment grid
// ---------------------------------------------------------------------------

function AssignmentGrid({
  klass,
  subjects,
  cellState,
  initialCellState,
  onToggle,
  disabled,
}: {
  klass: ClassWithSections;
  subjects: SubjectDto[];
  cellState: Map<string, boolean>;
  initialCellState: Map<string, boolean>;
  onToggle: (subjectId: string | null, sectionId: string | null) => void;
  disabled?: boolean;
}) {
  // Rows: a synthetic "(no subject)" row first, then one row per
  // subject in the school catalog. Columns: a synthetic "Whole class"
  // column first, then one column per section in the chosen class.
  const sectionColumns = klass.sections;
  const hasSections = sectionColumns.length > 0;

  const rows: Array<{ id: string | null; label: string; isSynthetic: boolean }> =
    [
      { id: null, label: "Whole class (no subject)", isSynthetic: true },
      ...subjects.map((s) => ({ id: s.id, label: s.name, isSynthetic: false })),
    ];

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header strip — explains what the rows/columns mean. Subject
          catalog deep-link sits here so admins can jump out and add
          subjects without losing the grid state (we re-seed on
          remount, but the dialog itself stays). */}
      <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-2 text-xs">
        <span className="font-semibold uppercase tracking-wider text-muted-foreground">
          {klass.name} · {hasSections ? `${sectionColumns.length} section${sectionColumns.length === 1 ? "" : "s"}` : "no sections"}
        </span>
        <Link
          href="/settings"
          className="font-medium text-primary/80 hover:text-primary hover:underline focus-ring rounded-sm"
        >
          Manage subjects
        </Link>
      </div>

      {subjects.length === 0 ? (
        // Subject catalog empty: only the "(no subject)" row makes
        // sense. Nudge the admin to populate the catalog.
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          <p className="mb-2">No subjects in your school yet.</p>
          <p className="text-xs">
            You can still tick the &quot;Whole class&quot; cell below to give
            this teacher attendance access; add subjects in{" "}
            <Link
              href="/settings"
              className="font-medium text-primary hover:underline"
            >
              Settings
            </Link>{" "}
            for per-subject assignments.
          </p>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-surface">
              {/* Top-left corner cell: empty (intersection of row +
                  column headers). */}
              <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-r border-border">
                Subject ↓ / Section →
              </th>
              <ColumnHeader
                icon={<Layers className="h-3.5 w-3.5" />}
                label="Whole class"
                hint="No specific section"
              />
              {sectionColumns.map((s) => (
                <ColumnHeader key={s.id} label={s.name} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id ?? "_no_subject"}
                className={cn(
                  "transition-colors",
                  idx % 2 === 1 && "bg-muted/20",
                  row.isSynthetic && "bg-emerald-500/[0.04]",
                )}
              >
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 px-3 py-2 text-left align-middle text-sm font-medium border-b border-r border-border",
                    idx % 2 === 1 ? "bg-muted/40" : "bg-surface",
                    row.isSynthetic &&
                      "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 italic",
                  )}
                >
                  {row.label}
                </th>

                {/* "Whole class" cell (sectionId = null) */}
                <GridCell
                  subjectId={row.id}
                  sectionId={null}
                  cellState={cellState}
                  initialCellState={initialCellState}
                  onToggle={onToggle}
                  disabled={disabled}
                />

                {sectionColumns.map((s) => (
                  <GridCell
                    key={s.id}
                    subjectId={row.id}
                    sectionId={s.id}
                    cellState={cellState}
                    initialCellState={initialCellState}
                    onToggle={onToggle}
                    disabled={disabled}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <GridLegend />
    </div>
  );
}

function ColumnHeader({
  label,
  hint,
  icon,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <th
      className="px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border"
      title={hint}
    >
      <div className="inline-flex items-center gap-1">
        {icon}
        {label}
      </div>
    </th>
  );
}

function GridCell({
  subjectId,
  sectionId,
  cellState,
  initialCellState,
  onToggle,
  disabled,
}: {
  subjectId: string | null;
  sectionId: string | null;
  cellState: Map<string, boolean>;
  initialCellState: Map<string, boolean>;
  onToggle: (subjectId: string | null, sectionId: string | null) => void;
  disabled?: boolean;
}) {
  const key = cellKey(subjectId, sectionId);
  const checked = cellState.get(key) ?? false;
  const initial = initialCellState.get(key) ?? false;
  const isDirty = checked !== initial;

  return (
    <td className="border-b border-border p-0 text-center align-middle">
      <button
        type="button"
        onClick={() => onToggle(subjectId, sectionId)}
        disabled={disabled}
        aria-pressed={checked}
        aria-label={
          checked
            ? "Assigned — click to remove"
            : "Not assigned — click to add"
        }
        className={cn(
          "group flex h-10 w-full items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          // Dirty cells get a subtle amber wash so the admin can see
          // what's about to change at a glance.
          isDirty &&
            (checked
              ? "bg-emerald-500/15"
              : "bg-amber-500/15 ring-1 ring-inset ring-amber-300/60"),
          !isDirty && "hover:bg-muted/40",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded border transition-all",
            checked
              ? "border-emerald-500 bg-emerald-500 text-white shadow-sm"
              : "border-border bg-surface text-transparent group-hover:border-emerald-300",
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      </button>
    </td>
  );
}

function GridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-emerald-500 bg-emerald-500 text-white">
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        Assigned
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded bg-amber-500/30 ring-1 ring-inset ring-amber-300/60" />
        Pending change (not yet saved)
      </span>
      <span className="ml-auto italic">
        Click any cell to toggle. Save commits all changes at once.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading states
// ---------------------------------------------------------------------------

function NoClassesState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/10 px-6 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 ring-1 ring-inset ring-amber-500/20">
        <AlertCircle className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">
        No classes in this school yet
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Create classes in{" "}
        <Link
          href="/classes"
          className="font-medium text-primary hover:underline"
        >
          Classes
        </Link>{" "}
        before assigning teachers.
      </p>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full rounded-md" />
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="bg-muted/30 px-4 py-2">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="divide-y divide-border/60">
          {Array.from({ length: 4 }).map((_, ri) => (
            <div key={ri} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-4 w-24" />
              <div className="ml-auto flex items-center gap-2">
                {Array.from({ length: 4 }).map((_, ci) => (
                  <Skeleton key={ci} className="h-5 w-5 rounded" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Stable key for a (subjectId | null, sectionId | null) cell. Uses an
 * underscore as the null sentinel — assignment ids are UUIDs so there
 * is no collision risk.
 */
function cellKey(subjectId: string | null, sectionId: string | null): string {
  return `${subjectId ?? "_"}__${sectionId ?? "_"}`;
}

/**
 * Build the "checked" map for a class from the teacher's full
 * assignments list. Only rows on the requested class contribute.
 */
function buildCellMap(
  assignments: TeachingAssignmentDto[],
  classId: string,
): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const a of assignments) {
    if (a.classId !== classId) continue;
    m.set(cellKey(a.subjectId, a.sectionId), true);
  }
  return m;
}

/**
 * Diff the current cell state against the seed snapshot. Only cells
 * that flipped contribute. Works on the union of keys so a cell
 * present in one map but missing from the other is still considered.
 */
function computeDiff(
  initial: Map<string, boolean>,
  current: Map<string, boolean>,
  classId: string | null,
): { add: BulkAssignmentTuple[]; remove: BulkAssignmentTuple[] } {
  const add: BulkAssignmentTuple[] = [];
  const remove: BulkAssignmentTuple[] = [];
  if (!classId) return { add, remove };

  const allKeys = new Set<string>([...initial.keys(), ...current.keys()]);
  for (const key of allKeys) {
    const was = initial.get(key) ?? false;
    const now = current.get(key) ?? false;
    if (was === now) continue;
    const [subjectIdRaw, sectionIdRaw] = key.split("__");
    const tuple: BulkAssignmentTuple = {
      classId,
      subjectId: subjectIdRaw === "_" ? null : subjectIdRaw,
      sectionId: sectionIdRaw === "_" ? null : sectionIdRaw,
    };
    if (now) add.push(tuple);
    else remove.push(tuple);
  }
  return { add, remove };
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

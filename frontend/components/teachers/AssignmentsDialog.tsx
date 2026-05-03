"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  GraduationCap,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  teachingAssignmentsApi,
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
}

/**
 * Multi-row assignment manager for a single teacher. Designed to be a
 * "single screen" for an admin to set up everything a teacher can act
 * on without leaving the dialog.
 *
 * Layout:
 *   • Summary header with the running count
 *   • Existing assignments grouped BY CLASS (one card per class with
 *     its rows underneath) — fewer scan distances when a teacher has
 *     several rows on the same class
 *   • Per-row quick actions: Attendance (deep-linked to that roster),
 *     Marks (→ /exams), Delete
 *   • Always-visible add form with three dropdowns (subject → class →
 *     section). Enter submits. Picking a class auto-focuses the
 *     section dropdown. After a successful add the same subject + class
 *     stick so admins can rapid-fire sibling rows.
 *   • Inline duplicate detection: blocks the Add button BEFORE the
 *     server returns 409, with a one-line explanation.
 */
export function AssignmentsDialog({
  teacher,
  classes,
  subjects,
  onClose,
}: AssignmentsDialogProps) {
  const open = teacher !== null;
  const [assignments, setAssignments] = React.useState<
    TeachingAssignmentDto[] | null
  >(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Pending IDs control the per-row delete spinner. We use a Set so
  // multiple deletes can run in parallel without a stale-render race.
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // Add-form state. Always-visible form sits below the table so admins
  // can keep adding rows without hunting for a "+ Add" button.
  const [draftSubjectId, setDraftSubjectId] = React.useState<string>("");
  const [draftClassId, setDraftClassId] = React.useState<string>("");
  const [draftSectionId, setDraftSectionId] = React.useState<string>("");
  const [adding, setAdding] = React.useState(false);

  // Section ref for keyboard focus. Set on the <select> element so
  // we can pull the admin straight into the next field when a class
  // is chosen — saves a click on the most common path.
  const sectionRef = React.useRef<HTMLSelectElement | null>(null);

  // Reset & fetch whenever the dialog opens for a different teacher.
  React.useEffect(() => {
    if (!teacher) {
      setAssignments(null);
      setError(null);
      setDraftSubjectId("");
      setDraftClassId("");
      setDraftSectionId("");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await teachingAssignmentsApi.listForTeacher(teacher.id);
        if (!cancelled) setAssignments(list);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load assignments.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teacher]);

  // Section depends on class — reset whenever the picked class changes
  // so a stale section ID never leaks through, and pull focus into the
  // section dropdown so the admin's next press lands there.
  React.useEffect(() => {
    setDraftSectionId("");
    if (draftClassId) {
      // Wait one frame so the disabled→enabled transition completes
      // before focus moves; otherwise focus silently bounces away.
      const id = window.requestAnimationFrame(() => {
        sectionRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
  }, [draftClassId]);

  const draftClass = React.useMemo(
    () => classes.find((c) => c.id === draftClassId) ?? null,
    [classes, draftClassId],
  );

  // Group existing assignments by class so the rendered list reads
  // like "Grade 10 → Math · A, Science · B / Grade 9 → English". Sort
  // by class name for stable, alphabetical scanning; within a class
  // sort by section (Whole class first) then subject.
  const groupedAssignments = React.useMemo(
    () => groupByClass(assignments ?? []),
    [assignments],
  );

  // Inline duplicate detection. The DB has a unique index on the
  // (teacher, class, section, subject) tuple, but Postgres treats
  // NULLs as DISTINCT — meaning the index doesn't catch (Class 8,
  // NULL section, NULL subject) duplicates. We hand-check ALL field
  // combinations here so the admin doesn't have to wait for a 409 to
  // discover the row already exists.
  const isDuplicate = React.useMemo(() => {
    if (!assignments || !draftClassId) return false;
    const sectionId = draftSectionId || null;
    const subjectId = draftSubjectId || null;
    return assignments.some(
      (a) =>
        a.classId === draftClassId &&
        (a.sectionId ?? null) === sectionId &&
        (a.subjectId ?? null) === subjectId,
    );
  }, [assignments, draftClassId, draftSectionId, draftSubjectId]);

  const canAdd = !!draftClassId && !adding && !isDuplicate;

  const handleClose = () => {
    if (adding || removingIds.size > 0) return;
    onClose();
  };

  const handleAdd = async () => {
    if (!teacher || !canAdd) return;
    setAdding(true);
    try {
      const created = await teachingAssignmentsApi.create(teacher.id, {
        classId: draftClassId,
        sectionId: draftSectionId || null,
        subjectId: draftSubjectId || null,
      });
      setAssignments((prev) => (prev ? [...prev, created] : [created]));
      // Keep subject + class so admins can rapid-fire sibling rows
      // ("Math · Class 8 · A" → switch section to "B" → Add). Only
      // section resets — and we re-focus it for keyboard flow.
      setDraftSectionId("");
      window.requestAnimationFrame(() => sectionRef.current?.focus());
      toast.success("Assignment added");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to add assignment.";
      toast.error(msg);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (assignment: TeachingAssignmentDto) => {
    setRemovingIds((prev) => new Set(prev).add(assignment.id));
    try {
      await teachingAssignmentsApi.remove(assignment.id);
      setAssignments((prev) =>
        prev ? prev.filter((a) => a.id !== assignment.id) : prev,
      );
      toast.success("Assignment removed");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to remove assignment.";
      toast.error(msg);
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(assignment.id);
        return next;
      });
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canAdd) void handleAdd();
  };

  const count = assignments?.length ?? 0;
  const isEmpty = !loading && !error && count === 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={teacher ? `Assignments — ${teacher.name}` : "Assignments"}
      description="Each row is one (subject × class × section) the teacher can act on. Subject and section are optional."
      size="lg"
      footer={
        <Button variant="ghost" onClick={handleClose} type="button">
          Done
        </Button>
      }
    >
      <div className="space-y-5">
        {/* ----- Summary header ----- */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5" />
            Assignments:{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {loading ? "—" : count}
            </span>
          </div>
          {error && (
            <span className="text-xs text-destructive">{error}</span>
          )}
        </div>

        {/* ----- Orphan-teacher warning -----
            Assignments live on the Teacher row; the teacher's dashboard
            resolves them via Teacher.userId === user.id. If userId is
            null (typical for QuickAdd-created rows) the assignments
            won't appear anywhere — silent failure unless we surface it
            HERE, where the admin is in the act of creating them. */}
        {teacher && teacher.userId === null && <OrphanTeacherWarning />}

        {/* ----- Existing assignments — grouped by class ----- */}
        {loading && <GroupSkeleton />}

        {isEmpty && <EmptyState />}

        {!loading && !isEmpty && groupedAssignments.length > 0 && (
          <div className="space-y-3">
            {groupedAssignments.map((group) => (
              <ClassGroup
                key={group.classId}
                group={group}
                removingIds={removingIds}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}

        {/* ----- Add form ----- */}
        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Plus className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
            Add assignment
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <DropdownField
              label="Subject"
              hint="Optional — leave blank for attendance-only"
              icon={<BookOpen className="h-3.5 w-3.5" />}
            >
              <select
                value={draftSubjectId}
                onChange={(e) => setDraftSubjectId(e.target.value)}
                disabled={adding}
                className={selectClasses}
              >
                <option value="">No subject (attendance only)</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </DropdownField>

            <DropdownField
              label="Class"
              hint="Required"
              icon={<GraduationCap className="h-3.5 w-3.5" />}
            >
              <select
                value={draftClassId}
                onChange={(e) => setDraftClassId(e.target.value)}
                disabled={adding}
                className={selectClasses}
              >
                <option value="">Choose a class…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </DropdownField>

            <DropdownField
              label="Section"
              hint={
                draftClass
                  ? draftClass.sections.length === 0
                    ? "No sections in this class"
                    : "Optional — blank means whole class"
                  : "Pick a class first"
              }
              icon={<Layers className="h-3.5 w-3.5" />}
            >
              <select
                ref={sectionRef}
                value={draftSectionId}
                onChange={(e) => setDraftSectionId(e.target.value)}
                disabled={
                  adding || !draftClass || draftClass.sections.length === 0
                }
                className={selectClasses}
              >
                <option value="">Whole class</option>
                {draftClass?.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </DropdownField>
          </div>

          {/* Inline duplicate error — only when class is picked AND the
              tuple already exists. Empty draft never triggers it. */}
          {isDuplicate && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                This assignment already exists. Pick a different combination
                or remove the existing row first.
              </span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-[11px] text-muted-foreground">
              Subjects come from the school catalog.{" "}
              <Link
                href="/settings"
                className="text-primary hover:underline focus-ring rounded-sm"
              >
                Manage subjects
              </Link>
            </p>
            <div className="flex items-center gap-2">
              {(draftSubjectId || draftClassId || draftSectionId) && (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setDraftSubjectId("");
                    setDraftClassId("");
                    setDraftSectionId("");
                  }}
                  leftIcon={<X className="h-3.5 w-3.5" />}
                  disabled={adding}
                >
                  Reset
                </Button>
              )}
              <Button
                size="sm"
                type="submit"
                disabled={!canAdd}
                loading={adding}
                leftIcon={!adding ? <Plus className="h-3.5 w-3.5" /> : undefined}
              >
                Add assignment
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Class group + row
// ---------------------------------------------------------------------------

interface AssignmentGroup {
  classId: string;
  className: string;
  items: TeachingAssignmentDto[];
}

function ClassGroup({
  group,
  removingIds,
  onRemove,
}: {
  group: AssignmentGroup;
  removingIds: Set<string>;
  onRemove: (a: TeachingAssignmentDto) => void;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Class header — large, distinct from row chrome so the eye locks
          onto class boundaries first. */}
      <div className="flex items-center justify-between bg-muted/40 px-4 py-2">
        <div className="inline-flex items-center gap-2">
          <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">
            {group.className}
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {group.items.length}{" "}
          {group.items.length === 1 ? "assignment" : "assignments"}
        </span>
      </div>
      <ul className="divide-y divide-border/60">
        {group.items.map((a) => (
          <AssignmentRow
            key={a.id}
            assignment={a}
            removing={removingIds.has(a.id)}
            onRemove={() => onRemove(a)}
          />
        ))}
      </ul>
    </div>
  );
}

function AssignmentRow({
  assignment,
  removing,
  onRemove,
}: {
  assignment: TeachingAssignmentDto;
  removing: boolean;
  onRemove: () => void;
}) {
  const attendanceHref = assignment.sectionId
    ? `/attendance?sectionId=${assignment.sectionId}`
    : `/attendance?classId=${assignment.classId}`;
  // Marks doesn't deep-link by class yet; the exams page picker isn't
  // URL-controlled. Plain /exams is the closest jump and still saves
  // the admin a navigation hop from this dialog.
  const marksHref = "/exams";

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-3 transition-colors",
        !removing && "hover:bg-muted/20",
        removing && "opacity-60",
      )}
    >
      {/* Subject pill — colored by name hash for consistent recognition. */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SubjectPill subject={assignment.subject} />
        <span className="text-sm text-muted-foreground tabular-nums">
          {assignment.section ? assignment.section.name : "Whole class"}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Link
          href={attendanceHref}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:border-emerald-300 hover:text-emerald-700 hover:-translate-y-px focus-ring"
          title="Open attendance for this scope"
        >
          <CalendarCheck className="h-3.5 w-3.5" />
          Attendance
        </Link>
        <Link
          href={marksHref}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:border-indigo-300 hover:text-indigo-700 hover:-translate-y-px focus-ring"
          title="Open exams to enter marks"
        >
          <ClipboardList className="h-3.5 w-3.5" />
          Marks
        </Link>
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          aria-label="Remove assignment"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
            "transition-all duration-150 focus-ring",
            "hover:bg-destructive/10 hover:text-destructive",
            removing && "cursor-not-allowed opacity-60",
          )}
        >
          {removing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Subject pill — deterministic color from the subject's name so the
// same subject always gets the same tint across the dialog (and across
// reloads). Subject-less rows render the muted "No subject" pill.
// ---------------------------------------------------------------------------

const SUBJECT_PALETTES = [
  "bg-emerald-50 text-emerald-700 ring-emerald-200/60",
  "bg-sky-50 text-sky-700 ring-sky-200/60",
  "bg-indigo-50 text-indigo-700 ring-indigo-200/60",
  "bg-violet-50 text-violet-700 ring-violet-200/60",
  "bg-amber-50 text-amber-700 ring-amber-200/60",
  "bg-rose-50 text-rose-700 ring-rose-200/60",
  "bg-teal-50 text-teal-700 ring-teal-200/60",
  "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200/60",
];

function paletteForSubject(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return SUBJECT_PALETTES[sum % SUBJECT_PALETTES.length];
}

function SubjectPill({
  subject,
}: {
  subject: TeachingAssignmentDto["subject"];
}) {
  if (!subject) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-muted/70 px-2 py-0.5 text-xs font-medium text-muted-foreground italic ring-1 ring-inset ring-border/60">
        No subject
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        paletteForSubject(subject.name),
      )}
    >
      {subject.name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty state + skeleton + form helpers
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/10 px-6 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20">
        <Sparkles className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">
        No assignments yet
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Use the form below to add the first one.
      </p>
    </div>
  );
}

/**
 * Loud, unmissable banner shown when the teacher row has no linked
 * User account. Without that link the teacher's dashboard can never
 * see the assignments — the dashboard resolves them by
 * `Teacher.userId === currentUser.id`, which returns nothing.
 *
 * QuickAdd is the usual culprit: it creates a Teacher with name only
 * (no email/password), so userId stays null. The fix is to recreate
 * the teacher via "Add teacher" with email + password.
 */
function OrphanTeacherWarning() {
  return (
    <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
          <AlertCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-amber-900">
            This teacher has no login account
          </p>
          <p className="text-xs text-amber-800 leading-relaxed">
            You can still add assignment rows below, but the teacher
            won&apos;t see them on their dashboard until they&apos;re
            linked to a login. Close this dialog and use{" "}
            <span className="font-medium">&ldquo;Add teacher&rdquo;</span>{" "}
            (with email + password) to create a teacher record that ships
            with a login account.
          </p>
        </div>
      </div>
    </div>
  );
}

function GroupSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, gi) => (
        <div
          key={gi}
          className="rounded-lg border border-border overflow-hidden"
        >
          <div className="bg-muted/40 px-4 py-2">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="divide-y divide-border/60">
            {Array.from({ length: 2 }).map((_, ri) => (
              <div key={ri} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-4 w-20" />
                <div className="ml-auto flex items-center gap-1.5">
                  <Skeleton className="h-8 w-24 rounded-md" />
                  <Skeleton className="h-8 w-16 rounded-md" />
                  <Skeleton className="h-8 w-8 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const selectClasses = cn(
  "h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm",
  "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
  "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
  "transition-colors",
);

function DropdownField({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon ? <span className="text-muted-foreground/80">{icon}</span> : null}
        {label}
      </span>
      {children}
      {hint && (
        <span className="text-[11px] text-muted-foreground/80">{hint}</span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

/**
 * Group assignments by class. Within each class, sort so "whole class"
 * rows surface first (they're the most general), then alphabetically
 * by section name; tiebreak by subject name. Cross-class order is
 * alphabetical by class name for stable scanning.
 */
function groupByClass(
  assignments: TeachingAssignmentDto[],
): AssignmentGroup[] {
  const map = new Map<string, AssignmentGroup>();
  for (const a of assignments) {
    let group = map.get(a.classId);
    if (!group) {
      group = {
        classId: a.classId,
        className: a.class.name,
        items: [],
      };
      map.set(a.classId, group);
    }
    group.items.push(a);
  }
  for (const group of map.values()) {
    group.items.sort((x, y) => {
      // "Whole class" (null section) before specific sections.
      if (!x.section && y.section) return -1;
      if (x.section && !y.section) return 1;
      const sectionCmp = (x.section?.name ?? "").localeCompare(
        y.section?.name ?? "",
      );
      if (sectionCmp !== 0) return sectionCmp;
      return (x.subject?.name ?? "").localeCompare(y.subject?.name ?? "");
    });
  }
  return Array.from(map.values()).sort((a, b) =>
    a.className.localeCompare(b.className),
  );
}

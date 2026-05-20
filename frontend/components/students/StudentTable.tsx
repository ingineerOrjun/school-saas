"use client";

import * as React from "react";
import { Archive, Edit2, Loader2, RefreshCcw } from "lucide-react";
import type { ClassWithSections } from "@/lib/classes";
import type { StudentDto } from "@/lib/students";
import { formatByMode, type CalendarMode } from "@/lib/date";
import { ArchivedBadge } from "@/components/ui/StatusBadges";
import { cn } from "@/lib/utils";
import {
  SectionSelect,
  assignmentFromStudent,
  formatStudentAssignment,
  type Assignment,
} from "./SectionSelect";

export interface StudentTableProps {
  students: StudentDto[];
  classes: ClassWithSections[];
  /**
   * Fired when the user clicks a row OUTSIDE the action / picker cells.
   * Used by the students page to navigate to /students/[id]. Optional —
   * older call sites that don't pass it keep the previous "static row"
   * behavior. When set, the row's name cell becomes a button-styled
   * region and the rest of the row gains `cursor-pointer`.
   *
   * Action buttons + the inline SectionSelect call `stopPropagation`
   * on their own onClick so they keep working independently.
   */
  onRowClick?: (student: StudentDto) => void;
  onEdit: (student: StudentDto) => void;
  /**
   * Phase DATA LIFECYCLE Part 2: replaces `onDelete`. The trash icon
   * now opens an archive dialog (soft-delete with reason). Hard-delete
   * is no longer offered for high-risk entities — see retention-policy.md.
   */
  onArchive: (student: StudentDto) => void;
  /**
   * Phase DATA LIFECYCLE Part 2: row-level restore action. Used in the
   * archived view to bring a row back into the active roster.
   */
  onRestore?: (student: StudentDto) => void;
  onAssignSection: (student: StudentDto, next: Assignment) => void;
  /**
   * When false, the table renders read-only:
   *   • Actions column (Edit / Archive) is hidden entirely
   *   • Inline class/section picker collapses to a static label
   * Defaults to true so existing call sites that don't yet pass this
   * prop keep their current admin-style behavior.
   */
  canModify?: boolean;
  /**
   * Phase DATA LIFECYCLE Part 1: when true the table is showing the
   * Archived tab — the Edit + Archive buttons collapse to a single
   * Restore button per row, and each row carries the ArchivedBadge.
   */
  archivedView?: boolean;
  highlightIds?: Set<string>;
  removingIds?: Set<string>;
  assigningIds?: Set<string>;
}

export function StudentTable({
  students,
  classes,
  onRowClick,
  onEdit,
  onArchive,
  onRestore,
  onAssignSection,
  canModify = true,
  archivedView = false,
  highlightIds,
  removingIds,
  assigningIds,
}: StudentTableProps) {
  return (
    <div className="glass rounded-xl overflow-hidden animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-muted/30">
              <Th className="rounded-tl-xl">Name</Th>
              <Th>Class</Th>
              <Th>Gender</Th>
              <Th
                className={cn(
                  // When the Actions column is hidden, Contact becomes
                  // the rightmost column and inherits the rounded
                  // corner that would otherwise live on Actions.
                  !canModify && "rounded-tr-xl",
                )}
              >
                Contact
              </Th>
              {canModify && (
                <Th className="rounded-tr-xl text-right">Actions</Th>
              )}
            </tr>
          </thead>
          <tbody>
            {students.map((student, idx) => {
              const isLast = idx === students.length - 1;
              const isNew = highlightIds?.has(student.id);
              const isPending = isPendingId(student.id);
              const isRemoving = removingIds?.has(student.id);
              const isAssigning = assigningIds?.has(student.id);

              const navigable = Boolean(onRowClick) && !isPending && !isRemoving;
              return (
                <tr
                  key={student.id}
                  className={cn(
                    "group transition-all duration-150",
                    !isPending && !isRemoving && "hover:bg-primary/5",
                    navigable && "cursor-pointer",
                    isNew && "animate-highlight-row",
                    isPending && "opacity-70",
                    isRemoving && "animate-row-remove pointer-events-none",
                  )}
                  // Row click navigates via the consumer's callback.
                  // Action buttons + the inline section picker stop
                  // propagation in their own handlers so they don't
                  // trigger this. Pending / removing rows are not
                  // navigable.
                  onClick={navigable ? () => onRowClick?.(student) : undefined}
                >
                  <Td
                    className={cn(
                      "border-t border-border/50",
                      isLast && "rounded-bl-xl",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {isPending ? (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/80 ring-1 ring-inset ring-border/60">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <Avatar
                          firstName={student.firstName}
                          lastName={student.lastName}
                          id={student.id}
                        />
                      )}
                      <div className="flex flex-col leading-tight">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {student.firstName} {student.lastName}
                          </span>
                          {(isPending || isAssigning) && (
                            <span className="text-[11px] italic text-muted-foreground">
                              saving...
                            </span>
                          )}
                          {/* Phase DATA LIFECYCLE Part 1+5: row-level
                              trust badge — present on any archived
                              student regardless of which tab is open,
                              so attendance / payment cross-references
                              can also surface the state. */}
                          {student.archivedAt && (
                            <ArchivedBadge
                              size="sm"
                              archivedAt={student.archivedAt}
                              reason={student.archiveReason}
                            />
                          )}
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          #{isPending ? "pending" : student.id.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </Td>
                  <Td className="border-t border-border/50">
                    {/* The inline picker is interactive — stop propagation
                        on the entire cell so dropdown clicks don't
                        trigger the row-level navigation handler.
                        The label above the picker is informational only,
                        so wrapping the whole cell is the simpler shape
                        (no nested click-region gymnastics). */}
                    <div
                      className="min-w-[220px] space-y-2"
                      onClick={(e) => {
                        if (canModify) e.stopPropagation();
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {isAssigning && <Loader2 className="h-3 w-3 animate-spin" />}
                        {formatStudentAssignment(student)}
                      </span>
                      {/* Inline section picker is a write — admin only.
                          Teachers see only the static assignment label
                          above. */}
                      {canModify && (
                        <SectionSelect
                          classes={classes}
                          value={assignmentFromStudent(student)}
                          onChange={(next) => onAssignSection(student, next)}
                          disabled={isPending || isRemoving || isAssigning}
                          compact
                        />
                      )}
                    </div>
                  </Td>
                  <Td className="border-t border-border/50 text-muted-foreground">
                    {isPending ? "—" : <GenderPill gender={student.gender} />}
                  </Td>
                  <Td
                    className={cn(
                      "border-t border-border/50 text-muted-foreground tabular-nums",
                      // When Actions column is hidden, Contact owns the
                      // bottom-right rounded corner of the last row.
                      !canModify && isLast && "rounded-br-xl",
                    )}
                  >
                    {isPending ? "—" : (student.contactNumber || "—")}
                  </Td>
                  {canModify && (
                    <Td
                      className={cn(
                        "border-t border-border/50 text-right",
                        isLast && "rounded-br-xl",
                      )}
                    >
                      {isPending || isAssigning ? (
                        <span className="text-xs text-muted-foreground">--</span>
                      ) : archivedView ? (
                        // Phase DATA LIFECYCLE Part 1: archived view —
                        // single Restore icon replaces Edit + Archive.
                        // Edit is suppressed because archived rows are
                        // read-only on the backend (409 Conflict).
                        <div className="inline-flex items-center gap-1">
                          <IconButton
                            label={`Restore ${student.firstName}`}
                            onClick={() => onRestore?.(student)}
                          >
                            <RefreshCcw className="h-4 w-4" />
                          </IconButton>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <IconButton
                            label={`Edit ${student.firstName}`}
                            onClick={() => onEdit(student)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label={`Archive ${student.firstName}`}
                            onClick={() => onArchive(student)}
                            variant="danger"
                          >
                            <Archive className="h-4 w-4" />
                          </IconButton>
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
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
  return <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>;
}

/** Compact gender chip — colored to scan quickly in a long list. */
function GenderPill({ gender }: { gender: StudentDto["gender"] }) {
  const tones: Record<StudentDto["gender"], string> = {
    MALE: "bg-sky-500/10 text-sky-700",
    FEMALE: "bg-pink-500/10 text-pink-700",
    OTHER: "bg-muted text-muted-foreground",
  };
  const labels: Record<StudentDto["gender"], string> = {
    MALE: "Male",
    FEMALE: "Female",
    OTHER: "Other",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[gender],
      )}
    >
      {labels[gender]}
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // Stop propagation so clicks on the action icons don't bubble
      // to the row-level onClick (used by the students list to
      // navigate to /students/[id]). The action's intent is the
      // edit/archive/restore dialog, NOT navigation.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
        "transition-all duration-150 hover:-translate-y-px focus-ring",
        variant === "danger"
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-primary/10 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

function isPendingId(id: string): boolean {
  return id.startsWith("temp_");
}

const AVATAR_PALETTES = [
  "from-indigo-400 to-purple-400",
  "from-sky-400 to-blue-400",
  "from-emerald-400 to-teal-400",
  "from-amber-400 to-orange-400",
  "from-pink-400 to-rose-400",
  "from-violet-400 to-fuchsia-400",
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
}: {
  firstName: string;
  lastName: string;
  id: string;
}) {
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  return (
    <div
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-1 ring-inset ring-white/20",
        `bg-gradient-to-br ${paletteFor(id)}`,
      )}
    >
      {initials}
    </div>
  );
}

/**
 * Relative wording for recent timestamps, calendar-aware absolute
 * date (via `formatByMode`) for anything older than a week. Mirrors
 * `TeacherTable`'s `formatRelative` so both tables behave identically.
 *
 * Currently unused at the StudentTable call-sites — kept here for
 * parity in case a future "Added" / "Last updated" column wants it.
 * Pass `useCalendarMode()` from the calling component as `mode` so
 * the helper honors the topbar dropdown.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function formatRelative(iso: string, mode: CalendarMode): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatByMode(iso, mode);
}

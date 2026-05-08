"use client";

import * as React from "react";
import { BookOpen, Edit2, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeacherDto } from "@/lib/teachers";
import { useCalendarMode } from "@/components/calendar/CalendarProvider";
import { formatByMode, type CalendarMode } from "@/lib/date";

export interface TeacherTableProps {
  teachers: TeacherDto[];
  onEdit: (teacher: TeacherDto) => void;
  onDelete: (teacher: TeacherDto) => void;
  /**
   * Open the multi-row assignment manager for this teacher. Optional
   * so existing call sites that don't yet wire it through still
   * compile — the column just won't render the button.
   */
  onManageAssignments?: (teacher: TeacherDto) => void;
  /** IDs that should flash a highlight background (new/just-added). */
  highlightIds?: Set<string>;
  /** IDs currently playing the exit animation before unmount. */
  removingIds?: Set<string>;
}

export function TeacherTable({
  teachers,
  onEdit,
  onDelete,
  onManageAssignments,
  highlightIds,
  removingIds,
}: TeacherTableProps) {
  // Read the user's calendar preference once per render and thread it
  // into formatRelative below so the "Added" column respects the
  // topbar dropdown (B.S. / A.D. / Dual).
  const calendarMode = useCalendarMode();
  return (
    <div className="glass rounded-xl overflow-hidden animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-muted/30">
              <Th className="rounded-tl-xl">Teacher</Th>
              <Th>Assignments</Th>
              <Th>Added</Th>
              {/* Min-width keeps the labeled action cluster from
                  collapsing on narrower viewports — the buttons stay
                  on one line all the way down to ~tablet width. */}
              <Th className="text-right rounded-tr-xl w-[260px] min-w-[260px]">
                Actions
              </Th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t, idx) => {
              const isLast = idx === teachers.length - 1;
              const isNew = highlightIds?.has(t.id);
              const isPending = isPendingId(t.id);
              const isRemoving = removingIds?.has(t.id);
              return (
                <tr
                  key={t.id}
                  className={cn(
                    "group transition-all duration-150",
                    !isPending && !isRemoving && "hover:bg-emerald-500/5",
                    isNew && "animate-highlight-row-teacher",
                    isPending && "opacity-70",
                    isRemoving && "animate-row-remove pointer-events-none",
                  )}
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
                        <Avatar name={t.name} id={t.id} />
                      )}
                      <div className="flex flex-col leading-tight">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {t.name}
                          </span>
                          {isPending && (
                            <span className="text-[11px] italic text-muted-foreground">
                              saving…
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          #{isPending ? "pending" : t.id.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </Td>
                  <Td className="border-t border-border/50">
                    <AssignmentsCell counts={t.assignmentCounts} />
                  </Td>
                  <Td className="border-t border-border/50 text-muted-foreground">
                    {isPending ? "—" : formatRelative(t.createdAt, calendarMode)}
                  </Td>
                  <Td
                    className={cn(
                      "border-t border-border/50 text-right",
                      isLast && "rounded-br-xl",
                    )}
                  >
                    {isPending ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      // Labeled action cluster — primary actions
                      // (Assign, Edit) get visible text + icon so an
                      // admin glancing at the row instantly knows
                      // what each button does. Delete stays
                      // icon-only with a destructive hover so it
                      // doesn't compete visually with the primary
                      // actions but is still a clear, recognizable
                      // affordance.
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {onManageAssignments && (
                          <ActionButton
                            label="Assign"
                            ariaLabel={`Manage assignments for ${t.name}`}
                            icon={<BookOpen className="h-3.5 w-3.5" />}
                            onClick={() => onManageAssignments(t)}
                          />
                        )}
                        <ActionButton
                          label="Edit"
                          ariaLabel={`Edit ${t.name}`}
                          icon={<Edit2 className="h-3.5 w-3.5" />}
                          onClick={() => onEdit(t)}
                        />
                        <IconButton
                          label={`Delete ${t.name}`}
                          onClick={() => onDelete(t)}
                          variant="danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    )}
                  </Td>
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
  return (
    <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>
  );
}

/**
 * Labeled action — icon + visible text. Used for the primary row
 * actions (Assign, Edit) so admins can immediately read what each
 * button does without hovering for a tooltip. Sized small enough
 * that three of these + a delete icon fit cleanly on one line in a
 * 260-px-min actions column.
 */
function ActionButton({
  label,
  ariaLabel,
  icon,
  onClick,
}: {
  label: string;
  ariaLabel: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      title={ariaLabel}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground",
        "transition-all duration-150 hover:-translate-y-px hover:border-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-400 focus-ring",
      )}
    >
      {icon}
      {label}
    </button>
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
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
        "transition-all duration-150 hover:-translate-y-px focus-ring",
        variant === "danger"
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-emerald-500/10 hover:text-emerald-600",
      )}
    >
      {children}
    </button>
  );
}

// --- helpers ---

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

/**
 * Compact assignment summary for the table.
 *
 *   • 0 assignments → red "Unassigned" pill (action-needed signal —
 *     a teacher with no assignments can't even log in)
 *   • > 0           → "X Class · Y Subject" (singular/plural aware,
 *     section count tucked into a tooltip so the chip stays compact)
 *
 * Replaces the legacy single-class AssignmentPill — the legacy
 * `Teacher.classId/sectionId` columns were dropped in 20260511.
 */
function AssignmentsCell({
  counts,
}: {
  counts: TeacherDto["assignmentCounts"];
}) {
  if (counts.total === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive ring-1 ring-inset ring-destructive/30"
        title="This teacher has no assignments yet — they can't sign in until you assign at least one class."
      >
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        Unassigned
      </span>
    );
  }

  const classLabel = `${counts.classes} ${counts.classes === 1 ? "Class" : "Classes"}`;
  const subjectLabel = `${counts.subjects} ${counts.subjects === 1 ? "Subject" : "Subjects"}`;
  const tooltip =
    counts.sections > 0
      ? `${counts.total} assignment${counts.total === 1 ? "" : "s"} across ${counts.sections} specific section${counts.sections === 1 ? "" : "s"}`
      : `${counts.total} assignment${counts.total === 1 ? "" : "s"}`;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300"
      title={tooltip}
    >
      <span className="tabular-nums">{classLabel}</span>
      <span className="text-emerald-700/60 dark:text-emerald-400/60">·</span>
      <span className="tabular-nums">{subjectLabel}</span>
    </span>
  );
}

function Avatar({ name, id }: { name: string; id: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-1 ring-inset ring-white/20",
        `bg-gradient-to-br ${paletteFor(id)}`,
      )}
    >
      {initials || "?"}
    </div>
  );
}

/**
 * Relative time for recent rows ("3m ago", "2d ago"), absolute date
 * for everything older than a week. The absolute fallback routes
 * through `formatByMode` so the "Added" column respects the user's
 * calendar preference (B.S. / A.D. / Dual).
 *
 * Relative units are universal — minutes/hours/days mean the same
 * thing in either calendar — so only the absolute path needs the mode.
 */
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

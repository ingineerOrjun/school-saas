"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { ClassWithSections } from "@/lib/classes";

/**
 * A student's classroom placement. Either nothing (unassigned), just a
 * class (small schools that don't use sections), or a class + section.
 * The backend enforces that `sectionId.classId === classId` when both
 * are set.
 */
export interface Assignment {
  classId: string | null;
  sectionId: string | null;
}

export const UNASSIGNED: Assignment = { classId: null, sectionId: null };

export interface SectionSelectProps {
  classes: ClassWithSections[];
  value: Assignment;
  onChange: (next: Assignment) => void;
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  compact?: boolean;
  id?: string;
  className?: string;
}

// Composite <select> values so a single <select> can represent either
// "whole class" or "specific section". Decoded in `decode()`.
const encode = (a: Assignment): string => {
  if (a.sectionId) return `section:${a.sectionId}`;
  if (a.classId) return `class:${a.classId}`;
  return "";
};

function decode(raw: string, classes: ClassWithSections[]): Assignment {
  if (!raw) return UNASSIGNED;
  if (raw.startsWith("class:")) {
    return { classId: raw.slice("class:".length), sectionId: null };
  }
  if (raw.startsWith("section:")) {
    const sectionId = raw.slice("section:".length);
    // Look up the section's class so the caller has a fully-populated
    // assignment without needing to query the server.
    for (const klass of classes) {
      if (klass.sections.some((s) => s.id === sectionId)) {
        return { classId: klass.id, sectionId };
      }
    }
    return { classId: null, sectionId };
  }
  return UNASSIGNED;
}

export function SectionSelect({
  classes,
  value,
  onChange,
  label,
  hint,
  error,
  disabled = false,
  compact = false,
  id,
  className,
}: SectionSelectProps) {
  const generatedId = React.useId();
  const selectId = id ?? generatedId;
  const hasClasses = classes.length > 0;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={selectId} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <select
        id={selectId}
        value={encode(value)}
        onChange={(event) => onChange(decode(event.target.value, classes))}
        disabled={disabled || !hasClasses}
        aria-invalid={!!error}
        className={cn(
          "w-full rounded-md border bg-surface text-sm text-foreground",
          "transition-all duration-150",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
          compact ? "h-9 px-2.5" : "h-10 px-3",
          error
            ? "border-destructive/70 focus:border-destructive focus:ring-destructive/20"
            : "border-border",
        )}
      >
        <option value="">Unassigned</option>
        {hasClasses ? (
          classes.map((klass) => (
            <optgroup key={klass.id} label={klass.name}>
              {/* Whole-class option — useful for classes without sections,
                  and as a fallback if the user hasn't created sections yet. */}
              <option value={`class:${klass.id}`}>
                {klass.sections.length > 0
                  ? `${klass.name} — whole class (no section)`
                  : `${klass.name} — no section`}
              </option>
              {klass.sections.map((section) => (
                <option key={section.id} value={`section:${section.id}`}>
                  {klass.name} · Section {section.name}
                </option>
              ))}
            </optgroup>
          ))
        ) : (
          <option disabled value="no-classes">
            Create a class first
          </option>
        )}
      </select>
      {(error || hint || !hasClasses) && (
        <p
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ?? hint ?? "Create a class first"}
        </p>
      )}
    </div>
  );
}

/**
 * Derive an Assignment from a StudentDto. Used by the dialogs to seed
 * their form state from an existing student.
 */
export function assignmentFromStudent(student: {
  classId?: string | null;
  sectionId?: string | null;
  section?: {
    classId?: string;
    class?: { id?: string } | null;
  } | null;
}): Assignment {
  // Prefer the explicit classId on the student; fall back to derivation
  // from the section (older students migrated from a section-only world
  // still have this relation populated).
  const classId =
    student.classId ??
    student.section?.classId ??
    student.section?.class?.id ??
    null;
  return {
    classId,
    sectionId: student.sectionId ?? null,
  };
}

export function formatStudentAssignment(
  student: {
    class?: { name: string } | null;
    section?: {
      name: string;
      class?: {
        name: string;
      } | null;
    } | null;
  },
  fallback = "Unassigned",
) {
  const sectionName = student.section?.name?.trim();
  const sectionClassName = student.section?.class?.name?.trim();
  const className = student.class?.name?.trim() ?? sectionClassName;

  // Section set → class · section
  if (className && sectionName) {
    return `${className} - ${sectionName}`;
  }
  // Class-only (no section) — common in small schools.
  if (className) {
    return `${className} - whole class`;
  }
  return fallback;
}

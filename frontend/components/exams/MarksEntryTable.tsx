"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { gradeWithSplit, type SplitGradeResult } from "@/lib/grading";
import type { ExamSubjectDto } from "@/lib/exams";
import type { StudentDto } from "@/lib/students";
import { cn } from "@/lib/utils";

/**
 * One in-progress mark entry. We store theory/practical as STRINGS
 * (not numbers) so the input can be cleared, partially typed, or hold
 * an invalid value while the user is typing — without losing focus or
 * spuriously coercing 0. The save action coerces to numbers right
 * before submitting.
 */
export interface MarkEntryDraft {
  /** Raw string from the input. Empty = "no mark entered yet". */
  theory: string;
  /** Raw string. Empty = "0" for theory-only subjects, blank otherwise. */
  practical: string;
}

export type MarksMap = Record<string, MarkEntryDraft>;

export interface MarksEntryTableProps {
  /** Students to render — already pre-filtered to the right scope. */
  students: StudentDto[];
  /** The single subject every row writes marks for. */
  subject: ExamSubjectDto;
  /** Map keyed by studentId. The page owns the state. */
  marks: MarksMap;
  /**
   * Called when a single cell changes. The page merges the patch into
   * its `marks` state.
   */
  onChange: (studentId: string, patch: Partial<MarkEntryDraft>) => void;
  /** True when a save is in flight — disables every input. */
  saving?: boolean;
}

/**
 * Single-subject bulk marks entry table. One row per student, columns:
 *
 *   Student | Symbol | Theory (input) | Practical (input, if any) | Grade preview
 *
 * The grade preview is computed client-side via `gradeWithSplit` —
 * matches the backend's NEB pass rule exactly so what the user sees
 * here is what they'll see on the saved marksheet.
 *
 * Tab navigation is the browser default in DOM order, which means:
 *   theory(s1) → practical(s1) → theory(s2) → practical(s2) → …
 *
 * Inline validation:
 *   • marks > fullMarks → red border + tiny error caption
 *   • marks not a number → same treatment
 *   • blank input is ALLOWED — that's "no mark for this student in
 *     this batch"; the parent filters those out before submitting.
 */
export function MarksEntryTable({
  students,
  subject,
  marks,
  onChange,
  saving = false,
}: MarksEntryTableProps) {
  const hasPractical = subject.practicalFullMarks > 0;

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Th className="rounded-tl-lg w-10">#</Th>
              <Th>Student</Th>
              <Th>Symbol</Th>
              <Th className="text-right w-32">
                Theory <span className="text-muted-foreground/60 font-normal">/ {subject.theoryFullMarks}</span>
              </Th>
              {hasPractical && (
                <Th className="text-right w-32">
                  Practical{" "}
                  <span className="text-muted-foreground/60 font-normal">
                    / {subject.practicalFullMarks}
                  </span>
                </Th>
              )}
              <Th className="text-right w-40 rounded-tr-lg">Grade preview</Th>
            </tr>
          </thead>
          <tbody>
            {students.map((s, idx) => {
              const draft = marks[s.id] ?? { theory: "", practical: "" };
              return (
                <Row
                  key={s.id}
                  index={idx + 1}
                  student={s}
                  draft={draft}
                  subject={subject}
                  onChange={(patch) => onChange(s.id, patch)}
                  saving={saving}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Row({
  index,
  student,
  draft,
  subject,
  onChange,
  saving,
}: {
  index: number;
  student: StudentDto;
  draft: MarkEntryDraft;
  subject: ExamSubjectDto;
  onChange: (patch: Partial<MarkEntryDraft>) => void;
  saving: boolean;
}) {
  const hasPractical = subject.practicalFullMarks > 0;

  // Parse + validate. We hold strings in state so the input can be
  // empty / mid-edit; parsing happens at render time for the preview.
  const theoryParse = parseMarks(draft.theory, subject.theoryFullMarks);
  const practicalParse = hasPractical
    ? parseMarks(draft.practical, subject.practicalFullMarks)
    : { value: 0, valid: true, blank: true, error: null as string | null };

  // Compute grade preview only when BOTH inputs are usable — partial
  // input shows an em-dash so we don't flash misleading "NG" on a
  // half-typed row.
  const bothEnteredAndValid =
    !theoryParse.blank &&
    theoryParse.valid &&
    practicalParse.valid &&
    (!hasPractical || !practicalParse.blank);
  const preview: SplitGradeResult | null = bothEnteredAndValid
    ? gradeWithSplit(
        theoryParse.value,
        subject.theoryFullMarks,
        practicalParse.value,
        subject.practicalFullMarks,
      )
    : null;

  return (
    <tr className="border-t border-border hover:bg-muted/40 transition-colors">
      <Td className="text-muted-foreground/70 tabular-nums">{index}</Td>
      <Td>
        <span className="font-medium text-foreground">
          {student.firstName} {student.lastName}
        </span>
      </Td>
      <Td className="text-muted-foreground tabular-nums">
        {student.symbolNumber ?? "—"}
      </Td>

      <Td className="text-right">
        <MarkInput
          value={draft.theory}
          onChange={(v) => onChange({ theory: v })}
          maxFullMarks={subject.theoryFullMarks}
          error={theoryParse.error}
          disabled={saving}
          aria-label={`Theory marks for ${student.firstName} ${student.lastName}`}
        />
      </Td>

      {hasPractical && (
        <Td className="text-right">
          <MarkInput
            value={draft.practical}
            onChange={(v) => onChange({ practical: v })}
            maxFullMarks={subject.practicalFullMarks}
            error={practicalParse.error}
            disabled={saving}
            aria-label={`Practical marks for ${student.firstName} ${student.lastName}`}
          />
        </Td>
      )}

      <Td className="text-right">
        <GradePreview preview={preview} />
      </Td>
    </tr>
  );
}

function MarkInput({
  value,
  onChange,
  maxFullMarks,
  error,
  disabled,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  maxFullMarks: number;
  error: string | null;
  disabled: boolean;
  // Omit the native onChange/value so our custom (string) signature
  // doesn't intersect-conflict with React.ChangeEventHandler.
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
>) {
  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <input
        {...rest}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={0}
        max={maxFullMarks}
        step={0.5}
        disabled={disabled}
        aria-invalid={!!error}
        className={cn(
          "h-9 w-24 rounded-md border bg-surface px-2 text-right text-sm tabular-nums text-foreground",
          "focus:outline-none focus:ring-2",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          error
            ? "border-destructive focus:border-destructive focus:ring-destructive/25"
            : "border-border focus:border-primary focus:ring-primary/25",
        )}
      />
      {error && (
        <span className="text-[10px] text-destructive leading-none">
          {error}
        </span>
      )}
    </div>
  );
}

function GradePreview({ preview }: { preview: SplitGradeResult | null }) {
  if (!preview) {
    return <span className="text-xs text-muted-foreground italic">—</span>;
  }
  const failed = preview.failedComponent;
  // Pills use solid color tokens with `dark:` overrides — the tinted
  // backgrounds keep the same visual language in both themes (red for
  // fail, emerald for pass) but pick a darker tint that reads on the
  // dark surface.
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ring-inset",
        failed
          ? "bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900/60"
          : "bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/60",
      )}
      title={`${preview.percentage.toFixed(1)}% — ${preview.description}`}
    >
      {!failed && <CheckCircle2 className="h-3 w-3" />}
      {preview.letterGradeLabel}
      <span className="text-muted-foreground font-normal">
        · {preview.percentage.toFixed(0)}%
      </span>
    </span>
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
    <th className={cn("h-10 px-3 align-middle", className)}>{children}</th>
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
    <td className={cn("px-3 py-2.5 align-middle", className)}>{children}</td>
  );
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface ParseResult {
  value: number;
  valid: boolean;
  blank: boolean;
  error: string | null;
}

/**
 * Parse a raw input string into a marks value + validation flags.
 * Empty string is "blank" (not an error — just no entry yet). Negative
 * numbers, NaN, and over-full-marks all return an error.
 */
function parseMarks(raw: string, fullMarks: number): ParseResult {
  if (raw === "") {
    return { value: 0, valid: true, blank: true, error: null };
  }
  const n = Number(raw);
  if (Number.isNaN(n)) {
    return { value: 0, valid: false, blank: false, error: "Invalid" };
  }
  if (n < 0) {
    return { value: n, valid: false, blank: false, error: "≥ 0" };
  }
  if (n > fullMarks) {
    return { value: n, valid: false, blank: false, error: `≤ ${fullMarks}` };
  }
  return { value: n, valid: true, blank: false, error: null };
}

/**
 * Re-export for the parent page to use when building the bulk-save
 * payload. Keeps the validation rule defined in exactly one place.
 */
export { parseMarks };

"use client";

import * as React from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { FeatureGate } from "@/components/platform/FeatureGate";
import { FeatureKey } from "@/lib/features";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAcademicSession } from "@/components/academic-session/AcademicSessionProvider";
import { useMyTeachingAssignments } from "@/lib/teaching-assignments";
import {
  useLearningOutcomesByClassAndSubject,
  type LearningOutcomeDto,
} from "@/lib/learning-outcomes";
import {
  useContinuousRecordsForClassStudents,
  type ContinuousRecordDto,
} from "@/lib/continuous-records";
import { useStudents } from "@/lib/students";
import type { StudentDto } from "@/lib/students";
import {
  subjectNameToCode,
  type SubjectCode,
} from "@/lib/subject-aliases";
import { cn } from "@/lib/utils";

// ============================================================================
// /student-evaluation/.../outcomes/[outcomeId] — OUTCOME RATING SCREEN (6a).
//
// The screen the brief is most opinionated about. Session 6a wires it
// to three real data sources:
//
//   1. The CDC outcome itself — re-uses the same
//      `useLearningOutcomesByClassAndSubject` cache the unit-view
//      screen populated, then filters to the one outcome by id.
//   2. The class roster — `useStudents({ classId, sectionId? })`.
//   3. Existing ratings for those students × this outcome — fanned
//      out across N parallel calls via
//      `useContinuousRecordsForClassStudents`.
//
// Critical design constraints (carried from Session 5):
//   • Rating buttons remain VISUALLY tappable + animate with React-
//     local state. NO mutation happens — taps don't persist past
//     refresh. Session 6b wires the POST. The visual response
//     ("WhatsApp delivery semantics" / sync confidence) is the
//     experience we're validating; the underlying network call is a
//     swap-in.
//   • Sticky outcome header at the top — teacher always sees what
//     they're rating.
//   • Tap targets ≥ 44pt.
//   • Status icons (pending clock / failed red) — Session 6a has no
//     pending or failed states because there's no queue to be in.
//     Only the AMBER follow-up indicators are wired against real
//     data: rating ≤ 2 + no AFTER_SUPPORT → amber dot.
// ============================================================================

const RATING_VALUES: ReadonlyArray<1 | 2 | 3 | 4> = [1, 2, 3, 4];

interface CellState {
  /** REGULAR rating — null until the teacher taps something. */
  rating: 1 | 2 | 3 | 4 | null;
  /** AFTER_SUPPORT rating — read-only display in 6a. */
  afterSupportRating: 1 | 2 | 3 | 4 | null;
  /** Pulse trigger key — bumped on every tap so CSS re-runs. */
  pulseKey: number;
}

function extractClassLevel(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

export default function OutcomeRatingPage() {
  return (
    <FeatureGate
      featureKey={FeatureKey.ConEvaluation}
      featureLabel="Continuous Evaluation"
      message="Continuous Evaluation isn't enabled for your school yet. Contact your administrator to join the pilot."
    >
      <OutcomeRatingView />
    </FeatureGate>
  );
}

function OutcomeRatingView() {
  const params = useParams<{
    classSubjectId: string;
    unitNumber: string;
    outcomeId: string;
  }>();
  const unitNumber = Number(params.unitNumber);

  // Resolve the assignment + the active session for the
  // continuous-records query.
  const assignments = useMyTeachingAssignments();
  const { selected: activeSession } = useAcademicSession();
  const assignment = React.useMemo(
    () =>
      assignments.data?.find((a) => a.id === params.classSubjectId) ?? null,
    [assignments.data, params.classSubjectId],
  );

  const classLevel = assignment
    ? extractClassLevel(assignment.class.name)
    : null;
  const subjectCode: SubjectCode | null = assignment
    ? subjectNameToCode(assignment.subject?.name ?? null)
    : null;

  // Pull the curriculum to find the outcome row.
  const outcomes = useLearningOutcomesByClassAndSubject(
    classLevel ?? 0,
    subjectCode ?? "ENGLISH",
    { enabled: Boolean(classLevel && subjectCode) },
  );
  const outcome: LearningOutcomeDto | null = React.useMemo(
    () =>
      outcomes.data?.find((o) => o.id === params.outcomeId) ?? null,
    [outcomes.data, params.outcomeId],
  );

  // Pull the class roster. The assignment carries classId; section is
  // optional. `useStudents({ classId })` returns every student in
  // that class — if the assignment is section-bound we filter
  // client-side to that section so the teacher only sees their own
  // group. Section filter would normally be a server-side `?sectionId=`
  // but the existing students endpoint doesn't take it; client filter
  // is cheap (one class is <100 rows).
  const studentsQuery = useStudents({
    classId: assignment?.classId,
  });
  const students: StudentDto[] = React.useMemo(() => {
    const list = studentsQuery.data ?? [];
    if (!assignment) return list;
    if (assignment.sectionId) {
      return list.filter((s) => s.sectionId === assignment.sectionId);
    }
    return list;
  }, [studentsQuery.data, assignment]);

  // Fan-out the per-student records query.
  const studentIds = React.useMemo(
    () => students.map((s) => s.id),
    [students],
  );
  const records = useContinuousRecordsForClassStudents(
    studentIds,
    activeSession?.id ?? "",
    {
      enabled: Boolean(activeSession?.id) && studentIds.length > 0,
      subjectCode: subjectCode ?? undefined,
    },
  );

  // Seed local cell state from records once they load. We use a ref
  // to track which student ids we've already seeded so the user's
  // taps aren't wiped by a background refetch.
  const [cells, setCells] = React.useState<Record<string, CellState>>({});
  const seededFor = React.useRef<Set<string>>(new Set());

  // After-support modal target — which student's amber dot was tapped.
  const [afterSupportStudentId, setAfterSupportStudentId] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    if (!outcome) return;
    setCells((prev) => {
      const next: Record<string, CellState> = { ...prev };
      for (const s of students) {
        if (seededFor.current.has(s.id)) continue;
        const studentRecs = records.byStudentId.get(s.id) ?? [];
        const regular = studentRecs.find(
          (r) => r.phase === "REGULAR" && r.outcomeId === outcome.id,
        );
        const after = studentRecs.find(
          (r) => r.phase === "AFTER_SUPPORT" && r.outcomeId === outcome.id,
        );
        next[s.id] = {
          rating: (regular?.rating ?? null) as CellState["rating"],
          afterSupportRating:
            (after?.rating ?? null) as CellState["afterSupportRating"],
          pulseKey: 0,
        };
        seededFor.current.add(s.id);
      }
      return next;
    });
  }, [outcome, students, records.byStudentId]);

  // Last-saved memo so the Undo toast can roll back the local tap.
  const lastChangeRef = React.useRef<{
    studentId: string;
    prev: CellState;
  } | null>(null);

  // First-name disambiguation — collision-aware. Carried from
  // Session 5, behavior unchanged.
  const displayName = React.useMemo(() => {
    const byFirst = new Map<string, StudentDto[]>();
    for (const s of students) {
      const list = byFirst.get(s.firstName) ?? [];
      list.push(s);
      byFirst.set(s.firstName, list);
    }
    const out: Record<string, string> = {};
    for (const [first, group] of byFirst) {
      if (group.length === 1) {
        out[group[0].id] = first;
        continue;
      }
      const liGroups = new Map<string, StudentDto[]>();
      for (const s of group) {
        const li = s.lastName.charAt(0).toUpperCase();
        const g = liGroups.get(li) ?? [];
        g.push(s);
        liGroups.set(li, g);
      }
      for (const [li, gs] of liGroups) {
        if (gs.length === 1) {
          out[gs[0].id] = `${first} ${li}.`;
        } else {
          for (const s of gs) out[s.id] = `${first} ${s.lastName}`;
        }
      }
    }
    return out;
  }, [students]);

  function applyRating(student: StudentDto, value: 1 | 2 | 3 | 4) {
    // Wireframe behavior — Session 6a does NOT persist. Pure local
    // state, matching Session 5's behavior. Refresh reverts.
    const prev = cells[student.id];
    setCells((c) => ({
      ...c,
      [student.id]: {
        ...c[student.id],
        rating: value,
        pulseKey: c[student.id].pulseKey + 1,
      },
    }));
    lastChangeRef.current = { studentId: student.id, prev };
    toast("Saved", {
      duration: 2000,
      description: "(not persisted yet — Session 6b wires the POST)",
      action: {
        label: "Undo",
        onClick: () => {
          const last = lastChangeRef.current;
          if (!last) return;
          setCells((c) => ({ ...c, [last.studentId]: last.prev }));
        },
      },
    });
  }

  // ----- Early-exit branches -----
  if (assignments.isLoading || outcomes.isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-12 w-full mb-3" />
        <SkeletonStudentRows count={6} />
      </div>
    );
  }
  if (!assignment || Number.isNaN(unitNumber)) {
    notFound();
  }
  if (!classLevel || !subjectCode || !outcome) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <BackLink assignmentId={assignment.id} unitNumber={unitNumber} />
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="Outcome not found"
          description={
            !classLevel
              ? `Couldn't determine the grade level from class name "${assignment.class.name}".`
              : !subjectCode
                ? `Subject "${assignment.subject?.name ?? "(none)"}" isn't part of the CDC curriculum.`
                : "This outcome may have been removed or you don't have access."
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <BackLink assignmentId={assignment.id} unitNumber={unitNumber} />

      {/* Sticky outcome header — teacher always sees what they're
          rating. Same shape as Session 5; copy now comes from the
          real LearningOutcome row. */}
      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:-mx-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Outcome · {skillLabel(outcome.skillArea)}
        </p>
        <h1 className="mt-1 text-base font-medium text-foreground leading-snug">
          “{outcome.descriptionEn}”
        </h1>
      </div>

      {!activeSession ? (
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="No active academic session"
          description="Your school doesn't have an active academic session right now. An admin needs to set one before ratings can be loaded."
        />
      ) : studentsQuery.isLoading ? (
        <SkeletonStudentRows count={6} />
      ) : studentsQuery.isError ? (
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="Couldn't load students"
          description="Something went wrong on our side. Tap retry to try again."
          action={{ label: "Retry", onClick: () => studentsQuery.refetch() }}
        />
      ) : students.length === 0 ? (
        <EmptyState
          icon={<span className="text-2xl">🪑</span>}
          title="No students in this class"
          description="No students are enrolled in this class yet."
        />
      ) : (
        <ul className="flex flex-col">
          {students.map((s) => (
            <StudentRatingRow
              key={s.id}
              student={s}
              displayName={displayName[s.id] ?? s.firstName}
              cell={cells[s.id] ?? { rating: null, afterSupportRating: null, pulseKey: 0 }}
              loadingRating={
                records.isLoading && !records.byStudentId.has(s.id)
              }
              onRate={(value) => applyRating(s, value)}
              onAfterSupportClick={() => setAfterSupportStudentId(s.id)}
            />
          ))}
        </ul>
      )}

      <AfterSupportModalConditional
        students={students}
        outcomeText={outcome.descriptionEn ?? ""}
        afterSupportStudentId={afterSupportStudentId}
        currentAfterSupport={
          afterSupportStudentId
            ? cells[afterSupportStudentId]?.afterSupportRating ?? null
            : null
        }
        onClose={() => setAfterSupportStudentId(null)}
      />

      <style jsx>{`
        :global(.cdc-pulse) {
          animation: cdc-pulse 320ms ease-out;
        }
        @keyframes cdc-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.18); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );

}

interface AfterSupportModalConditionalProps {
  students: StudentDto[];
  outcomeText: string;
  afterSupportStudentId: string | null;
  currentAfterSupport: 1 | 2 | 3 | 4 | null;
  onClose: () => void;
}

function AfterSupportModalConditional({
  students,
  outcomeText,
  afterSupportStudentId,
  currentAfterSupport,
  onClose,
}: AfterSupportModalConditionalProps) {
  const student = afterSupportStudentId
    ? students.find((s) => s.id === afterSupportStudentId) ?? null
    : null;
  return (
    <AfterSupportModal
      student={student}
      outcomeText={outcomeText}
      currentAfterSupport={currentAfterSupport}
      onClose={onClose}
    />
  );
}

interface StudentRatingRowProps {
  student: StudentDto;
  displayName: string;
  cell: CellState;
  loadingRating: boolean;
  onRate: (value: 1 | 2 | 3 | 4) => void;
  onAfterSupportClick: () => void;
}

function StudentRatingRow({
  student,
  displayName,
  cell,
  loadingRating,
  onRate,
  onAfterSupportClick,
}: StudentRatingRowProps) {
  const needsFollowUp =
    cell.rating !== null && cell.rating <= 2 && cell.afterSupportRating === null;
  const followUpComplete =
    cell.rating !== null && cell.rating <= 2 && cell.afterSupportRating !== null;

  return (
    <li className="flex items-center gap-2 border-b border-border/60 py-3 first:border-t">
      <div className="w-10 shrink-0 text-right tabular-nums text-sm text-muted-foreground">
        {student.symbolNumber ?? "—"}.
      </div>
      <div className="flex-1 min-w-0 text-sm font-medium text-foreground leading-snug break-words">
        {displayName}
        {/* While the per-student records query is still loading for
            THIS row, surface a small spinner-dot so the teacher
            knows ratings haven't arrived yet — distinct from "this
            student is genuinely unrated". */}
        {loadingRating && (
          <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/40" />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {RATING_VALUES.map((v) => {
          const selected = cell.rating === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onRate(v)}
              aria-label={`Rate ${v}`}
              aria-pressed={selected}
              className={cn(
                "h-11 w-11 rounded-md text-sm font-semibold",
                "flex items-center justify-center",
                "transition-colors duration-100",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                selected
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-foreground hover:bg-muted/80",
                selected && cell.pulseKey > 0 && "cdc-pulse",
              )}
              data-pulse={cell.pulseKey}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-1 pl-1">
        {needsFollowUp && (
          <button
            type="button"
            onClick={onAfterSupportClick}
            aria-label="Record after-support rating"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700 hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
          </button>
        )}
        {followUpComplete && (
          <button
            type="button"
            onClick={onAfterSupportClick}
            aria-label={`After-support rating: ${cell.afterSupportRating}`}
            className="flex h-6 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="leading-none">{cell.afterSupportRating}</span>
            <span aria-hidden>✓</span>
          </button>
        )}
      </div>
    </li>
  );
}

interface AfterSupportModalProps {
  student: StudentDto | null;
  outcomeText: string;
  currentAfterSupport: 1 | 2 | 3 | 4 | null;
  onClose: () => void;
}

function AfterSupportModal({
  student,
  outcomeText,
  currentAfterSupport,
  onClose,
}: AfterSupportModalProps) {
  const [chosen, setChosen] = React.useState<1 | 2 | 3 | 4 | null>(
    currentAfterSupport,
  );
  React.useEffect(() => {
    setChosen(currentAfterSupport);
  }, [currentAfterSupport, student?.id]);

  const todayStr = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Modal
      open={student !== null}
      onClose={onClose}
      title="After-support reassessment"
      description={
        student
          ? `${student.firstName} ${student.lastName}${
              student.symbolNumber ? ` · Roll ${student.symbolNumber}` : ""
            }`
          : undefined
      }
      size="sm"
    >
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs italic text-muted-foreground">
          “{outcomeText}”
        </div>
        <div>
          <p className="mb-2 text-sm text-foreground">
            Re-rate after support given:
          </p>
          <div className="flex gap-2">
            {RATING_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setChosen(v)}
                aria-pressed={chosen === v}
                className={cn(
                  "h-12 flex-1 rounded-md text-base font-semibold",
                  "transition-colors duration-100",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  chosen === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground hover:bg-muted/80",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Reassessment date: {todayStr}
        </p>
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={chosen === null}
          onClick={() => {
            toast("After-support recorded (Session 6a — not persisted)", {
              duration: 2000,
            });
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

function BackLink({
  assignmentId,
  unitNumber,
}: {
  assignmentId: string;
  unitNumber: number;
}) {
  return (
    <Link
      href={`/student-evaluation/${assignmentId}/units/${unitNumber}`}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Unit {unitNumber}
    </Link>
  );
}

function SkeletonStudentRows({ count }: { count: number }) {
  return (
    <ul aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-2 border-b border-border/60 py-3 first:border-t"
        >
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-11 w-44" />
        </li>
      ))}
    </ul>
  );
}

function skillLabel(s: string): string {
  return s
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ");
}

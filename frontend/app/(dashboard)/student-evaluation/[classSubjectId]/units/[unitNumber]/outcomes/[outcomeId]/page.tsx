"use client";

import * as React from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { FeatureGate } from "@/components/platform/FeatureGate";
import { FeatureKey } from "@/lib/features";
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
  useUpsertContinuousRecord,
  type ContinuousRecordDto,
} from "@/lib/continuous-records";
import { useStudents } from "@/lib/students";
import type { StudentDto } from "@/lib/students";
import {
  subjectNameToCode,
  type SubjectCode,
} from "@/lib/subject-aliases";
import {
  extractClassLevel,
  isCdcEligibleClassLevel,
} from "@/lib/class-level";
import {
  applyRatingToCells,
  applySeedToCells,
  EMPTY_CELL,
  type CellState,
  type RatingPhase,
} from "../../../../../_lib/rating-cell";
import { StudentRatingRow } from "../../../../../_components/StudentRatingRow";

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

// (The RATING_VALUES constant was used by the in-page
// AfterSupportModal, removed in Deviation 001. The row component
// owns its own copy.)

// CellState + EMPTY_CELL + applyRatingToCells live in
// ../../../../_lib/rating-cell so the pure update logic can be
// unit-tested without dragging in the page's React Query / session-
// provider tree. See that file's header for the rationale.

// extractClassLevel is imported from @/lib/class-level — see that
// file's header for the parser's fragility notes.

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
  // Gate the fetch on assignment.classId being resolved. Without
  // this, the first render fires `useStudents({ classId: undefined })`
  // which hits `/students` with no filter (fetching the entire
  // school roster), then a second render fires with the real
  // classId — request-pressure panel flagged this as a dupe.
  // `enabled: false` skips the call until we have a real id.
  const studentsQuery = useStudents(
    { classId: assignment?.classId },
    { enabled: Boolean(assignment?.classId) },
  );
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

  // (Deviation 001: the after-support modal flow was removed. The
  // row's AFTER_SUPPORT button group is now always inline. The
  // `afterSupportStudentId` modal-target state used to live here.)

  // Seed local cells from the records fan-out whenever new student
  // data lands. Logic lives in `applySeedToCells` (../_lib/rating-cell)
  // so it can be unit-tested without standing up this whole page.
  //
  // Two invariants the helper preserves that the old inline effect
  // did not — both fixes for the Session 6a infinite-loop bug:
  //
  //   1. Returns `next === prev` (same reference) when there's
  //      nothing new to seed. React's Object.is bail then skips the
  //      re-render, even if `records.byStudentId` wobbled identity
  //      (which the upstream hook now also memos away — defense in
  //      depth at both layers).
  //   2. Skips students whose records haven't loaded yet. Previously
  //      we pre-seeded them with empty cells AND marked them in
  //      `seededFor`, which locked their real data out once it
  //      arrived. Now those students simply stay unseeded until
  //      their data lands.
  //
  // The ref mutation (`seededFor.current.add`) is done OUTSIDE the
  // setCells callback because React StrictMode double-invokes that
  // callback in dev to check purity; a Set.add inside it would run
  // twice and look wrong. Computing the plan before calling setState
  // keeps the callback pure.
  React.useEffect(() => {
    if (!outcome) return;
    const { next, newlySeeded } = applySeedToCells(
      cells,
      students,
      records.byStudentId,
      outcome.id,
      seededFor.current,
    );
    if (next === cells) return; // nothing to seed; effect runs are free
    for (const id of newlySeeded) seededFor.current.add(id);
    setCells(next);
  }, [outcome, students, records.byStudentId, cells]);

  // Session 6b: Undo no longer needs a ref — `previousRating` is
  // captured in the `applyRating` closure and re-applied through the
  // same code path (matching the spec's decision 3: "Undo snackbar
  // fires an immediate POST with the previous value"). The old
  // lastChangeRef cache was removed.

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

  const upsertMutation = useUpsertContinuousRecord();

  // Phase-parameterized rating handler. Both the REGULAR row buttons
  // and the AFTER_SUPPORT row buttons route through this — the only
  // difference is which pair of cell fields (`regular`+`regularSyncStatus`
  // vs `afterSupport`+`afterSupportSyncStatus`) gets updated, and
  // which phase is sent on the wire. Collapsing the two old
  // applyRating / applyAfterSupportRating functions into one keeps
  // the optimistic UI + rollback + toast logic in one place — the
  // post-Deviation-001 contract.
  function applyRating(
    student: StudentDto,
    phase: RatingPhase,
    value: 1 | 2 | 3 | 4,
  ) {
    // Belt-and-braces guard against the race the original bug
    // exposed: the row's button shouldn't be tappable when its
    // continuous-records query is still in flight (we disable it in
    // StudentRatingRow). If a synthetic click sneaks through —
    // keyboard, programmatic dispatch — bail before kicking off a
    // POST against an unseeded cell.
    if (records.isLoading && !records.byStudentId.has(student.id)) {
      return;
    }
    if (!outcome || !activeSession || !subjectCode) return; // type narrowing

    // Previous value for THIS phase, captured for the Undo flow.
    // Each phase has its own previous — undoing a REGULAR tap
    // restores the previous REGULAR; undoing an AFTER_SUPPORT tap
    // restores the previous AFTER_SUPPORT.
    const prev = cells[student.id] ?? EMPTY_CELL;
    const previousValue = phase === "REGULAR" ? prev.regular : prev.afterSupport;

    // OPTIMISTIC UI: apply the new value with syncStatus 'pending'
    // immediately. The button fills, the pulse animation runs, the
    // per-phase clock icon appears — all before the network round-
    // trip resolves. "WhatsApp delivery semantics" — every tap feels
    // landed even when the server hasn't confirmed yet.
    setCells((c) =>
      applyRatingToCells(c, student.id, phase, value, "pending"),
    );

    upsertMutation.mutate(
      {
        studentId: student.id,
        outcomeId: outcome.id,
        sessionId: activeSession.id,
        phase,
        rating: value,
        subjectCode,
      },
      {
        onSuccess: () => {
          // Server confirmed. Transition the cell to 'synced' — the
          // clock icon disappears (back to "silence is success").
          setCells((c) =>
            applyRatingToCells(c, student.id, phase, value, "synced"),
          );
          toast(phase === "REGULAR" ? "Saved" : "After-support saved", {
            duration: 2000,
            action: {
              label: "Undo",
              onClick: () => {
                if (previousValue === null) {
                  // No previous value for THIS phase to restore —
                  // backend has no DELETE endpoint yet (Session 6c+
                  // may add it). Surface this honestly rather than
                  // pretending to undo.
                  toast(
                    "Cannot undo to unrated — delete endpoint not available yet.",
                  );
                  return;
                }
                // Undo treats the previous value as a new tap on the
                // SAME phase. Re-fires the same code path so pending/
                // synced indicators + history-row parity come along
                // for free.
                applyRating(student, phase, previousValue);
              },
            },
          });
        },
        onError: (error) => {
          // WhatsApp-style failure preservation: KEEP the attempted
          // value visible with the matching phase's sync status set
          // to 'failed' rather than rolling back. The teacher sees
          // "you tried to set 4, it didn't land — tap the red icon
          // to retry." Per-phase failure is independent: a failed
          // AFTER_SUPPORT POST doesn't disturb a confirmed REGULAR
          // value on the same row.
          setCells((c) =>
            applyRatingToCells(c, student.id, phase, value, "failed"),
          );
          // Backend's `message` is operator-friendly when present
          // (e.g. "This session is locked. Writes are no longer
          // permitted.") — surface it verbatim.
          const fallback =
            phase === "REGULAR"
              ? "Couldn't save the rating."
              : "Couldn't save after-support rating.";
          const message = error.message?.trim() || fallback;
          toast.error(message, { duration: 5000 });
        },
      },
    );
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

  // -------------------------------------------------------------------------
  // CDC class-level eligibility gate (Deviation 002 — classes 1-5 only).
  // Same defense-in-depth pattern as the units overview screen:
  // catch class 6+ assignments before the existing missing-data
  // guard so the message is specific. Bookmarks and shared URLs are
  // the dominant entry path here; without this gate a teacher
  // pasting a /student-evaluation/.../outcomes/... URL for class 7
  // would see the generic "outcome not found" copy instead of the
  // accurate "not eligible" copy.
  //
  // Hook-safety: all hooks in OutcomeRatingView are above the
  // assignments.isLoading / outcomes.isLoading early returns at
  // line ~367. This branch lives in the same early-exit block; no
  // hooks below it.
  // -------------------------------------------------------------------------
  if (classLevel !== null && !isCdcEligibleClassLevel(classLevel)) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <BackLink assignmentId={assignment.id} unitNumber={unitNumber} />
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="This class isn't eligible for CDC evaluation"
          description="Continuous Evaluation only applies to classes 1-5. This class uses traditional grading."
          action={{
            label: "Back to assignments",
            onClick: () => {
              window.location.href = "/student-evaluation";
            },
          }}
        />
      </div>
    );
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
          rating. Added a one-line explainer under the outcome text
          for Deviation 001 so the two-column layout's intent is
          self-documenting on the screen, not just in the code. */}
      <div className="sticky top-0 z-20 -mx-4 mb-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:-mx-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          Outcome · {skillLabel(outcome.skillArea)}
        </p>
        <h1 className="mt-1 text-base font-medium text-foreground leading-snug">
          “{outcome.descriptionEn}”
        </h1>
        <p className="mt-2 text-xs text-muted-foreground leading-snug">
          Tap <span className="font-semibold">Regular</span> for the
          initial assessment. Tap{" "}
          <span className="font-semibold">After support</span> to
          record reassessment (defaults to Regular's value).
        </p>
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
              cell={cells[s.id] ?? EMPTY_CELL}
              loadingRating={
                records.isLoading && !records.byStudentId.has(s.id)
              }
              onRate={(phase, value) => applyRating(s, phase, value)}
              onRetry={(phase) => {
                // Failed-icon retry — re-fires applyRating with the
                // currently-displayed value for THIS phase. Same code
                // path as a fresh tap, including a new optimistic-
                // pending → synced/failed transition. Per Deviation
                // 001's per-phase failure independence: REGULAR's
                // retry button reads cell.regular, AFTER_SUPPORT's
                // retry button reads cell.afterSupport.
                const cell = cells[s.id];
                if (!cell) return;
                const v =
                  phase === "REGULAR" ? cell.regular : cell.afterSupport;
                if (v !== null) applyRating(s, phase, v);
              }}
            />
          ))}
        </ul>
      )}

      {/* AfterSupportModal removed in Deviation 001 — both phase
          inputs live inline on the row now. */}

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

// AfterSupportModal + AfterSupportModalConditional were removed in
// Deviation 001 (see backend/docs/cdc-compliance-deviations.md). The
// per-row inline AFTER_SUPPORT button group replaces the modal flow.
// StudentRatingRow lives in ../../../../../_components/StudentRatingRow.tsx.

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

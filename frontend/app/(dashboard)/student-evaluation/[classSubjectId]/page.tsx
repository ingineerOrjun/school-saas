"use client";

import * as React from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, ChevronRight } from "lucide-react";
import { FeatureGate } from "@/components/platform/FeatureGate";
import { FeatureKey } from "@/lib/features";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMyTeachingAssignments } from "@/lib/teaching-assignments";
import { useLearningOutcomesByClassAndSubject } from "@/lib/learning-outcomes";
import {
  subjectNameToCode,
  type SubjectCode,
} from "@/lib/subject-aliases";
import { SyncStatusBar } from "../_components/SyncStatusBar";

// ============================================================================
// /student-evaluation/[classSubjectId] — Class+Subject workspace (6a).
//
// Resolves the route param to a TeachingAssignment from the cached
// `useMyTeachingAssignments` result, then fetches the CDC learning
// outcomes for that (classLevel, subjectCode) pair. Renders one card
// per unit.
//
// Session 6a omits the per-unit progress bar + percentage — those
// require a separate aggregation the backend doesn't expose. Every
// unit card shows "Not started" as a placeholder (matching the spec's
// Step 6 recommendation). Session 6b will compute real progress
// once we have the per-class ratings query (or a backend-side
// aggregation).
//
// Class level parsing: `Class.name` is free-text in the schema with
// no separate `classLevel` integer column. We extract the first
// integer from the name (e.g. "Class 4" → 4, "Grade 5B" → 5). If no
// integer is found, the page renders a focused error rather than
// silently fetching `classLevel=0` and producing an empty result —
// the alternative would falsely look like "this assignment has no
// outcomes" when really it's a parse failure.
// ============================================================================

export default function ClassSubjectWorkspacePage() {
  return (
    <FeatureGate
      featureKey={FeatureKey.ConEvaluation}
      featureLabel="Continuous Evaluation"
      message="Continuous Evaluation isn't enabled for your school yet. Contact your administrator to join the pilot."
    >
      <ClassSubjectWorkspaceView />
    </FeatureGate>
  );
}

/** Extract the first integer 1..12 from a Class.name. Returns null
 *  when the name has no parseable level (e.g. "Class XI" Roman
 *  numerals — out of scope for 6a). */
function extractClassLevel(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function ClassSubjectWorkspaceView() {
  const params = useParams<{ classSubjectId: string }>();

  // The home page passed `assignment.id`. Resolve it from the cached
  // assignments query — no separate fetch needed for the common path,
  // and on direct deep-link the hook fires the same single request
  // it would have anyway.
  const assignments = useMyTeachingAssignments();
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

  // Outcomes fetch — only fires once we know both the level and code.
  // `enabled: false` until both are present, so deep-links don't fire
  // a broken `?classLevel=&subject=` request.
  const outcomes = useLearningOutcomesByClassAndSubject(
    classLevel ?? 0,
    subjectCode ?? "ENGLISH",
    { enabled: Boolean(classLevel && subjectCode) },
  );

  // Loading guard for the assignment lookup itself. The cache is
  // usually warm (home page just rendered it), but on direct deep-
  // link we need to wait.
  if (assignments.isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <SyncStatusBar />
        <Skeleton className="h-9 w-2/3 mb-2" />
        <Skeleton className="h-4 w-1/3 mb-5" />
        <SkeletonUnitStack count={3} />
      </div>
    );
  }
  if (!assignment) {
    // Unknown id (assignment for a different teacher, or stale link).
    notFound();
  }

  if (!classLevel || !subjectCode) {
    // Either the class name didn't carry a parseable integer, or the
    // subject name doesn't map to a CDC code. Either is a config
    // issue; surface a focused message.
    return (
      <div className="mx-auto w-full max-w-2xl">
        <SyncStatusBar />
        <BackLink />
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="This class isn't ready for CDC"
          description={
            !classLevel
              ? `Couldn't determine the grade level from class name "${assignment.class.name}". Ask an admin to rename it to include a grade number (e.g. "Class 4").`
              : `Subject "${assignment.subject?.name ?? "(none)"}" isn't part of the CDC curriculum. Reach out to your admin if you think this is wrong.`
          }
        />
      </div>
    );
  }

  // Group outcomes by unitNumber. Outcomes arrive ordered by
  // unitNumber then sortOrder, so a Map preserves the right traversal
  // order automatically.
  const unitsMap = React.useMemo(() => {
    const m = new Map<
      number,
      { unitNumber: number; unitTitleEn: string | null; count: number }
    >();
    for (const o of outcomes.data ?? []) {
      const existing = m.get(o.unitNumber);
      if (existing) {
        existing.count += 1;
      } else {
        m.set(o.unitNumber, {
          unitNumber: o.unitNumber,
          unitTitleEn: o.unitTitleEn,
          count: 1,
        });
      }
    }
    return m;
  }, [outcomes.data]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <SyncStatusBar />
      <BackLink />

      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {assignment.class.name}
          {assignment.section ? ` ${assignment.section.name}` : ""} ·{" "}
          {assignment.subject?.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CDC Class {classLevel} curriculum
        </p>
      </header>

      {outcomes.isLoading ? (
        <SkeletonUnitStack count={3} />
      ) : outcomes.isError ? (
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="Couldn't load curriculum"
          description="Something went wrong on our side. Tap retry to try again."
          action={{
            label: "Retry",
            onClick: () => outcomes.refetch(),
          }}
        />
      ) : unitsMap.size === 0 ? (
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="No outcomes seeded yet"
          description={`The CDC curriculum for Class ${classLevel} ${subjectCode} isn't loaded in this environment yet. Contact your administrator.`}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {Array.from(unitsMap.values()).map((u) => (
            <li key={u.unitNumber}>
              <Link
                href={`/student-evaluation/${assignment.id}/units/${u.unitNumber}`}
                className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
                aria-label={`Open Unit ${u.unitNumber}: ${u.unitTitleEn ?? ""}`}
              >
                <Card className="hover:border-primary/40 hover:shadow-sm transition-all active:scale-[0.99]">
                  <div className="flex items-center gap-3 p-4">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-base font-semibold text-foreground">
                        Unit {u.unitNumber}
                        {u.unitTitleEn ? `: ${u.unitTitleEn}` : ""}
                      </h2>

                      {/* Session 6a: no progress bar. Placeholder status
                          line ("Not started") communicates intent
                          without lying. Session 6b will derive real
                          state from the ratings query. */}
                      <p className="mt-2 text-sm text-muted-foreground">
                        {u.count} outcome{u.count === 1 ? "" : "s"} · Not started
                      </p>
                    </div>
                    <ChevronRight
                      className="h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/student-evaluation"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
    >
      <ArrowLeft className="h-4 w-4" />
      All classes
    </Link>
  );
}

function SkeletonUnitStack({ count }: { count: number }) {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <Card>
            <div className="p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="mt-3 h-3 w-1/2" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronRight,
  CheckCircle2,
  GraduationCap,
} from "lucide-react";
import { FeatureGate } from "@/components/platform/FeatureGate";
import { FeatureKey } from "@/lib/features";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  useMyTeachingAssignments,
  type TeachingAssignmentDto,
} from "@/lib/teaching-assignments";
import { subjectNameToCode } from "@/lib/subject-aliases";
import {
  extractClassLevel,
  isCdcEligibleClassLevel,
} from "@/lib/class-level";
import { SyncStatusBar } from "./_components/SyncStatusBar";

// ============================================================================
// /student-evaluation — Home (Session 6a real-data wiring).
//
// Replaces Session 5's mockAssignments with the live
// `useMyTeachingAssignments()` query. Filters client-side to assignments
// whose subject maps to a CDC SubjectCode (see lib/subject-aliases.ts —
// mirrors the backend's SUBJECT_CODE_NAME_ALIASES dictionary).
//
// Status counts ("X outcomes pending", "Y need follow-up") are
// INTENTIONALLY OMITTED in 6a — they require aggregations the backend
// doesn't expose yet. Session 6b will compute them once mutations are
// wired and a derived endpoint can be added. For now, the card shows
// only the headline info (class · subject · student count).
//
// Design-brief anchors (verbatim from the prompts that pre-date the
// brief file being written):
//   • "Sync confidence" — the home page surfaces no sync state; the
//     SyncStatusBar above is invisible in the dominant online path.
//   • "Classroom-native, not corporate CRM" — language is "Class 4B ·
//     English", "30 students". No "Active Engagements" / "KPI cards".
//   • "Design for the dominant path" — the entire card is the tap
//     target. One assignment per row, no decoy controls.
// ============================================================================

export default function StudentEvaluationHomePage() {
  return (
    <FeatureGate
      featureKey={FeatureKey.ConEvaluation}
      featureLabel="Continuous Evaluation"
      message="Continuous Evaluation isn't enabled for your school yet. Contact your administrator to join the pilot."
    >
      <StudentEvaluationHomeView />
    </FeatureGate>
  );
}

function StudentEvaluationHomeView() {
  const query = useMyTeachingAssignments();

  // Filter to CDC-eligible assignments. Two gates:
  //   1. Subject is one of the CDC subjects (subjectNameToCode).
  //   2. Class level is 1-5 inclusive (isCdcEligibleClassLevel).
  //
  // Both gates are conservative — anything that can't be parsed /
  // mapped is excluded. Better to hide an eligible class than to
  // show an ineligible one and crash on the downstream outcome
  // fetch.
  //
  // `hiddenForClassLevel` counts assignments whose SUBJECT qualified
  // but were dropped because the class level fell outside 1-5. We
  // surface that count in a footer note so the teacher knows what
  // happened ("1 of your assignments uses traditional grading...").
  // Assignments whose subject didn't qualify (e.g. Music, Computer)
  // are intentionally NOT counted — those are out-of-scope for CDC
  // entirely, not just for this product gate, so a separate count
  // would be noise.
  const cdcAssignments = React.useMemo(() => {
    const all = query.data ?? [];

    const eligible = all.filter((a) => {
      const code = subjectNameToCode(a.subject?.name ?? null);
      if (!code) return false;
      const level = extractClassLevel(a.class?.name ?? "");
      if (!isCdcEligibleClassLevel(level)) return false;
      return true;
    });

    const subjectEligible = all.filter(
      (a) => subjectNameToCode(a.subject?.name ?? null) !== null,
    );
    const hiddenForClassLevel = subjectEligible.length - eligible.length;

    return { eligible, hiddenForClassLevel };
  }, [query.data]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <SyncStatusBar />

      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Student Evaluation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          CDC continuous evaluation. Tap a class to rate students against
          learning outcomes.
        </p>
      </header>

      {query.isLoading ? (
        <SkeletonStack count={2} />
      ) : query.isError ? (
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="Couldn't load your classes"
          description="Something went wrong on our side. Tap retry to try again."
          action={{
            label: "Retry",
            onClick: () => query.refetch(),
          }}
        />
      ) : cdcAssignments.eligible.length === 0 ? (
        // Two empty-state variants:
        //   • If we hid any class-6+ assignments, surface that
        //     explicitly so the teacher understands why they see
        //     "nothing" despite having a CDC subject. The product-
        //     gate phrasing ("traditional grading") matches the
        //     footer note's language.
        //   • Otherwise the teacher genuinely has no CDC-subject
        //     assignment yet — fall back to the original copy.
        cdcAssignments.hiddenForClassLevel > 0 ? (
          <EmptyState
            icon={<GraduationCap className="h-8 w-8" />}
            title="No assignments in classes 1-5"
            description="Continuous Evaluation only applies to primary grades (1-5). Your current assignments use traditional grading."
          />
        ) : (
          <EmptyState
            icon={<GraduationCap className="h-8 w-8" />}
            title="No CDC classes"
            description="You don't have any classes that use Continuous Evaluation yet. Once an admin assigns you a CDC subject, it'll appear here."
          />
        )
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {cdcAssignments.eligible.map((a: TeachingAssignmentDto) => (
              <li key={a.id}>
                <Link
                  href={`/student-evaluation/${a.id}`}
                  className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
                  aria-label={`Open ${a.class.name}${a.section ? " " + a.section.name : ""} ${a.subject?.name ?? ""}`}
                >
                  <Card className="hover:border-primary/40 hover:shadow-sm transition-all active:scale-[0.99]">
                    <div className="flex items-center gap-3 p-4">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-semibold text-foreground">
                          {/* "Class 4B · English" composition. Section is
                              optional on the assignment shape so we
                              conditionally append it. */}
                          {a.class.name}
                          {a.section ? ` ${a.section.name}` : ""} ·{" "}
                          {a.subject?.name ?? "Subject"}
                        </h2>

                        {/* 6a placeholder — student count would also be
                            a derived field; until the backend exposes
                            per-assignment student count, we hint at
                            intent without lying about a number. The
                            headline still tells the teacher what they
                            tapped. */}
                        <p className="mt-1 text-xs text-muted-foreground italic">
                          Tap to view units and rate students
                        </p>

                        {/* Session 5's three-stat block (outcomes
                            pending, students need follow-up, "all
                            caught up ✓") needs aggregations that
                            aren't on the backend yet. Omitted for 6a;
                            tracked in the 6b/6c debt list. */}
                        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle2
                            className="h-3.5 w-3.5"
                            aria-hidden
                          />
                          Status counts arrive in Session 6b
                        </div>
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

          {/* Footer note about hidden non-CDC-class assignments. Only
              renders when at least one class-6+ assignment was
              dropped. Keeps the teacher informed without making the
              gate feel like a bug ("where did my class 7 English
              go?"). Singular/plural copy is the small-detail-matters
              kind of thing teachers notice. */}
          {cdcAssignments.hiddenForClassLevel > 0 && (
            <p className="mt-6 text-sm text-muted-foreground">
              {cdcAssignments.hiddenForClassLevel === 1
                ? "1 of your assignments uses traditional grading (class 6 or above) and isn't shown here."
                : `${cdcAssignments.hiddenForClassLevel} of your assignments use traditional grading (class 6 or above) and aren't shown here.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonStack({ count }: { count: number }) {
  return (
    <ul className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <Card>
            <div className="p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-3 h-3 w-2/3" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}


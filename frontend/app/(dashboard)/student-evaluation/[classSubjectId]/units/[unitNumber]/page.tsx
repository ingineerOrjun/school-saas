"use client";

import * as React from "react";
import Link from "next/link";
import {
  notFound,
  useParams,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { AlertCircle, ArrowLeft, ChevronRight } from "lucide-react";
import { FeatureGate } from "@/components/platform/FeatureGate";
import { FeatureKey } from "@/lib/features";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useMyTeachingAssignments } from "@/lib/teaching-assignments";
import {
  useLearningOutcomesByClassAndSubject,
  type LearningOutcomeDto,
  type SkillArea,
} from "@/lib/learning-outcomes";
import {
  subjectNameToCode,
  type SubjectCode,
} from "@/lib/subject-aliases";
import {
  extractClassLevel,
  isCdcEligibleClassLevel,
} from "@/lib/class-level";
import { cn } from "@/lib/utils";
import { SyncStatusBar } from "../../../_components/SyncStatusBar";

// ============================================================================
// /student-evaluation/[classSubjectId]/units/[unitNumber] — Unit view (6a).
//
// Pulls the same `useLearningOutcomesByClassAndSubject` query as Screen
// 2 (shared cache, no refetch), filters to the requested unit, groups
// outcomes by skill area.
//
// Skill filter — now a URL search param (`?skill=SPEAKING`) instead of
// React-local state. Reasons:
//   • Survives back/forward navigation (one of my Session 5 follow-up
//     questions; user-tested decision pending — search-param state is
//     the lightest path that supports the dominant "I planned a
//     speaking lesson" workflow).
//   • Shareable links — a teacher emailing "look at this unit's
//     speaking outcomes" can paste a URL that lands on the same view.
//   • Cold-deep-link resets to "All" because the param is absent.
//
// Per-outcome rated counts ("X/30") are OMITTED in 6a — same reason
// as Screen 2's progress bar.
// ============================================================================

const ALL_SKILLS: ReadonlyArray<SkillArea> = [
  "LISTENING",
  "SPEAKING",
  "READING",
  "WRITING",
];

type FilterValue = "ALL" | SkillArea;

function skillLabel(s: SkillArea): string {
  // Per-skill label uses Title Case of the lowercased token. Multi-
  // word skills ("LANGUAGE_STRUCTURE") aren't in scope for English
  // Class 4-5, but the underscore-to-space mapping here futureproofs
  // it for Nepali.
  return s
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ");
}

// extractClassLevel is imported from @/lib/class-level — see that
// file's header for the parser's fragility notes.

export default function UnitViewPage() {
  return (
    <FeatureGate
      featureKey={FeatureKey.ConEvaluation}
      featureLabel="Continuous Evaluation"
      message="Continuous Evaluation isn't enabled for your school yet. Contact your administrator to join the pilot."
    >
      <UnitView />
    </FeatureGate>
  );
}

function UnitView() {
  const router = useRouter();
  const params = useParams<{ classSubjectId: string; unitNumber: string }>();
  const search = useSearchParams();
  const unitNumber = Number(params.unitNumber);

  // Resolve assignment from cache.
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

  const outcomes = useLearningOutcomesByClassAndSubject(
    classLevel ?? 0,
    subjectCode ?? "ENGLISH",
    { enabled: Boolean(classLevel && subjectCode) },
  );

  // Filter URL → state. The `?skill=` param is validated against the
  // SkillArea enum; unknown values fall back to "ALL" silently
  // (cheap defensive — never throws from a typo'd URL).
  const filter: FilterValue = React.useMemo(() => {
    const raw = search.get("skill");
    if (!raw) return "ALL";
    if (
      raw === "LISTENING" ||
      raw === "SPEAKING" ||
      raw === "READING" ||
      raw === "WRITING"
    ) {
      return raw;
    }
    return "ALL";
  }, [search]);

  const setFilter = React.useCallback(
    (next: FilterValue) => {
      const usp = new URLSearchParams(search.toString());
      if (next === "ALL") {
        usp.delete("skill");
      } else {
        usp.set("skill", next);
      }
      const qs = usp.toString();
      router.replace(qs ? `?${qs}` : "", { scroll: false });
    },
    [router, search],
  );

  // -------------------------------------------------------------------------
  // RULES OF HOOKS — every hook MUST be declared BEFORE any early return.
  // -------------------------------------------------------------------------
  // This `useMemo` used to live below the `if (assignments.isLoading)` /
  // `if (!classLevel || !subjectCode)` early returns. On the first render
  // (loading), the function bailed at the early return after 8 hook calls;
  // on the next render (loaded), control flowed past the return and called
  // the 9th hook. React's hook-order invariant requires the SAME hooks in
  // the SAME order on every render, so the loading→loaded transition
  // triggered the dev warning:
  //
  //   "React has detected a change in the order of Hooks called by UnitView."
  //
  // The `outcomes.data ?? []` keeps this safe to call when data is still
  // loading — the memo returns []; the unit-filter render branch never
  // reads the empty array because we bail above first.
  // -------------------------------------------------------------------------
  const unitOutcomes: LearningOutcomeDto[] = React.useMemo(
    () => (outcomes.data ?? []).filter((o) => o.unitNumber === unitNumber),
    [outcomes.data, unitNumber],
  );

  // ----- Early-exit branches: missing data / parse failure -----
  if (assignments.isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <SyncStatusBar />
        <Skeleton className="h-9 w-2/3 mb-4" />
        <SkeletonOutcomeStack count={4} />
      </div>
    );
  }
  if (!assignment || Number.isNaN(unitNumber)) {
    notFound();
  }
  if (!classLevel || !subjectCode) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <SyncStatusBar />
        <BackLink assignmentId={assignment.id} />
        <EmptyState
          icon={<AlertCircle className="h-8 w-8" />}
          title="This class isn't ready for CDC"
          description={
            !classLevel
              ? `Couldn't determine the grade level from class name "${assignment.class.name}".`
              : `Subject "${assignment.subject?.name ?? "(none)"}" isn't part of the CDC curriculum.`
          }
        />
      </div>
    );
  }

  // (unitOutcomes is computed above the early returns — see the
  // "RULES OF HOOKS" block. Plain values below this point are
  // re-derivations of it, not hook calls, so they can live here.)
  const unitTitle = unitOutcomes[0]?.unitTitleEn ?? `Unit ${unitNumber}`;

  // Skills actually present in this unit (might skip e.g. VOCABULARY).
  const skillsInUnit = ALL_SKILLS.filter((s) =>
    unitOutcomes.some((o) => o.skillArea === s),
  );

  const visible: LearningOutcomeDto[] =
    filter === "ALL"
      ? unitOutcomes
      : unitOutcomes.filter((o) => o.skillArea === filter);

  // Group visible outcomes by skill, preserving CDC ordering.
  const grouped = new Map<SkillArea, LearningOutcomeDto[]>();
  for (const s of ALL_SKILLS) grouped.set(s, []);
  for (const o of visible) grouped.get(o.skillArea)?.push(o);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <SyncStatusBar />
      <BackLink assignmentId={assignment.id} />

      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Unit {unitNumber}: {unitTitle}
        </h1>
      </header>

      {/* Filter chips. Flex-wrap so the 5-chip strip ("All / Listening
          / Speaking / Reading / Writing") never overflows the 375px
          viewport (Session 5 cleanup fix). */}
      <div className="mb-5 flex flex-wrap gap-2">
        <FilterChip
          label="All"
          active={filter === "ALL"}
          onClick={() => setFilter("ALL")}
        />
        {skillsInUnit.map((s) => (
          <FilterChip
            key={s}
            label={skillLabel(s)}
            active={filter === s}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      {outcomes.isLoading ? (
        <SkeletonOutcomeStack count={4} />
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
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<span className="text-2xl">📭</span>}
          title="No outcomes in this skill area"
          description={`This unit doesn't include any ${
            filter === "ALL" ? "" : skillLabel(filter as SkillArea) + " "
          }outcomes.`}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {ALL_SKILLS.filter((s) => (grouped.get(s) ?? []).length > 0).map(
            (skill) => (
              <section key={skill}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {skillLabel(skill)}
                </h2>
                <ul className="flex flex-col gap-2">
                  {(grouped.get(skill) ?? []).map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/student-evaluation/${assignment.id}/units/${unitNumber}/outcomes/${o.id}`}
                        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
                        aria-label={`Rate students against outcome: ${o.descriptionEn}`}
                      >
                        <Card className="hover:border-primary/40 hover:shadow-sm transition-all active:scale-[0.99]">
                          <div className="flex items-center gap-3 p-3.5">
                            <p
                              className={cn(
                                "flex-1 min-w-0 text-sm text-foreground leading-snug line-clamp-2",
                              )}
                              title={o.descriptionEn ?? undefined}
                            >
                              {o.descriptionEn}
                            </p>
                            {/* Session 6a: no rated-count badge.
                                Chevron-only — when Session 6b lands
                                we restore the "12/30" indicator. */}
                            <ChevronRight
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                          </div>
                        </Card>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function BackLink({ assignmentId }: { assignmentId: string }) {
  return (
    <Link
      href={`/student-evaluation/${assignmentId}`}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
    >
      <ArrowLeft className="h-4 w-4" />
      All units
    </Link>
  );
}

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 px-3.5 rounded-full text-sm font-medium whitespace-nowrap",
        "transition-colors duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground hover:bg-muted/80",
      )}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function SkeletonOutcomeStack({ count }: { count: number }) {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <Card>
            <div className="p-3.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-1.5 h-4 w-3/4" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

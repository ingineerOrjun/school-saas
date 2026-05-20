"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Wallet,
  CalendarCheck,
  GraduationCap,
  Users,
  Lock,
  X,
  GitCompare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredUser } from "@/lib/auth";
import { useClasses, type ClassWithSections } from "@/lib/classes";
import { DateRangeMenu } from "@/components/analytics/DateRangeMenu";
import { OverviewTab } from "./_tabs/OverviewTab";
import { FeesTab } from "./_tabs/FeesTab";
import { AttendanceTab } from "./_tabs/AttendanceTab";
import { ExamsTab } from "./_tabs/ExamsTab";
import { StudentsTab } from "./_tabs/StudentsTab";
import {
  useAnalyticsFilters,
  type AnalyticsFilters,
  type AnalyticsTabKey,
  type CompareMode,
} from "./_filters";
import { FeatureGate } from "@/components/platform/FeatureGate";
import { FeatureKey } from "@/lib/features";

// ---------------------------------------------------------------------------
// /analytics — Analytics Center
//
// All view state (active tab + filters) lives in the URL via the
// `useAnalyticsFilters` hook. That gives us:
//   • Shareable links (paste a URL, see the same filtered view)
//   • Browser back/forward works naturally
//   • Reload restores state without ad-hoc localStorage
//
// Each tab consumes the same filter shape; tabs that don't honor a
// given filter (e.g. Exams ignores `fromDate`) are explicit about it
// in their own files.
//
// What's NOT in the shell:
//   • Compare-toggle (previous month/year). Param is parsed but
//     consumed nowhere yet — Phase 2 work.
//   • PDF export. Browser print + per-card CSV is the v1 export story.
// ---------------------------------------------------------------------------

const TABS: ReadonlyArray<{
  key: AnalyticsTabKey;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "fees", label: "Fees & Finance", icon: Wallet },
  { key: "attendance", label: "Attendance", icon: CalendarCheck },
  { key: "exams", label: "Exams", icon: GraduationCap },
  { key: "students", label: "Students", icon: Users },
];

// Re-export the type so existing tab files (which import from
// `../page`) keep working without churn — the canonical shape lives
// in `_filters.ts` now.
export type { AnalyticsFilters } from "./_filters";

// Phase 5: gate the entire page behind the `analytics` feature
// flag. Default ON so existing schools keep their charts; platform
// owners can disable per-tenant. SUPER_ADMIN bypasses.
export default function AnalyticsPage() {
  return (
    <FeatureGate featureKey={FeatureKey.Analytics} featureLabel="Analytics">
      <AnalyticsView />
    </FeatureGate>
  );
}

function AnalyticsView() {
  const router = useRouter();
  const filters = useAnalyticsFilters();
  const [accessChecked, setAccessChecked] = React.useState(false);
  const [isAdmin, setIsAdmin] = React.useState(false);

  // Role gate — same as before. Cached user role is checked once
  // on mount; non-admins land on a friendly access gate.
  React.useEffect(() => {
    const user = getStoredUser();
    setIsAdmin(user?.role === "ADMIN");
    setAccessChecked(true);
  }, []);

  if (!accessChecked) {
    return <div className="h-32" />;
  }
  if (!isAdmin) {
    return <AccessGate onBack={() => router.replace("/")} />;
  }

  return (
    <div className="space-y-6">
      <Header />

      <StickyFilterBar
        filters={filters.filters}
        setFilters={filters.setFilters}
        hasActiveFilters={filters.hasActiveFilters}
        onClear={filters.clearFilters}
      />

      <Tabs active={filters.tab} onChange={filters.setTab} />

      {/* Tab content. Mount-on-switch — only the active tab fetches
          data, so unused tabs cost nothing. */}
      {filters.tab === "overview" && (
        <OverviewTab filters={filters.filters} />
      )}
      {filters.tab === "fees" && <FeesTab filters={filters.filters} />}
      {filters.tab === "attendance" && (
        <AttendanceTab filters={filters.filters} />
      )}
      {filters.tab === "exams" && <ExamsTab filters={filters.filters} />}
      {filters.tab === "students" && (
        <StudentsTab filters={filters.filters} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          Cross-module insights for principals and admins. Filter, drilldown,
          export.
        </p>
      </div>
      <div className="hidden md:flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Admin only
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StickyFilterBar
//
// What changed in this iteration:
//   • Date controls collapsed from "4 chips + 2 inputs" into a single
//     <DateRangeMenu> dropdown. The trigger label always shows the
//     active range, so the bar reads "Last 30 days · All classes ·
//     Compare off" at a glance without hunting for a highlighted chip.
//   • Sticky styling reworked. The previous bar used a hard
//     `border-b` + backdrop blur, which created a visible seam halfway
//     down the screen the moment scroll engaged. We now:
//       – detect "stuck" state via an IntersectionObserver sentinel
//       – when stuck, soften the look: lift it via a subtle bottom
//         shadow instead of a hard border, and slim the vertical
//         padding so the sticky band takes less screen real estate
//       – when not stuck (top of page), render with no shadow at all,
//         flush with the page — no border seam visible
//   • Active-filter chips render in a separate band below the bar, in
//     the SAME sticky element so they don't drift out of reach.
// ---------------------------------------------------------------------------

function StickyFilterBar({
  filters,
  setFilters,
  hasActiveFilters,
  onClear,
}: {
  filters: AnalyticsFilters;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
}) {
  // "Is the bar currently in its stuck position?" — drives the
  // shadow/density transition. We watch a 1px sentinel placed
  // immediately above the sticky element; when the sentinel scrolls
  // out of the viewport, we know the sticky is engaged.
  //
  // Why an observer instead of `position: sticky` + a CSS-only
  // selector: there's no native CSS for "this element is currently
  // pinned." `useScroll` hooks work but introduce a render per scroll
  // event, which is overkill for a single boolean toggle.
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = React.useState(false);

  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      // Threshold 0 + no rootMargin → "stuck" flips the moment the
      // sentinel is fully off-screen. That matches the visual moment
      // sticky engages.
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      {/* Sentinel — invisible, just for the observer. Has to be a real
          DOM node above the sticky element so the observer can see it
          enter/leave the viewport as the page scrolls. */}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
      <div
        className={cn(
          // Sticks flush below the topbar (h-16). Z-index 20 sits
          // BELOW the topbar's 30 so the topbar's shadow always wins
          // — important when both are simultaneously visible.
          "sticky top-16 z-20 -mx-2 px-2",
          // Smooth transition between resting + stuck states. We
          // animate background, shadow, padding, and border-bottom
          // together so the stuck visual lands as one unified shift,
          // not three separate jumps.
          "transition-[background-color,box-shadow,padding,border-color] duration-200",
          stuck
            ? // Stuck visual — the previous translucent backdrop-blur
              // approach made content visibly scroll through the bar,
              // which read as "floating in the middle." A SOLID
              // surface background with a clean hairline border-bottom
              // + soft drop shadow reads as "this is a control plane
              // resting on the page" instead. Same pattern Linear,
              // Notion, Stripe use for sticky navs.
              "py-2 bg-surface border-b border-border shadow-[0_4px_12px_-6px_rgba(15,23,42,0.08)]"
            : // Resting visual — flush with the page background, no
              // border, no shadow. The bar reads as part of the
              // document flow until scroll engages.
              "py-3 bg-background border-b border-transparent",
        )}
      >
        <FilterBarRow
          filters={filters}
          setFilters={setFilters}
          hasActiveFilters={hasActiveFilters}
          onClear={onClear}
        />
        {hasActiveFilters && (
          <ActiveFilterChips
            filters={filters}
            setFilters={setFilters}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// FilterBarRow — the single-row controls (date / scope / compare).
//
// Layout intent at the wide breakpoint:
//
//   [📅 Last 30 days ▾]  [Class ▾] [Section ▾]      [Compare: Off ▾]   [Clear ×]
//   ┃ DATE                ┃ SCOPE                    ┃ MODE              ┃
//
// At narrow widths we let everything wrap naturally — no two-row
// hardcoded layout — because the dropdowns themselves take less
// horizontal space than the previous chips, so wrapping is rare on
// tablet+ screens.
// ---------------------------------------------------------------------------

function FilterBarRow({
  filters,
  setFilters,
  hasActiveFilters,
  onClear,
}: {
  filters: AnalyticsFilters;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {/* Group labels read as quiet section headings — same typographic
          weight as a Linear/Notion settings panel. The label sits to
          the LEFT of its control rather than above so the bar stays a
          single horizontal line on desktop. Hidden on narrow screens
          (< sm) to give the controls more room. */}
      <FilterGroup label="Range">
        <DateRangeMenu
          fromDate={filters.fromDate}
          toDate={filters.toDate}
          onChange={(next) =>
            setFilters({ fromDate: next.fromDate, toDate: next.toDate })
          }
        />
      </FilterGroup>

      <FilterDivider />

      <FilterGroup label="Scope">
        <ClassSectionSelectors
          classId={filters.classId}
          sectionId={filters.sectionId}
          setFilters={setFilters}
        />
      </FilterGroup>

      <FilterDivider />

      <FilterGroup label="Compare">
        <CompareToggle
          compare={filters.compare}
          setFilters={setFilters}
        />
      </FilterGroup>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className={cn(
            "ml-auto inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-muted-foreground",
            "hover:border-destructive/40 hover:text-destructive hover:bg-destructive/5 transition-all duration-150",
            "active:scale-[0.97]",
          )}
          title="Clear all active filters"
        >
          <X className="h-3.5 w-3.5" />
          Clear filters
        </button>
      )}
    </div>
  );
}

/**
 * Group label + control wrapper. The label is decorative — it doesn't
 * own focus and clicking it doesn't focus the control. We don't use
 * `<label>` because most of these "controls" are composite (the
 * compare toggle is a button group, the date dropdown is a custom
 * popover) so the native `htmlFor` association would lie about what
 * the label points at.
 */
function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="hidden text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70 sm:inline"
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function FilterDivider() {
  return (
    <span
      aria-hidden
      className="hidden h-5 w-px bg-border/70 lg:block"
    />
  );
}

// ---------------------------------------------------------------------------
// ClassSectionSelectors
//
// Lazy-loads the class list once. The section dropdown becomes
// available only when a class is picked; clearing the class also
// clears the section (the URL hook drops sectionId without classId
// anyway, but we explicit-clear here for snappier UI).
// ---------------------------------------------------------------------------

function ClassSectionSelectors({
  classId,
  sectionId,
  setFilters,
}: {
  classId: string;
  sectionId: string;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
}) {
  // Classes via the shared React Query hook (10m staleTime). Was an
  // inline classesApi.list() in this filter bar; the cached hook
  // closes a /classes dupe with the rest of the page tree. Soft-fail
  // semantics preserved: while loading the dropdown is disabled
  // (null sentinel), on error we render [] so the analytics page
  // still works without class filtering — same as the old try/catch.
  const classesQuery = useClasses();
  const classes: ClassWithSections[] | null = classesQuery.isError
    ? []
    : classesQuery.data ?? null;

  const selectedClass = classes?.find((c) => c.id === classId);
  const sections = selectedClass?.sections ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider">Class</span>
        <select
          value={classId}
          onChange={(e) =>
            // Clearing the class clears the section too — keeps the
            // URL coherent and the UI snappy (no half-second blink
            // while the URL hook normalises).
            setFilters({
              classId: e.target.value,
              sectionId: "",
            })
          }
          disabled={!classes}
          className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:opacity-60"
        >
          <option value="">All classes</option>
          {classes?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {classId && sections.length > 0 && (
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">
            Section
          </span>
          <select
            value={sectionId}
            onChange={(e) => setFilters({ sectionId: e.target.value })}
            className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          >
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompareToggle
//
// Tiny segmented control that flips the global compare mode. Three
// options today: None / vs. previous month / vs. previous year.
// Quarter and academic-session compares are reserved for follow-ups
// (quarter is a date-math exercise; session needs the academic-session
// boundaries plumbed through).
//
// When compare is OFF, KpiCards render plain. When ON, each card
// pulls a `previous` value from its data source (typically the same
// `monthlyTrend` array) and renders a `<DeltaBadge>` underneath.
// ---------------------------------------------------------------------------

function CompareToggle({
  compare,
  setFilters,
}: {
  compare: CompareMode;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
}) {
  const options: Array<{ key: CompareMode; label: string; short: string }> = [
    { key: "none", label: "Off", short: "Off" },
    { key: "prev_month", label: "vs. previous month", short: "Prev month" },
    { key: "prev_year", label: "vs. previous year", short: "Prev year" },
  ];

  return (
    <div className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-surface px-1.5">
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
        title="Compare current values to a previous period"
      >
        <GitCompare className="h-3 w-3" />
        Compare
      </span>
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => setFilters({ compare: opt.key })}
          title={opt.label}
          className={cn(
            "rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
            compare === opt.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {opt.short}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActiveFilterChips
//
// One chip per non-default filter. Each chip's "×" button removes
// just that filter — easier than scrolling back to the dropdown to
// pick "All". Skipped for filters that read as defaults.
//
// Why not show the date chip when the dates are non-default: the
// date inputs themselves are always visible in the bar, so a chip
// would be redundant noise.
// ---------------------------------------------------------------------------

function ActiveFilterChips({
  filters,
  setFilters,
}: {
  filters: AnalyticsFilters;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
}) {
  const chips: Array<{
    key: keyof AnalyticsFilters;
    label: string;
    onClear: () => void;
  }> = [];

  if (filters.classId) {
    chips.push({
      key: "classId",
      label: `Class · ${filters.classId.slice(0, 8)}…`,
      onClear: () => setFilters({ classId: "", sectionId: "" }),
    });
  }
  if (filters.sectionId) {
    chips.push({
      key: "sectionId",
      label: `Section · ${filters.sectionId.slice(0, 8)}…`,
      onClear: () => setFilters({ sectionId: "" }),
    });
  }
  if (filters.examId) {
    chips.push({
      key: "examId",
      label: `Exam · ${filters.examId.slice(0, 8)}…`,
      onClear: () => setFilters({ examId: "" }),
    });
  }
  if (filters.cashierId) {
    chips.push({
      key: "cashierId",
      label: `Cashier · ${filters.cashierId.slice(0, 8)}…`,
      onClear: () => setFilters({ cashierId: "" }),
    });
  }
  if (filters.compare !== "none") {
    chips.push({
      key: "compare",
      label: `Compare · ${filters.compare.replace("_", " ")}`,
      onClear: () => setFilters({ compare: "none" }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Active
      </span>
      {chips.map((chip, idx) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onClear}
          // Stagger entry — each chip plays the same fade-in-up but
          // delayed by 30ms × index. The cascade is short (max 5
          // chips → 120ms tail) and reads as "the filters are
          // landing into place" rather than "everything popped at
          // once". Inline style because tailwind's animation-delay
          // utilities don't go below 75ms steps.
          style={{ animationDelay: `${idx * 30}ms` }}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary",
            "animate-fade-in-up",
            "hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive transition-colors",
            "active:scale-[0.95]",
          )}
          title="Click to clear this filter"
        >
          {chip.label}
          <X className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function Tabs({
  active,
  onChange,
}: {
  active: AnalyticsTabKey;
  onChange: (t: AnalyticsTabKey) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap items-center gap-1 border-b border-border"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={cn(
              // Premium motion: inactive tabs get a transient
              // background tint on hover (not just a border swap)
              // for higher tactility. The active tab's underline is
              // a colored block instead of a border so it appears
              // to "anchor" to the bottom of the tab strip cleanly.
              "relative inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors duration-150",
              isActive
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-t-md",
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{t.label}</span>
            {/* Active indicator — absolutely-positioned span so it
                sits on top of the strip's border-bottom regardless of
                the tab's own padding. Hidden on inactive tabs. */}
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-all duration-200",
                isActive ? "bg-primary opacity-100" : "bg-transparent opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access gate (rendered when a non-admin reaches the page)
// ---------------------------------------------------------------------------

function AccessGate({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-surface p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Lock className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">
        Analytics is admin-only
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This control center surfaces school-wide finance and operations
        data. Only an administrator can view it.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90 transition-colors"
      >
        Back to dashboard
      </button>
    </div>
  );
}


"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// useAnalyticsFilters — URL is the single source of truth for the
// Analytics Center's view state.
//
// Why URL-driven:
//   • Shareable links: a principal can paste a URL into Slack and the
//     recipient sees the exact same filtered view.
//   • Bookmarkable: "this is the page I open every Monday morning".
//   • Browser back/forward navigation works without a custom history
//     stack — every state change is a real navigation entry.
//
// Why `router.replace` instead of `push`:
//   • Filter changes shouldn't pollute browser history. Hitting Back
//     should return the user to the previous PAGE they were on, not
//     scroll them through every filter combination they tried.
//   • Tab changes use replace too — same reason. If a user hits Back
//     after switching tabs, they expect to land on the page they came
//     FROM, not on the previous tab.
//
// Stable serialization:
//   The query-key set is tightly defined (see `FILTER_KEYS`). Any key
//   not in that set is preserved verbatim — this lets a future
//   feature (e.g. "compare" toggle) add its own param without this
//   hook needing to know about it. Empty/null values DROP the key
//   entirely so the URL stays short.
// ---------------------------------------------------------------------------

/**
 * Tab keys that the page renders. Defined here so the hook can
 * default to "overview" when the URL has no `tab` param (or an
 * unknown one) — single source of truth for what's a valid tab.
 */
export const ANALYTICS_TABS = [
  "overview",
  "fees",
  "attendance",
  "exams",
  "students",
] as const;
export type AnalyticsTabKey = (typeof ANALYTICS_TABS)[number];

/** Compare-mode is reserved for Phase 2; the param is parsed but inert today. */
export type CompareMode = "none" | "prev_month" | "prev_year" | "prev_session";

/**
 * The filter shape every tab consumes. Empty string means "not set"
 * for string filters; nulls would force every consumer to handle two
 * empty cases. Date strings are YYYY-MM-DD AD; the page shell
 * supplies sensible defaults if missing.
 */
export interface AnalyticsFilters {
  fromDate: string;
  toDate: string;
  /** Class UUID. Empty = all classes. */
  classId: string;
  /** Section UUID. Empty = all sections (only meaningful with a classId). */
  sectionId: string;
  /** Exam UUID. Drives the Exams tab picker. */
  examId: string;
  /** Academic session UUID. Reserved — not yet honored by all tabs. */
  sessionId: string;
  /** Teacher UUID. Reserved for the future Teacher tab. */
  teacherId: string;
  /** Cashier (User) UUID. Reserved for cashier-filtered payment history. */
  cashierId: string;
  /** Compare mode — Phase 2; today this is just round-tripped. */
  compare: CompareMode;
}

export interface AnalyticsViewState {
  tab: AnalyticsTabKey;
  filters: AnalyticsFilters;
}

/**
 * Short URL keys. Long names like `feeAssignmentId` would bloat the
 * shareable URL; these stay terse but unambiguous. Mapping is fixed
 * at module scope so serialization can never drift between read and
 * write paths.
 */
const URL_KEYS = {
  tab: "tab",
  fromDate: "from",
  toDate: "to",
  classId: "class",
  sectionId: "section",
  examId: "examId",
  sessionId: "session",
  teacherId: "teacher",
  cashierId: "cashier",
  compare: "compare",
} as const;

/** Reverse lookup so we can preserve unknown params on writes. */
const KNOWN_URL_KEYS = new Set<string>(Object.values(URL_KEYS));

const VALID_COMPARE: ReadonlySet<CompareMode> = new Set([
  "none",
  "prev_month",
  "prev_year",
  "prev_session",
]);

/**
 * 30-day default window. Matches the existing attendance-insights
 * page so a user moving between the two doesn't get whiplash from
 * different default ranges.
 */
function defaultWindow(): { fromDate: string; toDate: string } {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 29);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: today.toISOString().slice(0, 10),
  };
}

/** Parse the URL's `?...` into our typed view state, with sensible defaults. */
function readState(params: URLSearchParams): AnalyticsViewState {
  const rawTab = params.get(URL_KEYS.tab) ?? "overview";
  const tab = (ANALYTICS_TABS as readonly string[]).includes(rawTab)
    ? (rawTab as AnalyticsTabKey)
    : "overview";

  const def = defaultWindow();
  const compareRaw = params.get(URL_KEYS.compare) ?? "none";
  const compare = (VALID_COMPARE.has(compareRaw as CompareMode)
    ? compareRaw
    : "none") as CompareMode;

  return {
    tab,
    filters: {
      fromDate: params.get(URL_KEYS.fromDate) || def.fromDate,
      toDate: params.get(URL_KEYS.toDate) || def.toDate,
      classId: params.get(URL_KEYS.classId) ?? "",
      sectionId: params.get(URL_KEYS.sectionId) ?? "",
      examId: params.get(URL_KEYS.examId) ?? "",
      sessionId: params.get(URL_KEYS.sessionId) ?? "",
      teacherId: params.get(URL_KEYS.teacherId) ?? "",
      cashierId: params.get(URL_KEYS.cashierId) ?? "",
      compare,
    },
  };
}

/**
 * Serialize a view-state into a URLSearchParams. Empty/default values
 * are DROPPED so the URL stays short — `?from=…&to=…` for the default
 * 30-day window would be churn since reload would just reapply
 * defaults anyway. We compare each date against today's defaults so
 * an explicit "exactly the default range" still drops them; users
 * who want to share "the rolling 30-day view" share the bare URL.
 *
 * `extraPreserved` lets the caller carry through unknown params they
 * read off the existing URL, so a future param doesn't get nuked
 * when the user changes a filter.
 */
function writeState(
  next: AnalyticsViewState,
  extraPreserved: Array<[string, string]>,
): URLSearchParams {
  const params = new URLSearchParams();
  const def = defaultWindow();

  // Only emit `tab` when it's not the default — the bare URL
  // `/analytics` should land on Overview cleanly.
  if (next.tab !== "overview") {
    params.set(URL_KEYS.tab, next.tab);
  }
  // Dates only emitted when non-default. We compute defaults inside
  // the function so we always compare against "today's" 30-day
  // window, not a stale baseline.
  if (next.filters.fromDate && next.filters.fromDate !== def.fromDate) {
    params.set(URL_KEYS.fromDate, next.filters.fromDate);
  }
  if (next.filters.toDate && next.filters.toDate !== def.toDate) {
    params.set(URL_KEYS.toDate, next.filters.toDate);
  }
  if (next.filters.classId)
    params.set(URL_KEYS.classId, next.filters.classId);
  // Section is only meaningful with a class; drop a stray sectionId
  // when classId is missing so the URL doesn't lie.
  if (next.filters.sectionId && next.filters.classId) {
    params.set(URL_KEYS.sectionId, next.filters.sectionId);
  }
  if (next.filters.examId) params.set(URL_KEYS.examId, next.filters.examId);
  if (next.filters.sessionId)
    params.set(URL_KEYS.sessionId, next.filters.sessionId);
  if (next.filters.teacherId)
    params.set(URL_KEYS.teacherId, next.filters.teacherId);
  if (next.filters.cashierId)
    params.set(URL_KEYS.cashierId, next.filters.cashierId);
  if (next.filters.compare !== "none") {
    params.set(URL_KEYS.compare, next.filters.compare);
  }

  // Unknown params are passed through last so they sort to the end —
  // future-proofs us for params other code paths might add.
  for (const [k, v] of extraPreserved) {
    if (!KNOWN_URL_KEYS.has(k) && v) {
      params.set(k, v);
    }
  }
  return params;
}

export interface UseAnalyticsFiltersResult {
  tab: AnalyticsTabKey;
  filters: AnalyticsFilters;
  /** Switch tabs. Preserves all current filters. */
  setTab: (tab: AnalyticsTabKey) => void;
  /** Patch one or more filters. Preserves the current tab. */
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
  /** Reset every filter to defaults; tab stays. */
  clearFilters: () => void;
  /**
   * `true` when at least one filter differs from its default. Drives
   * the visibility of the "Clear filters" button + the active-chip row.
   */
  hasActiveFilters: boolean;
}

/**
 * The hook every Analytics Center component reads from. Calling
 * `setTab` / `setFilters` / `clearFilters` writes the URL, which
 * then re-renders this hook with the new state.
 *
 * Re-render flow:
 *   1. User clicks "Last 7 days" preset.
 *   2. Hook calls `router.replace(?from=…&to=…)`.
 *   3. Next.js updates `searchParams`, triggering a re-render.
 *   4. `readState(params)` produces the new typed state.
 *   5. Tabs receive the new filters via props and refetch.
 *
 * That's a single round-trip; we don't keep a parallel `useState`
 * mirror, which would invite drift between the URL and the rendered
 * state.
 */
export function useAnalyticsFilters(): UseAnalyticsFiltersResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Memoize the parsed state so consumers don't see new object
  // identities every render. The dependency is the search-params
  // string, which IS the canonical state — anything derived from it
  // is stable as long as the URL is stable.
  const paramsString = searchParams?.toString() ?? "";
  const state = React.useMemo(() => {
    return readState(new URLSearchParams(paramsString));
  }, [paramsString]);

  // Snapshot of unknown params so writes preserve them (see writeState).
  const extraPreserved = React.useMemo<Array<[string, string]>>(() => {
    const sp = new URLSearchParams(paramsString);
    const out: Array<[string, string]> = [];
    sp.forEach((v, k) => {
      if (!KNOWN_URL_KEYS.has(k)) out.push([k, v]);
    });
    return out;
  }, [paramsString]);

  const commit = React.useCallback(
    (next: AnalyticsViewState) => {
      const params = writeState(next, extraPreserved);
      const qs = params.toString();
      const url = qs ? `${pathname}?${qs}` : pathname ?? "/analytics";
      // `replace` not `push` — filter and tab changes shouldn't
      // accumulate in browser history. See the file header.
      router.replace(url, { scroll: false });
    },
    [pathname, router, extraPreserved],
  );

  const setTab = React.useCallback(
    (tab: AnalyticsTabKey) => {
      commit({ tab, filters: state.filters });
    },
    [commit, state.filters],
  );

  const setFilters = React.useCallback(
    (patch: Partial<AnalyticsFilters>) => {
      commit({ tab: state.tab, filters: { ...state.filters, ...patch } });
    },
    [commit, state.tab, state.filters],
  );

  const clearFilters = React.useCallback(() => {
    const def = defaultWindow();
    commit({
      tab: state.tab,
      filters: {
        fromDate: def.fromDate,
        toDate: def.toDate,
        classId: "",
        sectionId: "",
        examId: "",
        sessionId: "",
        teacherId: "",
        cashierId: "",
        compare: "none",
      },
    });
  }, [commit, state.tab]);

  const hasActiveFilters = React.useMemo(() => {
    const def = defaultWindow();
    const f = state.filters;
    return (
      f.fromDate !== def.fromDate ||
      f.toDate !== def.toDate ||
      !!f.classId ||
      !!f.sectionId ||
      !!f.examId ||
      !!f.sessionId ||
      !!f.teacherId ||
      !!f.cashierId ||
      f.compare !== "none"
    );
  }, [state.filters]);

  return {
    tab: state.tab,
    filters: state.filters,
    setTab,
    setFilters,
    clearFilters,
    hasActiveFilters,
  };
}

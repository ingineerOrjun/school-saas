"use client";

import * as React from "react";
import { Search, User, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { studentsApi, type StudentDto } from "@/lib/students";
import { ApiError } from "@/lib/api";

// ---------------------------------------------------------------------------
// StudentSearchPicker — typeahead optimized for the cashier workspace.
//
// Why a custom component instead of a generic combobox primitive:
//   • The keyboard contract is opinionated. Enter selects the FIRST
//     match (not the highlighted one) so the cashier doesn't have to
//     touch the arrow keys for the most-common case ("type symbol no,
//     hit Enter, done"). Arrow keys are still wired for the rare case
//     of multiple matches with similar names.
//   • Match highlighting needs to span four fields (name, symbol no,
//     phone, parent name) — a generic combobox doesn't know which
//     field caused the hit.
//   • Debounce is integrated with the abort-on-newer-query pattern so
//     a slow network can't paint stale results over fresh ones.
//
// Not handled here (intentional):
//   • Caching results — the search is cheap (≤ 50 rows) and the cashier
//     is usually typing a unique query. A cache would only help on
//     identical re-queries which never happens in this UX.
//   • Pagination — capped at 10 server-side; the cashier should refine
//     instead of scroll.
// ---------------------------------------------------------------------------

const SEARCH_DEBOUNCE_MS = 200;

export interface StudentSearchPickerProps {
  /**
   * Called when the cashier picks a student (click or Enter).
   * The selected student is the source-of-truth — the parent owns the
   * "currently selected" state, this component just reports picks.
   */
  onSelect: (student: StudentDto) => void;
  /**
   * Optional autofocus — the workspace page sets this to `true` so the
   * cashier can start typing immediately on page load.
   */
  autoFocus?: boolean;
  /**
   * Recent students to show when the input is empty. Optional — if
   * omitted, the empty-input state shows the server's "recent
   * students" fallback (createdAt-desc).
   */
  recents?: StudentDto[];
}

export function StudentSearchPicker({
  onSelect,
  autoFocus,
  recents,
}: StudentSearchPickerProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<StudentDto[]>([]);
  const [highlightedIdx, setHighlightedIdx] = React.useState(0);
  const [isOpen, setIsOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  // Tracks the latest fired query so a slow earlier response can't
  // overwrite a newer one. We compare on dispatch + on receipt.
  const latestQueryRef = React.useRef("");

  // Reset highlight when results change so the first row is always
  // pre-selected — Enter then picks "the obvious match."
  React.useEffect(() => {
    setHighlightedIdx(0);
  }, [results]);

  // Debounced search. We don't fire until the user stops typing for
  // ~200ms — short enough to feel instant, long enough to avoid
  // hitting the server on every keystroke.
  React.useEffect(() => {
    const trimmed = query.trim();
    latestQueryRef.current = trimmed;

    // Empty query: surface the parent-provided recents (or the server's
    // empty-query fallback if no recents were passed).
    if (trimmed.length === 0) {
      if (recents) {
        setResults(recents);
        return;
      }
      // Fall through: an empty-query fetch returns the server fallback.
    }

    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await studentsApi.search(trimmed, 10);
        // Drop the response if a newer query has fired since.
        if (latestQueryRef.current === trimmed) {
          setResults(rows);
        }
      } catch (err) {
        if (latestQueryRef.current === trimmed) {
          // Soft-fail: empty list. The cashier will see "no matches"
          // and re-type. We don't toast — typeahead errors shouldn't
          // pollute the workspace with notifications.
          setResults([]);
          if (err instanceof ApiError && err.status >= 500) {
            // Console-warn for diagnostics; doesn't block the user.
            // eslint-disable-next-line no-console
            console.warn("[StudentSearchPicker] search failed", err);
          }
        }
      } finally {
        if (latestQueryRef.current === trimmed) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, recents]);

  // Close the dropdown when clicking outside. Standard outside-click
  // pattern: bind on document, check ref containment.
  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
      setHighlightedIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[highlightedIdx];
      if (target) {
        commitSelection(target);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const commitSelection = (s: StudentDto) => {
    onSelect(s);
    // Clear the input + close the dropdown so the cashier sees the
    // cleared search bar = "ready for the next student." A persistent
    // search box that retains the previous query would add a click
    // (clear) to the next interaction.
    setQuery("");
    setIsOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search by name, symbol no, phone…"
          aria-label="Search students"
          className="w-full h-12 rounded-lg border border-border bg-surface pl-10 pr-4 text-base text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-shadow"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Searching…
          </span>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-[420px] overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {query.trim()
                ? `No students match "${query.trim()}".`
                : "Start typing to search students."}
            </div>
          ) : (
            <>
              {!query.trim() && (
                <div className="border-b border-border bg-muted/40 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  Recent students
                </div>
              )}
              <ul role="listbox">
                {results.map((s, idx) => (
                  <SearchResultRow
                    key={s.id}
                    student={s}
                    query={query}
                    highlighted={idx === highlightedIdx}
                    onClick={() => commitSelection(s)}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row in the dropdown. Renders the four searchable fields with the
// matching substring highlighted on each so the cashier can see WHY the
// row matched ("ah, this came up because of the phone number").
// ---------------------------------------------------------------------------

function SearchResultRow({
  student,
  query,
  highlighted,
  onClick,
  onMouseEnter,
}: {
  student: StudentDto;
  query: string;
  highlighted: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <li
      role="option"
      aria-selected={highlighted}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-border/60 last:border-b-0",
        highlighted ? "bg-primary/8" : "hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold",
          highlighted
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {(student.firstName[0] ?? "?").toUpperCase()}
        {(student.lastName[0] ?? "").toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Highlight
            text={`${student.firstName} ${student.lastName}`}
            query={query}
          />
          {student.symbolNumber && (
            <span className="font-mono text-xs text-muted-foreground">
              <Highlight text={student.symbolNumber} query={query} />
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {student.section ? (
            <span>
              {student.section.class.name} · {student.section.name}
            </span>
          ) : student.class ? (
            <span>{student.class.name}</span>
          ) : (
            <span className="italic">Unassigned</span>
          )}
          {student.contactNumber && (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" aria-hidden />
              <Highlight text={student.contactNumber} query={query} />
            </span>
          )}
          {student.parentName && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" aria-hidden />
              <Highlight text={student.parentName} query={query} />
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Render `text` with the matching substring(s) of `query` wrapped in a
 * highlight span. Case-insensitive contains. Falls back to plain text
 * when the query is empty or doesn't appear in `text`.
 *
 * Uses `String.prototype.split` with a regex so we don't need to do
 * index math by hand; we then re-render the alternating non-match /
 * match pieces as text + highlight spans.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{text}</>;
  // Escape regex meta-chars — the cashier might paste a phone number
  // with parentheses or a "+" country code, which would otherwise be
  // treated as regex operators.
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Capturing group + `g` flag → split keeps every matched substring
  // in the result array, alternating with the non-match text.
  const splitRe = new RegExp(`(${escaped})`, "ig");
  const parts = text.split(splitRe);
  const lower = trimmed.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        // A matched part equals the query (case-insensitive). split
        // preserves the captured substring as-is, so we don't need a
        // contains check — exact case-insensitive equality is enough.
        part.toLowerCase() === lower ? (
          <mark
            key={i}
            className="bg-primary/15 text-foreground rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

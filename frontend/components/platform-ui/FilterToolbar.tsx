"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FilterToolbar — search + filters strip used above tables / lists.
//
// One layout pattern across every platform list page:
//   [ search input (grows)        ][ filter1 ][ filter2 ][ ... ][ actions ]
//
// Active filter chips render below the row when any filter is set,
// with a one-click clear-each + clear-all.
//
// Slots:
//   • children — the filter controls (selects, date pickers, etc.).
//                The toolbar provides the search input itself.
//   • activeFilters — array of {label, onClear} for the chip strip.
//   • actions — right-side button group (Refresh, etc.).
// ---------------------------------------------------------------------------

export interface ActiveFilter {
  label: string;
  onClear: () => void;
}

export interface FilterToolbarProps {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  /** When set, hides the search input entirely. */
  hideSearch?: boolean;
  activeFilters?: ActiveFilter[];
  onClearAll?: () => void;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function FilterToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  hideSearch,
  activeFilters,
  onClearAll,
  actions,
  className,
  children,
}: FilterToolbarProps) {
  const hasActive = (activeFilters?.length ?? 0) > 0;
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {!hideSearch && (
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
            />
          </div>
        )}
        {children}
        {actions && (
          <div className="flex items-center gap-1.5 ml-auto">{actions}</div>
        )}
      </div>
      {hasActive && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Filters
          </span>
          {activeFilters!.map((f, idx) => (
            <button
              key={idx}
              type="button"
              onClick={f.onClear}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
              title="Remove filter"
            >
              {f.label}
              <X className="h-2.5 w-2.5 text-slate-400" />
            </button>
          ))}
          {onClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              className="ml-1 text-[10px] font-medium text-slate-500 hover:text-slate-700 hover:underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

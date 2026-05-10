"use client";

import * as React from "react";
import { Activity, RotateCcw, Shield, X } from "lucide-react";
import {
  isEnabled,
  reset,
  useRequestPressure,
} from "@/lib/request-pressure";
import {
  reset as resetCooldowns,
  useCooldownStats,
} from "@/lib/request-cooldown";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// RequestPressurePanel — Phase performance governance.
//
// Dev-only collapsible widget anchored bottom-left. Shows:
//
//   • Top endpoints by call count
//   • Duplicate-within-5s counts (the smoking gun for "this query
//     should be cached but isn't")
//   • Average inter-call gap (low = polling-too-fast, very low =
//     bug)
//
// Activation:
//   • Renders only when NODE_ENV === 'development'.
//   • Hidden by default to stay out of the developer's way.
//   • Click the floating chip to expand.
//
// Why this exists:
//   The 429 storms were diagnosed last round by reading server
//   logs. This panel surfaces the same information client-side
//   so the next perf regression is visible at a glance during
//   normal dev work — no need to tail backend logs.
//
// Production: returns null. Zero bundle impact beyond the small
// instrumentation in api.ts (which is also no-op'd in prod).
// ---------------------------------------------------------------------------

export function RequestPressurePanel() {
  const stats = useRequestPressure();
  const cooldownStats = useCooldownStats();
  const [open, setOpen] = React.useState(false);

  if (!isEnabled()) return null;

  const totalRequests = stats.reduce((sum, s) => sum + s.count, 0);
  const totalDuplicates = stats.reduce((sum, s) => sum + s.duplicatesIn5s, 0);
  const totalCooldownBlocks = cooldownStats.reduce(
    (sum, c) => sum + c.blocks,
    0,
  );
  // Top 10 by call count.
  const top = stats.slice(0, 10);
  // Surface "duplicate-heavy" rows above the others — these are the
  // actionable findings (cache misses or unstable query keys).
  const duplicateHeavy = top
    .filter((s) => s.duplicatesIn5s >= 2)
    .sort((a, b) => b.duplicatesIn5s - a.duplicatesIn5s);
  // Phase γ — separate "reference data duplicates" callout. These are
  // the worst kind of duplicate: a lookup that should be served from
  // the long-stale cache fired again. Always a bug.
  const referenceDuplicates = stats.filter(
    (s) => s.isReferenceData && s.duplicatesIn5s >= 1,
  );

  return (
    <div className="fixed left-4 bottom-4 z-[60] font-mono text-[10px]">
      {open ? (
        <div
          className="w-[480px] max-w-[90vw] rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-xl"
          role="region"
          aria-label="Request pressure panel (dev only)"
        >
          <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
            <div className="flex items-center gap-2">
              <Activity className="h-3 w-3 text-emerald-400" />
              <p className="text-[11px] font-semibold">Request pressure</p>
              <span className="text-slate-400">
                {totalRequests} req · {totalDuplicates} dupes ·{" "}
                <span className="text-emerald-400">
                  {totalCooldownBlocks} blocked
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  reset();
                  // Clear cooldown counters too — operators will
                  // expect both halves of the panel to zero out
                  // when they hit Reset.
                  resetCooldowns();
                }}
                title="Reset stats"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Hide"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {cooldownStats.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-700 bg-emerald-950/30">
              <p className="text-emerald-300 mb-1 flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Cooldown blocks (requests suppressed before flight):
              </p>
              <ul className="space-y-0.5">
                {cooldownStats.map((c) => (
                  <li
                    key={c.key}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-emerald-200">{c.key}</span>
                    <span className="tabular-nums text-emerald-400 shrink-0">
                      {c.blocks} blocked
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-emerald-400/70 mt-1 text-[9px]">
                These requests never fired — UX-level cooldown caught
                them. High counts here mean the user is mashing
                buttons; that's working as intended.
              </p>
            </div>
          )}

          {referenceDuplicates.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-700 bg-red-950/50">
              <p className="text-red-300 mb-1">
                🚨 Reference data duplicates (always a bug):
              </p>
              <ul className="space-y-0.5">
                {referenceDuplicates.map((s) => (
                  <li
                    key={s.family}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate text-red-200">{s.family}</span>
                    <span className="tabular-nums text-red-400 shrink-0">
                      {s.duplicatesIn5s} dupe{s.duplicatesIn5s === 1 ? "" : "s"}
                      {s.lastDuplicateSource && ` · last from ${s.lastDuplicateSource}`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-red-400/70 mt-1 text-[9px]">
                These should be served from the React Query cache after the first request.
                Check that consumers use the canonical hook (useClasses / useSubjects / etc).
              </p>
            </div>
          )}

          {duplicateHeavy.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-700 bg-amber-950/40">
              <p className="text-amber-300 mb-1">
                ⚠ Duplicate-heavy endpoints (cache miss likely):
              </p>
              <ul className="space-y-0.5">
                {duplicateHeavy.map((s) => (
                  <li
                    key={s.family}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate text-amber-200">{s.family}</span>
                    <span className="tabular-nums text-amber-400">
                      {s.duplicatesIn5s}× in 5s · avg {Math.round(s.avgGapMs)}ms
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="px-3 py-2 max-h-[320px] overflow-y-auto">
            {top.length === 0 ? (
              <p className="text-slate-400 text-center py-3">
                No requests recorded yet
              </p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left font-normal">Endpoint</th>
                    <th className="text-right font-normal">Total</th>
                    <th className="text-right font-normal">Dupes</th>
                    <th className="text-right font-normal">Avg gap</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((s) => (
                    <tr
                      key={s.family}
                      className={cn(
                        "border-t border-slate-800",
                        s.duplicatesIn5s >= 2 && "text-amber-300",
                      )}
                    >
                      <td className="truncate max-w-[240px] py-0.5">
                        {s.family}
                      </td>
                      <td className="text-right tabular-nums py-0.5">
                        {s.count}
                      </td>
                      <td className="text-right tabular-nums py-0.5">
                        {s.duplicatesIn5s || "—"}
                      </td>
                      <td className="text-right tabular-nums py-0.5">
                        {s.avgGapMs > 0
                          ? `${Math.round(s.avgGapMs)}ms`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 text-slate-100 px-2.5 h-7 text-[10px] shadow-lg",
            "hover:bg-slate-800",
            duplicateHeavy.length > 0 && "border-amber-500 bg-amber-900/40 text-amber-100",
            // Phase γ — reference-data duplicates escalate the chip
            // to red. They're never expected after cache warm-up.
            referenceDuplicates.length > 0 && "border-red-500 bg-red-900/50 text-red-100 animate-pulse",
          )}
          title={
            referenceDuplicates.length > 0
              ? "Reference data is duplicating — open to see which endpoint + source"
              : "Toggle dev request pressure panel"
          }
        >
          <Activity className="h-3 w-3" />
          {totalRequests} req
          {referenceDuplicates.length > 0 ? (
            <span className="text-red-300">
              · {referenceDuplicates.length} ref-dupe{referenceDuplicates.length === 1 ? "" : "s"}
            </span>
          ) : duplicateHeavy.length > 0 ? (
            <span className="text-amber-300">
              · {totalDuplicates} dupe{totalDuplicates === 1 ? "" : "s"}
            </span>
          ) : totalCooldownBlocks > 0 ? (
            // No duplicates AND cooldown is suppressing requests —
            // green positive signal so the developer sees the
            // suppression is working.
            <span className="text-emerald-300">
              · {totalCooldownBlocks} blocked
            </span>
          ) : null}
        </button>
      )}
    </div>
  );
}

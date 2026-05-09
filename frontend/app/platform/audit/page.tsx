"use client";

import * as React from "react";
import Link from "next/link";
import {
  ShieldAlert,
  RotateCw,
  Pause,
  Play,
  ExternalLink,
  X,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type PlatformAuditAction,
  type PlatformAuditResponse,
  type PlatformAuditRow,
  type SchoolStatus,
} from "@/lib/platform";
import {
  FilterToolbar,
  PageHeader,
  PanelEmptyState,
  PanelErrorState,
  SectionCard,
  SkeletonRows,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform/audit — searchable, filterable platform audit log.
//
// Layout:
//   • Filter strip (search · action · date range) + Refresh
//   • Result table — actor, action chip, target, what changed, when
//   • Click a row → opens a side panel with full before/after JSON,
//     IP, user agent, full reason
//   • Pagination
//
// Why a side-panel detail (not an inline expander or a separate page):
//   • The detail surface needs space for a JSON dump that can be
//     long. Inline expansion would push the rest of the table off-
//     screen mid-scroll. A separate page would lose the audit list
//     context — the operator's typically scanning multiple events.
//   • Side-panel pattern: list stays put, detail slides over from
//     the right. Same pattern Linear, Stripe, Datadog use for log
//     drilldown.
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const ACTION_OPTIONS: Array<{ key: PlatformAuditAction | ""; label: string }> = [
  { key: "", label: "All actions" },
  { key: "SCHOOL_STATUS_CHANGED", label: "School status changed" },
  { key: "SCHOOL_MAINTENANCE_TOGGLED", label: "Maintenance toggled" },
  { key: "SUBSCRIPTION_CREATED", label: "Subscription created" },
  { key: "FEATURE_FLAG_CHANGED", label: "Feature flags changed" },
  { key: "IMPERSONATION_STARTED", label: "Impersonation started" },
  { key: "IMPERSONATION_ENDED", label: "Impersonation ended" },
  { key: "USER_FORCE_LOGOUT", label: "User force-logout" },
  { key: "SCHOOL_FORCE_LOGOUT", label: "School force-logout" },
  { key: "ADMIN_PASSWORD_RESET", label: "Admin password reset" },
];

export default function PlatformAuditPage() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [action, setAction] = React.useState<PlatformAuditAction | "">("");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<PlatformAuditResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<PlatformAuditRow | null>(null);

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, action, fromDate, toDate]);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await platformApi.listAudit({
        q: debouncedSearch || undefined,
        action: (action || undefined) as PlatformAuditAction | undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load audit log.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, action, fromDate, toDate, page]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasFilters = !!debouncedSearch || !!action || !!fromDate || !!toDate;

  // Build the active-filter chips for the toolbar.
  const activeFilters = [
    action && {
      label: `Action: ${ACTION_OPTIONS.find((o) => o.key === action)?.label ?? action}`,
      onClear: () => setAction(""),
    },
    fromDate && {
      label: `From: ${fromDate}`,
      onClear: () => setFromDate(""),
    },
    toDate && { label: `To: ${toDate}`, onClear: () => setToDate("") },
  ].filter(Boolean) as { label: string; onClear: () => void }[];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Every platform-level write — who did what, when, and why."
        icon={<ShieldAlert className="h-4 w-4" />}
        actions={
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        }
      />

      <FilterToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search actor email, target, or reason…"
        activeFilters={activeFilters}
        onClearAll={
          hasFilters
            ? () => {
                setAction("");
                setFromDate("");
                setToDate("");
              }
            : undefined
        }
      >
        <select
          value={action}
          onChange={(e) =>
            setAction(e.target.value as PlatformAuditAction | "")
          }
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.key || "all"} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          max={toDate || undefined}
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
          aria-label="From date"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          min={fromDate || undefined}
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
          aria-label="To date"
        />
      </FilterToolbar>

      {/* Result count */}
      {data && !loading && (
        <p className="text-xs text-slate-500">
          {data.total.toLocaleString("en-IN")} event
          {data.total === 1 ? "" : "s"}
          {hasFilters && " (filtered)"}
        </p>
      )}

      {/* Table / state */}
      {loading ? (
        <SectionCard bare>
          <SkeletonRows rows={6} />
        </SectionCard>
      ) : error ? (
        <PanelErrorState message={error} onRetry={fetchData} />
      ) : !data || data.rows.length === 0 ? (
        <SectionCard bare>
          <PanelEmptyState
            icon={<ShieldAlert className="h-4 w-4" />}
            title={
              hasFilters ? "No events match these filters" : "No events recorded yet"
            }
            description={
              hasFilters ? "Try widening the search or date range." : undefined
            }
          />
        </SectionCard>
      ) : (
        <>
          <AuditTable rows={data.rows} onSelect={setSelected} />
          {data.total > PAGE_SIZE && (
            <Pagination
              page={page}
              total={data.total}
              pageSize={PAGE_SIZE}
              onChange={setPage}
            />
          )}
        </>
      )}

      <AuditDetailPanel
        row={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function AuditTable({
  rows,
  onSelect,
}: {
  rows: PlatformAuditRow[];
  onSelect: (r: PlatformAuditRow) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-4 py-2.5 text-left">When</th>
            <th className="px-4 py-2.5 text-left">Actor</th>
            <th className="px-4 py-2.5 text-left">Action</th>
            <th className="px-4 py-2.5 text-left">Target</th>
            <th className="px-4 py-2.5 text-left">What changed</th>
            <th className="px-4 py-2.5"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r)}
              className="cursor-pointer hover:bg-slate-50"
            >
              <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-600 tabular-nums">
                {formatDateTime(r.createdAt)}
              </td>
              <td className="px-4 py-3 text-xs">
                <div className="font-medium text-slate-900">
                  {r.actorEmail ?? "—"}
                </div>
                {r.actorRole && (
                  <div className="text-[10px] text-slate-500">
                    {r.actorRole}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                <ActionChip action={r.action} />
              </td>
              <td className="px-4 py-3 text-xs">
                <div className="font-medium text-slate-900">
                  {r.targetLabel ?? r.targetId.slice(0, 8) + "…"}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  {r.targetType}
                </div>
              </td>
              <td className="px-4 py-3 text-xs">
                <ChangeSummary row={r} />
              </td>
              <td className="px-4 py-3 text-right">
                <ExternalLink
                  className="inline h-3.5 w-3.5 text-slate-400"
                  aria-hidden
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChangeSummary — best-effort human-readable diff for the listed row.
//
// Today only one action exists (SCHOOL_STATUS_CHANGED), so the
// summary is a status-to-status arrow with semantic icons. A switch
// per action keeps the additions explicit when Phase 4/5/7 add new
// types.
// ---------------------------------------------------------------------------

function ChangeSummary({ row }: { row: PlatformAuditRow }) {
  if (row.action === "SCHOOL_STATUS_CHANGED") {
    const before = (row.before as { status?: SchoolStatus } | null)?.status;
    const after = (row.after as { status?: SchoolStatus } | null)?.status;
    return (
      <div className="flex items-center gap-1.5">
        {before && <StatusPill status={before} muted />}
        <span className="text-slate-300">→</span>
        {after && <StatusPill status={after} />}
      </div>
    );
  }
  if (row.action === "IMPERSONATION_STARTED") {
    return (
      <span className="inline-flex items-center gap-1 text-amber-800 text-xs font-medium">
        Started session
      </span>
    );
  }
  if (row.action === "IMPERSONATION_ENDED") {
    const after = row.after as { durationMs?: number } | null;
    const durationMs = after?.durationMs;
    return (
      <span className="inline-flex items-center gap-1 text-slate-700 text-xs">
        Ended
        {typeof durationMs === "number" && durationMs > 0 && (
          <span className="text-slate-500">
            · lasted {formatDuration(durationMs)}
          </span>
        )}
      </span>
    );
  }
  if (row.action === "SUBSCRIPTION_CREATED") {
    const after = row.after as
      | { plan?: string; endDate?: string | null }
      | null;
    const plan = after?.plan;
    const endDate = after?.endDate;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
        {plan && (
          <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">
            {plan}
          </span>
        )}
        <span className="text-slate-500">
          {endDate
            ? `until ${new Date(endDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
            : "no expiry"}
        </span>
      </span>
    );
  }
  if (row.action === "SCHOOL_MAINTENANCE_TOGGLED") {
    const before = (row.before as { maintenanceMode?: boolean } | null)
      ?.maintenanceMode;
    const after = (row.after as { maintenanceMode?: boolean } | null)
      ?.maintenanceMode;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-700">
        {before === true ? "ON" : "OFF"} → {after === true ? "ON" : "OFF"}
      </span>
    );
  }
  if (row.action === "USER_FORCE_LOGOUT") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-800">
        Forced logout
      </span>
    );
  }
  if (row.action === "SCHOOL_FORCE_LOGOUT") {
    const after = row.after as { affectedCount?: number } | null;
    const count = after?.affectedCount;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700">
        Forced logout · school-wide
        {typeof count === "number" && (
          <span className="text-slate-500">
            ({count.toLocaleString("en-IN")} users)
          </span>
        )}
      </span>
    );
  }
  if (row.action === "ADMIN_PASSWORD_RESET") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-700">
        Password reset
      </span>
    );
  }
  if (row.action === "FEATURE_FLAG_CHANGED") {
    const before = (row.before as { overrides?: Record<string, boolean> } | null)
      ?.overrides ?? {};
    const after = (row.after as { overrides?: Record<string, boolean> } | null)
      ?.overrides ?? {};
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diffs: Array<{ key: string; from?: boolean; to?: boolean }> = [];
    for (const key of allKeys) {
      const from = before[key];
      const to = after[key];
      if (from !== to) diffs.push({ key, from, to });
    }
    if (diffs.length === 0) {
      return (
        <span className="text-xs text-slate-500 italic">No changes</span>
      );
    }
    // Show up to 3 changes inline; collapse the rest into a "+N more".
    const shown = diffs.slice(0, 3);
    const extra = diffs.length - shown.length;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
        {shown.map((d) => (
          <span
            key={d.key}
            className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
            title={`${d.key}: ${flagLabel(d.from)} → ${flagLabel(d.to)}`}
          >
            <span className="font-semibold">{d.key}</span>
            <span className="text-slate-400">{flagArrow(d.from, d.to)}</span>
          </span>
        ))}
        {extra > 0 && (
          <span className="text-[10px] text-slate-500">+{extra} more</span>
        )}
      </span>
    );
  }
  // Fallback for actions we haven't customised yet — show
  // "before keys" → "after keys" so a developer can spot what
  // changed without opening the detail panel.
  return (
    <span className="text-slate-500 italic">
      {summariseUnknown(row.before, row.after)}
    </span>
  );
}

/** Compact "12m 34s" / "2h 5m" formatter for impersonation durations. */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

/** Render a feature flag value as a compact "on" / "off" / "—" label. */
function flagLabel(v?: boolean): string {
  if (v === true) return "on";
  if (v === false) return "off";
  return "—";
}

/** Compact transition arrow showing what flipped. */
function flagArrow(from?: boolean, to?: boolean): string {
  return `${flagLabel(from)} → ${flagLabel(to)}`;
}

function summariseUnknown(before: unknown, after: unknown): string {
  if (!before && !after) return "—";
  const beforeKeys = Object.keys((before ?? {}) as object).join(", ");
  const afterKeys = Object.keys((after ?? {}) as object).join(", ");
  if (beforeKeys && afterKeys) return `${beforeKeys} → ${afterKeys}`;
  return afterKeys || beforeKeys || "—";
}

function StatusPill({
  status,
  muted,
}: {
  status: SchoolStatus;
  muted?: boolean;
}) {
  const map: Record<SchoolStatus, { label: string; cls: string; icon?: typeof Pause }> =
    {
      ACTIVE: {
        label: "Active",
        cls: "bg-emerald-500/15 text-emerald-700",
        icon: Play,
      },
      TRIAL: { label: "Trial", cls: "bg-sky-500/15 text-sky-700" },
      SUSPENDED: {
        label: "Suspended",
        cls: "bg-red-500/15 text-red-700",
        icon: Pause,
      },
      EXPIRED: { label: "Expired", cls: "bg-amber-500/15 text-amber-700" },
    };
  const m = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${m.cls} ${
        muted ? "opacity-60" : ""
      }`}
    >
      {m.icon && <m.icon className="h-2.5 w-2.5" aria-hidden />}
      {m.label}
    </span>
  );
}

function ActionChip({ action }: { action: PlatformAuditAction }) {
  // Action chip drives the visual taxonomy. As more actions land in
  // Phase 4/5/9, each gets its own entry here. The side panel shows
  // the full action label; this chip is the at-a-glance scan version.
  if (action === "SCHOOL_STATUS_CHANGED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
        <ShieldAlert className="h-2.5 w-2.5" />
        Status
      </span>
    );
  }
  if (action === "IMPERSONATION_STARTED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        <ShieldAlert className="h-2.5 w-2.5" />
        Imp · Start
      </span>
    );
  }
  if (action === "IMPERSONATION_ENDED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
        <ShieldAlert className="h-2.5 w-2.5" />
        Imp · End
      </span>
    );
  }
  if (action === "SUBSCRIPTION_CREATED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
        <ShieldAlert className="h-2.5 w-2.5" />
        Plan
      </span>
    );
  }
  if (action === "FEATURE_FLAG_CHANGED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-800">
        <ShieldAlert className="h-2.5 w-2.5" />
        Features
      </span>
    );
  }
  if (action === "SCHOOL_MAINTENANCE_TOGGLED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        <ShieldAlert className="h-2.5 w-2.5" />
        Maintenance
      </span>
    );
  }
  if (action === "USER_FORCE_LOGOUT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        <ShieldAlert className="h-2.5 w-2.5" />
        Logout · User
      </span>
    );
  }
  if (action === "SCHOOL_FORCE_LOGOUT") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-800">
        <ShieldAlert className="h-2.5 w-2.5" />
        Logout · School
      </span>
    );
  }
  if (action === "ADMIN_PASSWORD_RESET") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-800">
        <ShieldAlert className="h-2.5 w-2.5" />
        Reset
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-700">
      {action}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AuditDetailPanel — slide-over with full row context.
//
// Closes on Esc, on outside-click, and on the X button. Doesn't use
// a Modal because Modals are centered + dim the whole page; an
// audit detail wants the list to remain visible (the operator is
// often comparing rows).
// ---------------------------------------------------------------------------

function AuditDetailPanel({
  row,
  onClose,
}: {
  row: PlatformAuditRow | null;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  if (!row) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex"
      onClick={onClose}
    >
      {/* Backdrop — light overlay, list still partly visible behind. */}
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-y-auto bg-white shadow-2xl border-l border-slate-200 animate-fade-in-up"
      >
        <header className="sticky top-0 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Audit event
            </h2>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
              {row.action}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 px-5 py-5 text-sm">
          <DetailRow label="When">
            <span className="font-mono text-xs">{formatDateTime(row.createdAt, true)}</span>
          </DetailRow>
          <DetailRow label="Actor">
            <div>
              <div className="font-medium text-slate-900">{row.actorEmail ?? "—"}</div>
              <div className="text-[11px] text-slate-500">
                {row.actorRole ?? "—"} ·{" "}
                <span className="font-mono">{row.actorUserId}</span>
              </div>
            </div>
          </DetailRow>
          <DetailRow label="Target">
            <div>
              <div className="font-medium text-slate-900">
                {row.targetLabel ?? "—"}
              </div>
              <div className="text-[11px] text-slate-500">
                {row.targetType} ·{" "}
                <span className="font-mono">{row.targetId}</span>
                {row.targetType === "SCHOOL" && (
                  <>
                    {" · "}
                    <Link
                      href={`/platform/schools?status=`}
                      className="text-slate-700 underline hover:text-slate-900"
                    >
                      View in schools
                    </Link>
                  </>
                )}
              </div>
            </div>
          </DetailRow>
          {row.reason && (
            <DetailRow label="Reason">
              <p className="text-slate-800 italic">{row.reason}</p>
            </DetailRow>
          )}

          <DetailRow label="Before">
            <JsonBlock value={row.before} />
          </DetailRow>
          <DetailRow label="After">
            <JsonBlock value={row.after} />
          </DetailRow>

          {(row.ip || row.userAgent) && (
            <div className="border-t border-slate-200 pt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Network context
              </p>
              {row.ip && (
                <DetailRow label="IP">
                  <span className="font-mono text-xs">{row.ip}</span>
                </DetailRow>
              )}
              {row.userAgent && (
                <DetailRow label="User agent">
                  <span className="font-mono text-[11px] break-all text-slate-600">
                    {row.userAgent}
                  </span>
                </DetailRow>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-400 italic">null</span>;
  }
  return (
    <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-mono text-slate-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ---------------------------------------------------------------------------

function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between text-sm">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
        className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        Previous
      </button>
      <span className="text-xs tabular-nums text-slate-500">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

// (Skeleton/Empty/Error states moved to @/components/platform-ui —
//  SkeletonRows / PanelEmptyState / PanelErrorState.)

// ---------------------------------------------------------------------------

/**
 * Format an ISO timestamp for the audit table.
 *
 *   short=true (table)  → "May 16, 14:32"
 *   long  (panel)        → "May 16, 2026 at 14:32:18"
 *
 * `Intl.DateTimeFormat` rather than `toLocaleString` for explicit
 * options and locale-stable output regardless of the user's
 * preference (audit logs are global artifacts, not personalised).
 */
function formatDateTime(iso: string, long: boolean = false): string {
  const d = new Date(iso);
  if (long) {
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

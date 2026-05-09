"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  Layers,
  Loader2,
  Lock,
  RotateCcw,
  Save,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type PlatformFeatureCatalogEntry,
  type PlatformFeatureMatrixResponse,
  type PlatformFeatureSchoolRow,
  type SchoolStatus,
  type SubscriptionPlan,
} from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  PageHeader,
  PanelErrorState,
  PanelLoadingState,
} from "@/components/platform-ui";

// ---------------------------------------------------------------------------
// /platform/features — Phase 5 cross-tenant feature flag matrix.
//
// Shape:
//   • One row per school (capped at 100, same as the schools list).
//   • One column per catalog entry. Coming-soon features are styled
//     muted but still toggleable — the override sticks regardless,
//     ready for the moment the backend wires a new module behind the
//     same key.
//   • Click a cell to flip the OVERRIDE for that school × feature.
//     "On" / "Off" / "Inherit" are the three states the cell can be
//     in:
//       — Inherit (no override)  → grey "—", subscription/default wins.
//       — Override ON            → green check, "Forced on".
//       — Override OFF           → red X, "Forced off".
//   • The "Resolved" pill on the left of each cell shows the current
//     EFFECTIVE state (i.e., what the school actually sees). When
//     the override is "inherit", the pill matches subscription /
//     default; when it's "on" / "off", the pill always matches.
//
// Editing model:
//   Local-first. Every cell click stages a change in component state
//   (`pending` map). The "Save changes" button at the school-row
//   level commits via PATCH /platform/schools/:id/features. A
//   row-level "Reset" button drops staged changes for that row.
//
//   Why row-level commit (not whole-table): every PATCH request is
//   audited as a single FEATURE_FLAG_CHANGED event. Batching across
//   schools would muddy the audit trail; per-school commits keep
//   each audit row interpretable.
// ---------------------------------------------------------------------------

type CellState = "on" | "off" | "inherit";

interface PendingPerSchool {
  /** Map of feature key → desired override state ("inherit" = remove). */
  [feature: string]: CellState;
}

export default function PlatformFeaturesPage() {
  const [data, setData] = React.useState<PlatformFeatureMatrixResponse | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  /** Map of schoolId → pending overrides waiting to be saved. */
  const [pending, setPending] = React.useState<
    Record<string, PendingPerSchool>
  >({});

  /** schoolId currently submitting (for the spinner / disabled state). */
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await platformApi.listFeatureMatrix();
      setData(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to load feature matrix.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Cell click → cycle through the three states. */
  const cycleCell = (
    schoolId: string,
    featureKey: string,
    currentOverride: CellState,
  ) => {
    setPending((prev) => {
      const next = { ...prev };
      const row = { ...(next[schoolId] ?? {}) };
      const staged = row[featureKey] ?? currentOverride;
      const newState: CellState =
        staged === "inherit" ? "on" : staged === "on" ? "off" : "inherit";
      row[featureKey] = newState;

      // If every staged value matches the persisted state, drop the
      // row entirely so the "unsaved changes" indicator clears.
      const allClean = data
        ? Object.entries(row).every(([k, v]) => {
            const persisted =
              data.schools.find((s) => s.id === schoolId)?.overrides[k];
            const persistedState: CellState =
              persisted === undefined
                ? "inherit"
                : persisted
                  ? "on"
                  : "off";
            return v === persistedState;
          })
        : false;
      if (allClean) {
        delete next[schoolId];
      } else {
        next[schoolId] = row;
      }
      return next;
    });
  };

  const resetRow = (schoolId: string) => {
    setPending((prev) => {
      const next = { ...prev };
      delete next[schoolId];
      return next;
    });
  };

  const saveRow = async (school: PlatformFeatureSchoolRow) => {
    const staged = pending[school.id];
    if (!staged) return;

    // Compose the new overrides map: start from existing, apply staged.
    const next: Record<string, boolean> = { ...school.overrides };
    for (const [k, v] of Object.entries(staged)) {
      if (v === "inherit") {
        delete next[k];
      } else {
        next[k] = v === "on";
      }
    }

    setSavingId(school.id);
    try {
      await platformApi.setSchoolFeatures(school.id, { overrides: next });
      toast.success(`Updated feature flags for ${school.name}.`);
      // Drop staged + reload — the response includes the resolved
      // set, but reloading the matrix keeps everything (including
      // the audit-derived "subscription" column) in sync.
      setPending((prev) => {
        const out = { ...prev };
        delete out[school.id];
        return out;
      });
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Failed to save feature flags.",
      );
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return <PanelLoadingState />;
  }
  if (error || !data) {
    return (
      <PanelErrorState
        message={error ?? "Could not load matrix."}
        onRetry={load}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feature flags"
        description="Override what each school can access. Empty cells inherit from the school's plan; click to force on or off."
        icon={<Layers className="h-4 w-4" />}
      />

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left font-medium text-slate-600">
                School
              </th>
              {data.catalog.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-3 py-3 text-center align-bottom font-medium text-slate-600",
                    c.comingSoon && "text-slate-400",
                  )}
                  title={c.description}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span>{c.label}</span>
                    {c.comingSoon && (
                      <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                        Soon
                      </span>
                    )}
                  </div>
                </th>
              ))}
              <th className="sticky right-0 z-10 bg-slate-50 px-4 py-3 text-right font-medium text-slate-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {data.schools.map((school) => (
              <FeatureRow
                key={school.id}
                school={school}
                catalog={data.catalog}
                pending={pending[school.id]}
                onCellClick={cycleCell}
                onReset={() => resetRow(school.id)}
                onSave={() => saveRow(school)}
                saving={savingId === school.id}
                hasPending={!!pending[school.id]}
              />
            ))}
            {data.schools.length === 0 && (
              <tr>
                <td
                  colSpan={data.catalog.length + 2}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No schools yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Legend />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeatureRow — one school's row.
// ---------------------------------------------------------------------------

function FeatureRow({
  school,
  catalog,
  pending,
  onCellClick,
  onReset,
  onSave,
  saving,
  hasPending,
}: {
  school: PlatformFeatureSchoolRow;
  catalog: PlatformFeatureCatalogEntry[];
  pending: PendingPerSchool | undefined;
  onCellClick: (
    schoolId: string,
    featureKey: string,
    currentOverride: CellState,
  ) => void;
  onReset: () => void;
  onSave: () => void;
  saving: boolean;
  hasPending: boolean;
}) {
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40">
      <td className="sticky left-0 z-10 bg-white px-4 py-3 hover:bg-slate-50/40">
        <div className="flex flex-col">
          <span className="font-medium text-slate-900">{school.name}</span>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
            <StatusChip status={school.status} />
            {school.currentPlan && <PlanChip plan={school.currentPlan} />}
            <span className="text-slate-400">{school.slug}</span>
          </div>
        </div>
      </td>
      {catalog.map((c) => {
        const persistedOverride = school.overrides[c.key];
        const persistedState: CellState =
          persistedOverride === undefined
            ? "inherit"
            : persistedOverride
              ? "on"
              : "off";
        const stagedState = pending?.[c.key];
        const displayState = stagedState ?? persistedState;
        const isStaged = stagedState !== undefined && stagedState !== persistedState;

        // Resolved (effective) state — what the school CURRENTLY
        // sees, before any pending change.
        const resolvedNow = school.features[c.key] ?? false;

        return (
          <td key={c.key} className="px-3 py-3 text-center">
            <FeatureCell
              state={displayState}
              resolvedNow={resolvedNow}
              staged={isStaged}
              onClick={() => onCellClick(school.id, c.key, persistedState)}
            />
          </td>
        );
      })}
      <td className="sticky right-0 z-10 bg-white px-4 py-3 hover:bg-slate-50/40">
        <div className="flex items-center justify-end gap-1">
          {hasPending && (
            <>
              <button
                type="button"
                onClick={onReset}
                disabled={saving}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                title="Discard staged changes"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// FeatureCell — three-state toggle.
// ---------------------------------------------------------------------------

function FeatureCell({
  state,
  resolvedNow,
  staged,
  onClick,
}: {
  state: CellState;
  resolvedNow: boolean;
  staged: boolean;
  onClick: () => void;
}) {
  const label =
    state === "on"
      ? "Forced on"
      : state === "off"
        ? "Forced off"
        : `Inherit (${resolvedNow ? "on" : "off"})`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
        state === "on" &&
          "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
        state === "off" &&
          "border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
        state === "inherit" &&
          "border-slate-200 bg-white text-slate-300 hover:bg-slate-100",
        staged && "ring-2 ring-amber-300 ring-offset-1",
      )}
    >
      {state === "on" ? (
        <Check className="h-3.5 w-3.5" />
      ) : state === "off" ? (
        <X className="h-3.5 w-3.5" />
      ) : (
        <span className="text-[10px] font-semibold">—</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status / plan chips. Mini versions tuned for the dense matrix row.
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: SchoolStatus }) {
  const map: Record<SchoolStatus, { label: string; className: string }> = {
    ACTIVE: {
      label: "Active",
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    },
    TRIAL: {
      label: "Trial",
      className: "bg-blue-50 text-blue-700 border-blue-200",
    },
    SUSPENDED: {
      label: "Suspended",
      className: "bg-amber-50 text-amber-700 border-amber-200",
    },
    EXPIRED: {
      label: "Expired",
      className: "bg-red-50 text-red-700 border-red-200",
    },
  };
  const m = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
        m.className,
      )}
    >
      {m.label}
    </span>
  );
}

function PlanChip({ plan }: { plan: SubscriptionPlan }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-700">
      {plan}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legend strip — explains the three cell states.
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
      <span className="font-medium text-slate-700">Cell states:</span>
      <LegendItem
        icon={<Check className="h-3 w-3" />}
        className="border-emerald-300 bg-emerald-50 text-emerald-700"
        label="Forced on (override)"
      />
      <LegendItem
        icon={<X className="h-3 w-3" />}
        className="border-red-300 bg-red-50 text-red-700"
        label="Forced off (override)"
      />
      <LegendItem
        icon={<span className="text-[9px] font-semibold">—</span>}
        className="border-slate-200 bg-white text-slate-300"
        label="Inherit (subscription / default)"
      />
      <span className="ml-auto text-slate-500">
        Click a cell to cycle through the three states. Save to commit.
      </span>
    </div>
  );
}

function LegendItem({
  icon,
  className,
  label,
}: {
  icon: React.ReactNode;
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-md border",
          className,
        )}
      >
        {icon}
      </span>
      <span className="text-[11px] text-slate-600">{label}</span>
    </span>
  );
}

// Suppress unused import warning (Lock + ChevronDown + ToggleLeft + ToggleRight
// are imported for future affordances — keep for now to avoid churn).
void Lock;
void ChevronDown;
void ToggleLeft;
void ToggleRight;

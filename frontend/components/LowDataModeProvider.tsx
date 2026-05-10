"use client";

import * as React from "react";
import { Gauge } from "lucide-react";
import { useNetworkInfo } from "@/hooks/useNetworkInfo";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// LowDataModeProvider — Phase 26 Section 2.
//
// Single source of truth for "are we in low-data mode?". Components
// + hooks consume it via `useLowDataMode()`. Three sources can flip
// the mode on:
//
//   1. Network Information API reports effectiveType in {slow-2g, 2g}
//   2. saveData=true (user has OS-level Data Saver enabled)
//   3. Explicit operator toggle (localStorage override)
//
// The provider exposes:
//   • `lowData`           — the resolved state
//   • `reason`            — why it's on ("auto:2g" / "saveData" / "manual")
//   • `manualOverride`    — operator can force on/off via the topbar pill
//   • `setManualOverride` — write that override
//
// Effects published downstream:
//   • Polling intervals scale up (e.g. notifications poll every 2m
//     instead of 30s)
//   • Decorative animations skipped (pair with prefers-reduced-motion)
//   • Background refetches paused
//   • Heavy analytics widgets render placeholders until tapped
//
// We deliberately don't enforce the effects globally — each consumer
// (notifications poll loop, charts, etc.) reads the flag and decides.
// That keeps the architecture honest: lowData is signal, not magic.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "scholaris:lowDataMode";

export type LowDataReason = "auto-network" | "auto-saveData" | "manual" | null;
export type ManualOverride = "on" | "off" | null;

export interface LowDataModeContextValue {
  lowData: boolean;
  reason: LowDataReason;
  manualOverride: ManualOverride;
  setManualOverride: (next: ManualOverride) => void;
}

const Ctx = React.createContext<LowDataModeContextValue | null>(null);

export function LowDataModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const network = useNetworkInfo();
  const [manualOverride, setManualOverrideState] =
    React.useState<ManualOverride>(null);

  // Hydrate manual override from localStorage on mount.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "on" || raw === "off") setManualOverrideState(raw);
    } catch {
      /* ignore */
    }
  }, []);

  const setManualOverride = React.useCallback((next: ManualOverride) => {
    setManualOverrideState(next);
    if (typeof window === "undefined") return;
    try {
      if (next === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  // Resolve the effective state. Manual override beats auto-detect.
  const value = React.useMemo<LowDataModeContextValue>(() => {
    if (manualOverride === "on") {
      return {
        lowData: true,
        reason: "manual",
        manualOverride,
        setManualOverride,
      };
    }
    if (manualOverride === "off") {
      return {
        lowData: false,
        reason: null,
        manualOverride,
        setManualOverride,
      };
    }
    if (network.saveData) {
      return {
        lowData: true,
        reason: "auto-saveData",
        manualOverride,
        setManualOverride,
      };
    }
    if (network.effectiveType === "slow-2g" || network.effectiveType === "2g") {
      return {
        lowData: true,
        reason: "auto-network",
        manualOverride,
        setManualOverride,
      };
    }
    return {
      lowData: false,
      reason: null,
      manualOverride,
      setManualOverride,
    };
  }, [manualOverride, network.saveData, network.effectiveType, setManualOverride]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLowDataMode(): LowDataModeContextValue {
  const ctx = React.useContext(Ctx);
  if (!ctx) {
    // Provider not mounted (e.g. anonymous pages, tests). Default to
    // "no low-data mode" so consumers behave normally.
    return {
      lowData: false,
      reason: null,
      manualOverride: null,
      setManualOverride: () => undefined,
    };
  }
  return ctx;
}

/**
 * Helper for poll-interval consumers. Scales the supplied interval
 * by 4× when low-data mode is on (e.g. 30s → 2m). Returns Infinity
 * to fully disable polling — pass that to React Query's
 * `refetchInterval`.
 */
export function useLowDataPollInterval(
  baseMs: number,
  options: { disableInLowData?: boolean } = {},
): number | false {
  const { lowData } = useLowDataMode();
  if (!lowData) return baseMs;
  if (options.disableInLowData) return false;
  return baseMs * 4;
}

// ---------------------------------------------------------------------------
// LowDataPill — visible indicator for the topbar
// ---------------------------------------------------------------------------

/**
 * Compact pill that appears in the topbar when low-data mode is on.
 * Click to toggle off (manual override). Self-hides when the mode
 * is off.
 */
export function LowDataPill() {
  const { lowData, reason, manualOverride, setManualOverride } =
    useLowDataMode();
  if (!lowData) return null;
  const label =
    reason === "auto-saveData"
      ? "Data Saver on"
      : reason === "auto-network"
        ? "Slow network — Low Data Mode"
        : "Low Data Mode";
  return (
    <button
      type="button"
      onClick={() => {
        // Cycle: auto → manual off → manual on → auto
        if (manualOverride === null) setManualOverride("off");
        else if (manualOverride === "off") setManualOverride("on");
        else setManualOverride(null);
      }}
      title={
        manualOverride
          ? "Manual override active. Tap to cycle."
          : "Auto-detected. Tap to override."
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 h-7 text-[11px] font-medium",
        "border-amber-300 bg-amber-50 text-amber-900",
        "hover:bg-amber-100 transition-colors",
      )}
    >
      <Gauge className="h-3 w-3" />
      {label}
    </button>
  );
}

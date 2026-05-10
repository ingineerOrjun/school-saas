"use client";

import * as React from "react";

// ---------------------------------------------------------------------------
// useNetworkInfo — Phase 26 Section 2.
//
// Reads the browser Network Information API (`navigator.connection`)
// and resubscribes when the connection changes. Used by useLowDataMode
// to flip the app into a reduced-cost rendering mode automatically.
//
// Browser support:
//   • Chrome / Edge / Opera on Android  → full support (effectiveType + saveData)
//   • Chrome / Edge on desktop          → effectiveType only on metered links
//   • Firefox / Safari                  → no support — returns "unknown" defaults
//
// We DON'T treat lack-of-support as a failure. The default ("unknown" /
// no saveData) keeps the app in normal mode, which is the right
// fallback for desktop browsers without the API.
//
// SSR-safe: returns the unknown-defaults snapshot during SSR + first
// render, then resolves on the client.
// ---------------------------------------------------------------------------

export type EffectiveType = "slow-2g" | "2g" | "3g" | "4g" | "unknown";

export interface NetworkInfo {
  /** Effective connection type. "unknown" when API isn't available. */
  effectiveType: EffectiveType;
  /** True when the user has the OS-level "Data Saver" toggle on. */
  saveData: boolean;
  /** Estimated downlink (Mbps). 0 when unknown. */
  downlinkMbps: number;
  /** Round-trip-time estimate (ms). 0 when unknown. */
  rttMs: number;
  /** True when the API is available + reporting real values. */
  supported: boolean;
}

const UNKNOWN: NetworkInfo = {
  effectiveType: "unknown",
  saveData: false,
  downlinkMbps: 0,
  rttMs: 0,
  supported: false,
};

interface ConnectionLike {
  effectiveType?: string;
  saveData?: boolean;
  downlink?: number;
  rtt?: number;
  addEventListener?: (event: string, listener: () => void) => void;
  removeEventListener?: (event: string, listener: () => void) => void;
}

function read(): NetworkInfo {
  if (typeof navigator === "undefined") return UNKNOWN;
  const conn = (navigator as Navigator & { connection?: ConnectionLike })
    .connection;
  if (!conn) return UNKNOWN;
  const eff = conn.effectiveType;
  return {
    effectiveType:
      eff === "slow-2g" || eff === "2g" || eff === "3g" || eff === "4g"
        ? eff
        : "unknown",
    saveData: !!conn.saveData,
    downlinkMbps: typeof conn.downlink === "number" ? conn.downlink : 0,
    rttMs: typeof conn.rtt === "number" ? conn.rtt : 0,
    supported: true,
  };
}

export function useNetworkInfo(): NetworkInfo {
  const [info, setInfo] = React.useState<NetworkInfo>(UNKNOWN);

  React.useEffect(() => {
    if (typeof navigator === "undefined") return;
    const conn = (navigator as Navigator & { connection?: ConnectionLike })
      .connection;
    setInfo(read());
    if (!conn?.addEventListener) return;
    const update = () => setInfo(read());
    conn.addEventListener("change", update);
    return () => conn.removeEventListener?.("change", update);
  }, []);

  return info;
}

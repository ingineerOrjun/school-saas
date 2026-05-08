"use client";

import * as React from "react";

/**
 * Track the browser's connectivity. Mirrors `navigator.onLine` and
 * subscribes to the `online` / `offline` events so re-renders happen
 * when the device flips state.
 *
 * SSR-safe: returns `true` on the server (we don't have a window
 * object yet) so first-render markup matches the most-likely state
 * after hydration.
 *
 * `navigator.onLine` is best-effort — it tells you whether the OS
 * thinks there's a network adapter up, NOT whether the API server
 * is reachable. Combine with the sync engine's actual fetch errors
 * for a complete picture: `online && lastSyncFailed === network` is
 * the "captive portal / DNS down" case.
 */
export function useOnlineStatus(): boolean {
  // Default to `true` on the server and on the very first client
  // render. If we defaulted to `false`, every page would briefly
  // flash an "offline" badge before the effect ran.
  const [online, setOnline] = React.useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine !== false;
  });

  React.useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine !== false);
    };
    // Read once on mount in case the value changed between SSR and
    // hydration (unlikely but cheap to verify).
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

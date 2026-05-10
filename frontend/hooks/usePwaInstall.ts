"use client";

import * as React from "react";

// ---------------------------------------------------------------------------
// usePwaInstall — Phase 26 Section 6.
//
// Captures the deferred `beforeinstallprompt` event so the app can
// surface a custom install button at the right moment (after the
// user has demonstrated engagement) instead of letting Chrome
// trigger its own auto-prompt at a less helpful time.
//
// Returns:
//   • `canInstall`  — true when the browser is willing to prompt
//   • `installed`   — true after the user accepted (or the app is
//                      already installed; we detect via the
//                      `appinstalled` event AND display-mode media)
//   • `prompt()`    — call to actually surface the install dialog.
//                      Resolves after the user accepts/dismisses.
//
// Browser support:
//   Chrome / Edge / Opera (Android + desktop) — full
//   Safari (iOS) — no `beforeinstallprompt`. iOS uses the share-sheet
//                  "Add to Home Screen" instead; this hook returns
//                  `canInstall=false` and the UI should skip the
//                  install affordance there.
//   Firefox — desktop: no install. Android: yes via the address-bar
//             menu, no programmatic prompt.
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PwaInstallApi {
  canInstall: boolean;
  installed: boolean;
  prompt: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export function usePwaInstall(): PwaInstallApi {
  const deferredRef = React.useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = React.useState(false);
  const [installed, setInstalled] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    // Detect "already installed" via display-mode. Safari iOS reports
    // "standalone" via `navigator.standalone` instead; check both.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
      deferredRef.current = null;
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const prompt = React.useCallback<PwaInstallApi["prompt"]>(async () => {
    const ev = deferredRef.current;
    if (!ev) return "unavailable";
    await ev.prompt();
    const choice = await ev.userChoice;
    deferredRef.current = null;
    setCanInstall(false);
    return choice.outcome;
  }, []);

  return { canInstall, installed, prompt };
}

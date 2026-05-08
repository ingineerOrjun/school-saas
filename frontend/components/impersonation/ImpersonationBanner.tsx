"use client";

import * as React from "react";
import { ShieldAlert, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  endImpersonation,
  getImpersonationContext,
  type ImpersonationContext,
} from "@/lib/auth";
import { platformApi } from "@/lib/platform";

// ---------------------------------------------------------------------------
// ImpersonationBanner — sticky alert bar across the top of the school
// dashboard whenever an impersonation session is active.
//
// What it has to do:
//   • Always-visible signal: "you are NOT looking at your own data."
//   • One-click exit that swaps tokens + lands the user back on the
//     platform area.
//   • Survives page navigation + reload (state is in localStorage,
//     not React state).
//   • Goes away cleanly when the session ends.
//
// What it deliberately doesn't do:
//   • Confirm before exit. The exit flow is the safe direction —
//     leaving impersonation can never destroy data. The destructive
//     direction (entering) is the one that needs confirmation; that
//     UI lives on /platform/schools.
//
// Mounting:
//   This component is rendered at the dashboard layout level, NOT
//   per-page. That guarantees the banner shows on EVERY school-side
//   page during an impersonation session (no chance of a forgotten
//   page rendering the school admin's UI without it).
// ---------------------------------------------------------------------------

export function ImpersonationBanner() {
  // Hydration-safe state: read context only on the client. Server
  // doesn't have localStorage, so the banner renders nothing during
  // SSR — that's correct, since impersonation is a client-side
  // session concept.
  const [ctx, setCtx] = React.useState<ImpersonationContext | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [exiting, setExiting] = React.useState(false);

  React.useEffect(() => {
    setCtx(getImpersonationContext());
    setHydrated(true);
  }, []);

  // Refresh the banner if another tab ends/starts impersonation —
  // common when the operator has the platform tab + an impersonated
  // tab open at once. `storage` events fire only in OTHER tabs, not
  // the writer.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "scholaris:impersonation" || e.key === null) {
        setCtx(getImpersonationContext());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!hydrated || !ctx) return null;

  const handleExit = async () => {
    if (exiting) return;
    setExiting(true);
    try {
      const res = await platformApi.endImpersonation();
      endImpersonation({
        accessToken: res.accessToken,
        superAdmin: {
          id: res.user.id,
          email: res.user.email,
          // The backend returns role as string (Prisma enum). We
          // narrow to the frontend Role type here — the END endpoint
          // never returns anything other than SUPER_ADMIN.
          role: res.user.role as "SUPER_ADMIN",
          schoolId: res.user.schoolId,
        },
      });
      // Hard navigate so EVERY layout (including dashboard, which
      // caches role from localStorage) re-reads from the new token.
      // A soft router.push wouldn't refresh the role-gated sidebars.
      window.location.assign("/platform/schools");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to exit impersonation.";
      toast.error(message);
      // 401 here means the impersonation token expired before the
      // user clicked exit. There's no clean recovery — fall back to
      // /login so they can sign back in as SUPER_ADMIN.
      if (err instanceof ApiError && err.status === 401) {
        endImpersonation({
          accessToken: "",
          superAdmin: { id: "", email: "", role: "SUPER_ADMIN", schoolId: "" },
        });
        window.location.assign("/login");
      }
    } finally {
      setExiting(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className="sticky top-0 z-40 bg-amber-500 text-amber-950 print:hidden"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-semibold uppercase tracking-wider text-[11px]">
            Impersonating
          </span>
          <span className="truncate font-medium">
            {ctx.targetEmail}
          </span>
          <span className="rounded-sm bg-amber-950/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            {ctx.targetRole}
          </span>
          <span className="hidden sm:inline text-[11px] text-amber-950/70">
            · {ctx.schoolSlug}
          </span>
          <DurationLabel startedAt={ctx.startedAt} />
        </div>
        <button
          type="button"
          onClick={handleExit}
          disabled={exiting}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-950/90 disabled:opacity-50 transition-colors"
        >
          {exiting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Exiting…
            </>
          ) : (
            <>
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Exit impersonation
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Live elapsed-time label. Updates every 30s — granular enough to
 * be useful, sparse enough to not cause re-render churn.
 */
function DurationLabel({ startedAt }: { startedAt: string }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return null;
  const elapsedSec = Math.max(0, Math.floor((now - startedMs) / 1000));
  const label =
    elapsedSec < 60
      ? "just now"
      : elapsedSec < 3600
        ? `${Math.floor(elapsedSec / 60)}m`
        : `${Math.floor(elapsedSec / 3600)}h ${Math.floor((elapsedSec % 3600) / 60)}m`;

  return (
    <span className="hidden md:inline text-[11px] text-amber-950/60">
      · {label}
    </span>
  );
}

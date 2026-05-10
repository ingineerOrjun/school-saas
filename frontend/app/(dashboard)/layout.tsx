"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { ImpersonationBanner } from "@/components/impersonation/ImpersonationBanner";
import { LowDataModeProvider } from "@/components/LowDataModeProvider";
import { MaintenanceBanner } from "@/components/maintenance/MaintenanceBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { QuickActionFab } from "@/components/QuickActionFab";
import { RequestPressurePanel } from "@/components/dev/RequestPressurePanel";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { useQueueAwareBeforeUnload } from "@/hooks/useQueueAwareGuards";
import { getStoredUser, getToken } from "@/lib/auth";
import { FeaturesProvider } from "@/lib/features";

const TOKEN_KEY = "scholaris:token";
const USER_KEY = "scholaris:user";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [authChecked, setAuthChecked] = React.useState(false);

  // ----- Initial auth gate -----
  // Both a token AND a stored user are required. Token-only is a
  // half-state that used to slip through (e.g., manually-cleared
  // user JSON) — the dashboard would then render with `null` user
  // and every per-role decision would silently fall back to admin.
  React.useEffect(() => {
    const token = getToken();
    const user = getStoredUser();
    if (!token || !user) {
      router.replace("/login");
      return;
    }
    setAuthChecked(true);
  }, [router]);

  // ----- Cross-tab safety -----
  // localStorage is shared across tabs in the same origin. When
  // another tab logs out (token removed) or logs in as a different
  // user (token swapped), this tab's session is stale. Rather than
  // silently keeping the old UI, hard-navigate to /login so both
  // tabs converge on whatever the latest auth state is.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      // Only react to changes on the keys we care about.
      if (e.key !== TOKEN_KEY && e.key !== USER_KEY) return;
      // Ignore "no actual change" events (some browsers emit on
      // setItem-with-same-value).
      if (e.oldValue === e.newValue) return;
      // Hard navigation so every component remounts cleanly under
      // the new (or absent) identity.
      window.location.assign("/login");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Close the mobile drawer on every navigation. Without this, tapping
  // a nav link would change the page but leave the drawer covering the
  // content — looks broken even if it's just a stale UI state.
  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (!authChecked) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-app">
        <div className="flex items-center gap-2.5 text-muted-foreground animate-fade-in">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs animate-pulse">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-medium">Loading your workspace…</span>
        </div>
      </div>
    );
  }

  return (
    <FeaturesProvider>
      <LowDataModeProvider>
      <DashboardShell
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      >
        {children}
      </DashboardShell>
      </LowDataModeProvider>
    </FeaturesProvider>
  );
}

/**
 * Inner shell — extracted so we can call hooks (useQueueAwareBeforeUnload)
 * that depend on providers higher in the tree without rule-of-hooks
 * issues. Phase 26.
 */
function DashboardShell({
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen,
  children,
}: {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  mobileOpen: boolean;
  setMobileOpen: React.Dispatch<React.SetStateAction<boolean>>;
  children: React.ReactNode;
}) {
  // Phase 26 — surface the browser "Leave site?" prompt only when
  // the offline queue has unsynced writes. No queue → no prompt
  // (regular refresh/close stays silent).
  useQueueAwareBeforeUnload();

  return (
    <>
      <ServiceWorkerRegister />
      <div className="flex h-screen w-full overflow-hidden bg-app">
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-foreground/30 backdrop-blur-sm md:hidden animate-fade-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggle={() => setCollapsed((v) => !v)}
          onMobileClose={() => setMobileOpen(false)}
        />

        <div className="flex flex-1 flex-col min-w-0">
          {/* Impersonation banner sits ABOVE the topbar so it's the
              first thing the operator sees on every page. Self-hides
              when no impersonation session is active. */}
          <ImpersonationBanner />
          {/* Phase 17 — maintenance-mode banner. Renders when the
              tenant has writes paused so users see the state before
              they try to save (and get a 503). Self-hides when off. */}
          <MaintenanceBanner />
          <Topbar onMobileMenuClick={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
              {/* Phase 26 — sticky offline / queue-pending banner.
                  Self-hides when online + no pending writes. */}
              <OfflineBanner />
              {/* Phase 23 — operator-published banners (release notes,
                  scheduled maintenance, etc). Self-hides when there
                  are none. Per-user dismissal via the X button. */}
              <AnnouncementBanner />
              {children}
            </div>
          </main>
        </div>
        {/* Phase 24 — universal Cmd+K palette + role-aware FAB.
            Both render once per dashboard mount; the palette is
            hidden until triggered. */}
        <CommandPalette />
        <QuickActionFab />
        {/* Phase performance governance — dev-only request pressure
            panel. Production builds short-circuit to null. */}
        <RequestPressurePanel />
      </div>
    </>
  );
}

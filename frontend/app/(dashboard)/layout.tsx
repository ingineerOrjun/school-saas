"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { ImpersonationBanner } from "@/components/impersonation/ImpersonationBanner";
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
          <Topbar onMobileMenuClick={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </FeaturesProvider>
  );
}

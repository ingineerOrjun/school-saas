"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { getToken } from "@/lib/auth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Desktop collapse — same behavior as before. Stays on > md screens.
  const [collapsed, setCollapsed] = React.useState(false);
  // Mobile drawer — only meaningful below md. Toggled by the hamburger
  // in the Topbar; auto-closes on every route change so the drawer
  // doesn't linger after the user taps a nav link.
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [authChecked, setAuthChecked] = React.useState(false);

  React.useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/login");
    } else {
      setAuthChecked(true);
    }
  }, [router]);

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
    <div className="flex h-screen w-full overflow-hidden bg-app">
      {/* Mobile-only backdrop. Tap anywhere outside the drawer to
          dismiss. Sits above the main content but below the drawer
          itself so the drawer's own taps don't bubble through. */}
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
        <Topbar onMobileMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          {/* Tighter padding on mobile (px-4) opens up another ~16px
              of horizontal real estate per side. Vertical padding stays
              modest (py-5 mobile, py-6 from sm up). */}
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

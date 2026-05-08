"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  CreditCard,
  LayoutDashboard,
  Layers,
  ShieldAlert,
  LogOut,
  ExternalLink,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredUser, getToken, logout } from "@/lib/auth";

// ---------------------------------------------------------------------------
// /platform — Platform Control Layer layout.
//
// This layout is INTENTIONALLY separate from the school dashboard
// layout in `app/(dashboard)`. The two surfaces have different
// audiences (school admins vs. platform owners), different data
// scopes (single tenant vs. cross-tenant), and different visual
// languages (school-themed vs. operational SaaS). Mixing them risks
// the kind of accidental privilege escalation the spec specifically
// calls out.
//
// Visual treatment:
//   • Slate base, no school accent colors. Reads as "operational
//     console" rather than "school dashboard".
//   • Persistent banner at the top says "Platform" so the operator
//     never forgets which surface they're on. Important during
//     impersonation (Phase 7) too — there'll need to be a clear
//     out-of-impersonation affordance, and a consistent header
//     anchor makes that easy to add later.
//
// Access gate:
//   Three-state guard:
//     1. No token → redirect to /login
//     2. Token but not SUPER_ADMIN → render an explicit "not
//        authorized" page (matches the analytics gate pattern)
//     3. SUPER_ADMIN → render the layout
//
// Backend enforces the same gate (every endpoint is
// `@Roles(SUPER_ADMIN)`) so this is UX, not security.
// ---------------------------------------------------------------------------

const NAV: Array<{
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  status?: "ready" | "soon";
}> = [
  { label: "Overview", href: "/platform", icon: LayoutDashboard, status: "ready" },
  { label: "Schools", href: "/platform/schools", icon: Building2, status: "ready" },
  // Phase 4 — subscriptions active. CreditCard icon picked over
  // a generic Building2 since the entry is now functional and the
  // icon should differentiate from the schools list.
  { label: "Subscriptions", href: "/platform/subscriptions", icon: CreditCard, status: "ready" },
  // Phase 8 — audit log active. Phase 9/10 still framed as
  // "Soon" so the platform owner sees the roadmap without clicking
  // through to dead routes.
  { label: "Audit logs", href: "/platform/audit", icon: ShieldAlert, status: "ready" },
  // Phase 5 — feature flags active. Layers icon picked over the
  // generic Building2 since the matrix UI renders as stacked
  // override / subscription / default tiers.
  { label: "Feature flags", href: "/platform/features", icon: Layers, status: "ready" },
];

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [accessChecked, setAccessChecked] = React.useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false);

  React.useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    const user = getStoredUser();
    setIsSuperAdmin(user?.role === "SUPER_ADMIN");
    setAccessChecked(true);
  }, [router]);

  if (!accessChecked) {
    // Brief loading flash — avoids rendering the gate for a
    // SUPER_ADMIN who's about to be allowed in.
    return <div className="min-h-screen bg-slate-50" />;
  }
  if (!isSuperAdmin) {
    return <PlatformAccessGate />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <PlatformTopbar />
      <div className="flex">
        <PlatformSidebar pathname={pathname ?? ""} />
        <main className="flex-1 px-6 py-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topbar — sits sticky at the top, signals "Platform" mode, gives a
// quick exit back to the school dashboard for operators who keep
// both open.
// ---------------------------------------------------------------------------

function PlatformTopbar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-slate-900 px-4 text-slate-50 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white">
          <ShieldAlert className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold leading-tight">
            Platform Control
          </p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            Owner Console
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-slate-100 hover:bg-white/10 transition-colors"
          title="Switch to the school dashboard"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          School view
        </Link>
        <button
          type="button"
          onClick={() => {
            logout();
            window.location.assign("/login");
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 text-xs font-medium text-slate-100 hover:bg-white/10 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          Sign out
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — fixed-width left rail. "Soon" entries stay visible (with
// muted styling + a chip) so the platform owner sees the roadmap
// without the disorientation of items appearing later.
// ---------------------------------------------------------------------------

function PlatformSidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white px-3 py-4 md:block">
      <nav>
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            // Treat "Overview" as active for the bare /platform path
            // since pathname.startsWith("/platform/overview") would
            // miss the bare path.
            const isActive =
              item.href === "/platform"
                ? pathname === "/platform"
                : pathname.startsWith(item.href);
            const isSoon = item.status === "soon";

            const content = (
              <>
                <Icon className="h-4 w-4" aria-hidden />
                <span className="flex-1">{item.label}</span>
                {isSoon && (
                  <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
                    Soon
                  </span>
                )}
              </>
            );

            return (
              <li key={item.href}>
                {isSoon ? (
                  <div
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-slate-400 cursor-not-allowed"
                    title="Coming in a future phase"
                  >
                    {content}
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-100",
                    )}
                  >
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Access gate — rendered when a non-SUPER_ADMIN reaches /platform.
// ---------------------------------------------------------------------------

function PlatformAccessGate() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <Lock className="h-6 w-6 text-slate-500" aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">
          Platform access required
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          The /platform area is restricted to platform owners. Your account
          does not have the required role.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
        >
          Back to school dashboard
        </Link>
      </div>
    </div>
  );
}

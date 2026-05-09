"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Briefcase,
  ChevronDown,
  GraduationCap,
  HelpCircle,
  LogOut,
  Menu,
  Monitor,
  Search,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getStoredUser,
  getStoredSchool,
  logout,
  type Role,
  type SafeUser,
  type SchoolSummary,
} from "@/lib/auth";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { CalendarToggle } from "@/components/calendar/CalendarToggle";
import { SessionSelector } from "@/components/academic-session/SessionSelector";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";
import { NotificationsBell } from "./NotificationsBell";

export interface TopbarProps {
  /**
   * Opens the mobile sidebar drawer. Wired from the parent layout
   * which owns the drawer's `mobileOpen` state.
   */
  onMobileMenuClick: () => void;
}

export function Topbar({ onMobileMenuClick }: TopbarProps) {
  const router = useRouter();
  const [user, setUser] = React.useState<SafeUser | null>(null);
  const [school, setSchool] = React.useState<SchoolSummary | null>(null);
  const [hydrated, setHydrated] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  // Read auth from localStorage on mount. Until then, `hydrated` is
  // false → the identity banner shows a skeleton instead of "…", which
  // matches the spec's fallback rule.
  React.useEffect(() => {
    setUser(getStoredUser());
    setSchool(getStoredSchool());
    setHydrated(true);
  }, []);

  // Dev-mode session breadcrumb. Fires once whenever the resolved
  // user changes — useful when debugging "which account am I on?"
  // tickets where two tabs got their localStorage crossed. Stripped
  // out of production bundles by the NODE_ENV check.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!user) return;
    // eslint-disable-next-line no-console
    console.log("[SESSION]", {
      name: displayNameFromEmail(user.email),
      email: user.email,
      role: user.role,
    });
  }, [user]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const handleLogout = async () => {
    // Phase 17 follow-up — `logout()` now revokes the server-side
    // session row before clearing local state. Awaited so the
    // success toast doesn't fire before the request settles.
    await logout();
    toast.success("Signed out");
    router.replace("/login");
  };

  const initials = user ? initialsFromEmail(user.email) : "??";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 sm:gap-4 border-b border-border bg-surface/80 backdrop-blur-md px-3 sm:px-6">
      {/* Hamburger — mobile only. */}
      <button
        type="button"
        onClick={onMobileMenuClick}
        aria-label="Open navigation menu"
        className="md:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>

      {/* Search — hidden below sm so the topbar stays single-row. */}
      <div className="relative hidden sm:block flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search students, classes, invoices…"
          className={cn(
            "h-9 w-full rounded-md border border-border bg-muted/40 pl-9 pr-14 text-sm",
            "placeholder:text-muted-foreground/80",
            "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary focus:bg-surface",
            "transition-colors",
          )}
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-0.5 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-xs">
          ⌘K
        </kbd>
      </div>

      {/* Spacer on mobile so the user cluster pushes right. */}
      <div className="flex-1 sm:hidden" />

      {/* Help / session / calendar / theme / notifications.
          The SyncStatusBadge sits at the front of this cluster so a
          teacher noticing they're offline mid-roll-call sees it
          before scanning the rest of the topbar. The badge also
          mounts the sync engine lifecycle (mount + online event +
          30s poll) for the entire dashboard tree. */}
      <div className="flex items-center gap-1">
        <SyncStatusBadge />
        <span className="hidden sm:inline-flex">
          <SessionSelector />
        </span>
        <IconButton label="Help" className="hidden sm:inline-flex">
          <HelpCircle className="h-[18px] w-[18px]" />
        </IconButton>
        <span className="hidden sm:inline-flex">
          <CalendarToggle />
        </span>
        <ThemeToggle />
        <NotificationsBell />
      </div>

      {/* Divider — separates utility actions from the identity cluster. */}
      <div className="hidden sm:block mx-2 h-6 w-px bg-border" />

      {/* ---------------- Session Identity Banner ---------------- */}
      {/*
        Spec'd in the "Session Identity Banner" task — the topbar's
        right-edge cluster ALWAYS shows who's logged in:
          • avatar + name (with role-coded pill on the same line)
          • email on the line below
        Replaces the old "name / role-text" two-line layout AND the
        standalone role pill that used to sit among the action icons
        (which was duplicating the same info, just less prominently).
        Skeleton placeholder until localStorage hydration completes.
      */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-muted transition-colors focus-ring"
          aria-label="Open account menu"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-700 text-xs font-semibold text-primary-foreground shadow-xs">
            {initials}
          </div>
          <IdentityBanner user={user} hydrated={hydrated} />
          <ChevronDown className="hidden sm:block h-4 w-4 text-muted-foreground" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-2 w-64 origin-top-right glass rounded-lg p-1 shadow-xl animate-scale-in">
            <div className="px-3 py-2.5 border-b border-border/50 space-y-1.5">
              {/* Mobile-only identity strip — same Name + Role + Email
                  the desktop banner shows, surfaced inside the menu so
                  small-screen users still see the full identity once
                  they tap the avatar. */}
              <div className="sm:hidden">
                <p className="text-sm font-medium text-foreground truncate">
                  {user ? displayNameFromEmail(user.email) : "—"}
                </p>
                {user && (
                  <div className="mt-1">
                    <RoleBadge role={user.role} />
                  </div>
                )}
              </div>
              <p className="text-sm font-medium text-foreground truncate">
                {user?.email ?? "—"}
              </p>
              {school && (
                <p className="text-xs text-muted-foreground truncate">
                  {school.name}
                </p>
              )}
            </div>
            {/* Phase 17 follow-up — Devices link is available to ALL
                roles (not gated like Settings) since it's per-user
                self-management. Closes the menu on click. */}
            <Link
              href="/settings/devices"
              onClick={() => setMenuOpen(false)}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors focus-ring"
            >
              <Monitor className="h-4 w-4" />
              Active devices
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-destructive/10 hover:text-destructive transition-colors focus-ring"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Identity banner + role badge
// ---------------------------------------------------------------------------

/**
 * Two-line cluster shown next to the avatar: name + role pill on top,
 * email below. The whole banner is hidden on mobile (`hidden sm:flex`)
 * — small screens fall back to the avatar-only view, with the full
 * identity available inside the dropdown menu.
 *
 * `hydrated` is the gate that distinguishes "we haven't read
 * localStorage yet" from "we read it and there's no user". The first
 * case shows skeletons; the second hides the banner entirely so the
 * topbar collapses cleanly.
 */
function IdentityBanner({
  user,
  hydrated,
}: {
  user: SafeUser | null;
  hydrated: boolean;
}) {
  if (!hydrated) {
    return (
      <div className="hidden sm:flex flex-col gap-1 leading-tight">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-36" />
      </div>
    );
  }
  if (!user) {
    // Hydrated but no user — the layout's auth gate should have
    // redirected to /login already; render nothing rather than show
    // empty placeholders.
    return null;
  }

  return (
    <div className="hidden sm:flex flex-col items-start leading-tight max-w-[220px]">
      <div className="flex items-center gap-1.5 w-full">
        <span className="text-sm font-medium text-foreground truncate">
          {displayNameFromEmail(user.email)}
        </span>
        <RoleBadge role={user.role} />
      </div>
      <span className="text-xs text-muted-foreground truncate w-full text-left">
        {user.email}
      </span>
    </div>
  );
}

interface RoleStyle {
  icon: React.ComponentType<{ className?: string }>;
  bg: string;
  text: string;
  ring: string;
  label: string;
}

/**
 * Role → color/icon/label mapping. Centralized so any future surface
 * (admin tools, audit log, etc.) can render the same pill consistently.
 *
 *   • ADMIN   → indigo + shield  (privilege)
 *   • STAFF   → amber  + briefcase (mid-level academic)
 *   • TEACHER → slate  + graduation-cap
 *   • STUDENT / PARENT fall back to a neutral pill so unmapped roles
 *     don't crash the banner.
 */
const ROLE_STYLES: Record<Role, RoleStyle> = {
  // SUPER_ADMIN normally renders /platform's own banner, not this
  // topbar — they're scoped to the school dashboard only when
  // they've explicitly switched to "School view". The slate-900 chip
  // makes that switch unmistakable.
  SUPER_ADMIN: {
    icon: ShieldCheck,
    bg: "bg-slate-900",
    text: "text-white",
    ring: "ring-slate-800",
    label: "PLATFORM",
  },
  ADMIN: {
    icon: ShieldCheck,
    bg: "bg-indigo-50 dark:bg-indigo-500/15",
    text: "text-indigo-700 dark:text-indigo-300",
    ring: "ring-indigo-200 dark:ring-indigo-500/30",
    label: "ADMIN",
  },
  STAFF: {
    icon: Briefcase,
    bg: "bg-amber-50 dark:bg-amber-500/15",
    text: "text-amber-800 dark:text-amber-300",
    ring: "ring-amber-200 dark:ring-amber-500/30",
    label: "STAFF",
  },
  TEACHER: {
    icon: GraduationCap,
    bg: "bg-slate-100 dark:bg-slate-500/20",
    text: "text-slate-700 dark:text-slate-200",
    ring: "ring-slate-200 dark:ring-slate-500/30",
    label: "TEACHER",
  },
  STUDENT: {
    icon: UserIcon,
    bg: "bg-muted",
    text: "text-muted-foreground",
    ring: "ring-border",
    label: "STUDENT",
  },
  PARENT: {
    icon: UserIcon,
    bg: "bg-muted",
    text: "text-muted-foreground",
    ring: "ring-border",
    label: "PARENT",
  },
};

function RoleBadge({ role }: { role: Role }) {
  const style = ROLE_STYLES[role] ?? ROLE_STYLES.TEACHER;
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
        style.bg,
        style.text,
        style.ring,
      )}
      aria-label={`Role: ${style.label}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {style.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function IconButton({
  children,
  label,
  className,
}: {
  children: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (local.slice(0, 2) || "??").toUpperCase();
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}

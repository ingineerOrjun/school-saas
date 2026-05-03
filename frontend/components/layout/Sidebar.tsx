"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  Wallet,
  Megaphone,
  Settings,
  ChevronsLeft,
  PanelLeftOpen,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredUser, type Role } from "@/lib/auth";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** When set, the link is hidden unless the user has one of these roles. */
  requiresRole?: Role[];
};

const primary: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Students", href: "/students", icon: Users },
  // Teachers + Classes are admin-config surfaces — STAFF doesn't
  // manage either of them per the role spec.
  { label: "Teachers", href: "/teachers", icon: GraduationCap, requiresRole: ["ADMIN"] },
  { label: "Classes", href: "/classes", icon: BookOpen, requiresRole: ["ADMIN"] },
  // Subjects: shared admin/staff academic catalog. Hidden from teachers
  // since they can't write here and the dropdowns where they'd consume
  // it (assignment dialog) aren't theirs to use either.
  { label: "Subjects", href: "/subjects", icon: BookOpen, requiresRole: ["ADMIN", "STAFF"] },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck },
  { label: "Exams", href: "/exams", icon: ClipboardList },
  // Fees + receipts are financial — admin-only per the role spec.
  { label: "Fees", href: "/fees", icon: Wallet, requiresRole: ["ADMIN"] },
  { label: "Announcements", href: "/announcements", icon: Megaphone },
];

const secondary: NavItem[] = [
  // Settings is admin-only — RolesGuard rejects non-admin requests
  // server-side; this just hides the link client-side so teachers
  // never see a 403 page they can't act on.
  { label: "Settings", href: "/settings", icon: Settings, requiresRole: ["ADMIN"] },
];

interface SidebarProps {
  /**
   * Desktop-only collapse toggle. Reduces the sidebar to a 68px icon
   * rail. Has no effect below the `md` breakpoint — at that size the
   * sidebar is always full-width when open as a drawer.
   */
  collapsed: boolean;
  /**
   * Mobile-only drawer state. When true the sidebar slides in from
   * the left with a backdrop. When false it's translated off-screen.
   * Ignored above `md` where the sidebar is always in-flow.
   */
  mobileOpen: boolean;
  /** Toggles `collapsed`. Visible only on the desktop layout. */
  onToggle: () => void;
  /** Closes the mobile drawer (X button + parent's backdrop tap). */
  onMobileClose: () => void;
}

/**
 * Dual-mode navigation sidebar.
 *
 *   • >= md   → in-flow flex child, 68/248px wide, collapse toggle.
 *   • <  md   → off-canvas drawer (fixed, 280px), slides in/out via
 *               `mobileOpen`. Collapse is meaningless here so the
 *               full label set is always shown.
 *
 * The same component handles both modes; Tailwind's responsive
 * prefixes (`md:relative` etc.) flip the positioning + width without
 * a JS branch.
 */
export function Sidebar({
  collapsed,
  mobileOpen,
  onToggle,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  // Read the role from localStorage on mount. Until then the role is
  // null and role-gated links don't render — that prevents a flash of
  // admin links for non-admins on first paint.
  const [role, setRole] = React.useState<Role | null>(null);
  React.useEffect(() => {
    setRole(getStoredUser()?.role ?? null);
  }, []);

  // Same role-gating rule for primary + secondary nav. Items without
  // `requiresRole` are visible to everyone; items with one are shown
  // only when the cached role matches. Admin sees everything.
  const matchesRole = (item: NavItem) =>
    !item.requiresRole || (role !== null && item.requiresRole.includes(role));
  const visiblePrimary = primary.filter(matchesRole);
  const visibleSecondary = secondary.filter(matchesRole);

  // On mobile the drawer ignores `collapsed` (always full labels).
  // Use this derived flag inside render branches that depend on
  // collapse-only behavior — keeps the JSX easy to read.
  const showCollapsed = collapsed; // desktop reads this; mobile ignores via classes

  return (
    <aside
      className={cn(
        // ---------- Mobile (< md): fixed off-canvas drawer ----------
        "fixed inset-y-0 left-0 z-40 flex flex-col w-[280px] border-r border-border bg-surface shadow-xl",
        "transition-transform duration-300 ease-out",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        // ---------- Desktop (>= md): in-flow flex child ----------
        // `md:relative` removes the fixed positioning; `md:translate-x-0`
        // wins over the mobile toggle classes; `md:shadow-none` strips
        // the drawer shadow that only makes sense over a backdrop.
        "md:relative md:translate-x-0 md:shadow-none md:shrink-0",
        "md:transition-[width]",
        showCollapsed ? "md:w-[68px]" : "md:w-[248px]",
      )}
      aria-label="Primary navigation"
    >
      {/* Brand row. Mobile gets a close (X) button on the right since
          there's no other always-visible way to dismiss the drawer
          (the backdrop tap is the other path). Desktop keeps the
          original brand-only header. */}
      <div
        className={cn(
          "flex items-center h-16 px-4 border-b border-border",
          showCollapsed && "md:justify-center md:px-0",
        )}
      >
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 focus-ring rounded-md flex-1 min-w-0"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </div>
          {/* On mobile we always show the brand label since the drawer
              is always full-width. On desktop we hide it when collapsed. */}
          <span
            className={cn(
              "text-md font-semibold tracking-tight text-foreground truncate",
              showCollapsed && "md:hidden",
            )}
          >
            Scholaris
          </span>
        </Link>
        {/* Mobile-only close button — desktop has the bottom Collapse
            toggle, mobile gets a clearer dismiss affordance up top. */}
        <button
          type="button"
          onClick={onMobileClose}
          aria-label="Close navigation"
          className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {/* Section labels hide when desktop is collapsed; on mobile the
            drawer is always full-width so they always render there. */}
        <p
          className={cn(
            "px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
            showCollapsed && "md:hidden",
          )}
        >
          Workspace
        </p>
        <ul className="flex flex-col gap-0.5">
          {visiblePrimary.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              showCollapsed={showCollapsed}
            />
          ))}
        </ul>

        {visibleSecondary.length > 0 && (
          <>
            <div className="my-4 h-px bg-border" />
            <p
              className={cn(
                "px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                showCollapsed && "md:hidden",
              )}
            >
              System
            </p>
            <ul className="flex flex-col gap-0.5">
              {visibleSecondary.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  showCollapsed={showCollapsed}
                />
              ))}
            </ul>
          </>
        )}
      </nav>

      {/* Footer / collapse toggle — DESKTOP ONLY. On mobile the close
          button up top + the backdrop tap cover dismissal; the collapse
          toggle has no meaning at drawer scale. */}
      <div
        className={cn(
          "hidden md:block border-t border-border p-3",
          showCollapsed && "md:flex md:justify-center",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={showCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "inline-flex items-center gap-2 rounded-md text-sm font-medium text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors focus-ring",
            showCollapsed ? "h-9 w-9 justify-center" : "h-9 w-full px-3",
          )}
        >
          {showCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({
  item,
  active,
  showCollapsed,
}: {
  item: NavItem;
  active: boolean;
  /**
   * Desktop collapse mode. On mobile (< md) we always render the full
   * row — `md:` prefixed classes flip behavior at the breakpoint so
   * one render covers both modes.
   */
  showCollapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        title={showCollapsed ? item.label : undefined}
        className={cn(
          "group flex items-center gap-2.5 rounded-md text-sm font-medium transition-all duration-150 focus-ring",
          "h-9 px-2.5", // mobile: always the full row
          // Desktop collapse: square icon button centered.
          showCollapsed && "md:h-9 md:w-9 md:mx-auto md:justify-center md:px-0",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
      >
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-colors",
            active
              ? "text-primary"
              : "text-muted-foreground group-hover:text-foreground",
          )}
          strokeWidth={active ? 2.25 : 2}
        />
        {/* Always show the label on mobile (drawer is full-width).
            Hide on desktop when collapsed. */}
        <span className={cn("truncate", showCollapsed && "md:hidden")}>
          {item.label}
        </span>
      </Link>
    </li>
  );
}

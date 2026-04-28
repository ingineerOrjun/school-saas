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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getStoredUser, type Role } from "@/lib/auth";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When set, the link is hidden unless the user has one of these roles. */
  requiresRole?: Role[];
};

const primary: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Students", href: "/students", icon: Users },
  { label: "Teachers", href: "/teachers", icon: GraduationCap },
  { label: "Classes", href: "/classes", icon: BookOpen },
  { label: "Attendance", href: "/attendance", icon: CalendarCheck },
  { label: "Exams", href: "/exams", icon: ClipboardList },
  { label: "Fees", href: "/fees", icon: Wallet },
  { label: "Announcements", href: "/announcements", icon: Megaphone },
];

const secondary: NavItem[] = [
  // Settings is admin-only — RolesGuard rejects non-admin requests
  // server-side; this just hides the link client-side so teachers
  // never see a 403 page they can't act on.
  { label: "Settings", href: "/settings", icon: Settings, requiresRole: ["ADMIN"] },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  // Read the role from localStorage on mount. Until then the role is
  // null and role-gated links don't render — that prevents a flash of
  // admin links for non-admins on first paint.
  const [role, setRole] = React.useState<Role | null>(null);
  React.useEffect(() => {
    setRole(getStoredUser()?.role ?? null);
  }, []);

  const visibleSecondary = secondary.filter(
    (item) => !item.requiresRole || (role && item.requiresRole.includes(role)),
  );

  return (
    <aside
      className={cn(
        "relative flex flex-col shrink-0 border-r border-border bg-surface",
        "transition-[width] duration-300 ease-out",
        collapsed ? "w-[68px]" : "w-[248px]",
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex items-center h-16 px-4 border-b border-border",
          collapsed && "justify-center px-0",
        )}
      >
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 focus-ring rounded-md"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <span className="text-md font-semibold tracking-tight text-foreground">
              Scholaris
            </span>
          )}
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {!collapsed && (
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </p>
        )}
        <ul className="flex flex-col gap-0.5">
          {primary.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              collapsed={collapsed}
            />
          ))}
        </ul>

        {visibleSecondary.length > 0 && (
          <>
            <div className="my-4 h-px bg-border" />
            {!collapsed && (
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                System
              </p>
            )}
          </>
        )}
        {visibleSecondary.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {visibleSecondary.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                collapsed={collapsed}
              />
            ))}
          </ul>
        )}
      </nav>

      {/* Footer / collapse toggle */}
      <div
        className={cn(
          "border-t border-border p-3",
          collapsed && "flex justify-center",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "inline-flex items-center gap-2 rounded-md text-sm font-medium text-muted-foreground",
            "hover:bg-muted hover:text-foreground transition-colors focus-ring",
            collapsed ? "h-9 w-9 justify-center" : "h-9 w-full px-3",
          )}
        >
          {collapsed ? (
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
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          "group flex items-center gap-2.5 rounded-md text-sm font-medium transition-all duration-150 focus-ring",
          collapsed ? "h-9 w-9 mx-auto justify-center" : "h-9 px-2.5",
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
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    </li>
  );
}

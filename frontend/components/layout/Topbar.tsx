"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Search, HelpCircle, ChevronDown, LogOut } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getStoredUser,
  getStoredSchool,
  logout,
  type SafeUser,
  type SchoolSummary,
} from "@/lib/auth";

export function Topbar() {
  const router = useRouter();
  const [user, setUser] = React.useState<SafeUser | null>(null);
  const [school, setSchool] = React.useState<SchoolSummary | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setUser(getStoredUser());
    setSchool(getStoredSchool());
  }, []);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const handleLogout = () => {
    logout();
    toast.success("Signed out");
    router.replace("/login");
  };

  const initials = user ? initialsFromEmail(user.email) : "??";
  const displayName = user ? displayNameFromEmail(user.email) : "…";
  const roleLabel = user ? formatRole(user.role) : "";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-surface/80 backdrop-blur-md px-6">
      {/* Search */}
      <div className="relative flex-1 max-w-md">
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

      <div className="flex items-center gap-1">
        <IconButton label="Help">
          <HelpCircle className="h-[18px] w-[18px]" />
        </IconButton>
        <IconButton label="Notifications">
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-destructive ring-2 ring-surface" />
        </IconButton>
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      {/* User menu */}
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-muted transition-colors focus-ring"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-700 text-xs font-semibold text-primary-foreground shadow-xs">
            {initials}
          </div>
          <div className="hidden sm:flex flex-col items-start leading-tight">
            <span className="text-sm font-medium text-foreground">
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground">{roleLabel}</span>
          </div>
          <ChevronDown className="hidden sm:block h-4 w-4 text-muted-foreground" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-2 w-64 origin-top-right glass rounded-lg p-1 shadow-xl animate-scale-in">
            <div className="px-3 py-2.5 border-b border-border/50">
              <p className="text-sm font-medium text-foreground truncate">
                {user?.email ?? "—"}
              </p>
              {school && (
                <p className="mt-0.5 text-xs text-muted-foreground truncate">
                  {school.name}
                </p>
              )}
            </div>
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

function IconButton({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
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

function formatRole(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

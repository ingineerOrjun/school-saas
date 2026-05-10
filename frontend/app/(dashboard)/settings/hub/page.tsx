"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bell,
  Building2,
  CreditCard,
  Database,
  Mail,
  Palette,
  Rocket,
  Search,
  ShieldCheck,
  Smartphone,
  Users as UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /settings/hub — Phase 24 Section 12.
//
// Categorized launchpad for every settings surface. Replaces the
// "scroll a 600-line megapage to find the toggle you want" flow with
// a 6-card grid + an in-page search.
//
// The existing /settings page (school profile + subjects + users)
// stays as-is for now under the "School" card — a future refactor
// breaks it apart fully. This hub is the navigation entry; nothing
// underneath is rewired in this phase.
//
// In-page search:
//   Type to filter cards by label or keyword. Matches are case-
//   insensitive contains. Empty input shows everything.
// ---------------------------------------------------------------------------

interface SettingsCard {
  id: string;
  category: string;
  label: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  keywords: string[];
}

const CARDS: SettingsCard[] = [
  {
    id: "school",
    category: "School",
    label: "School profile",
    description: "Name, logo, address, phone, principal, subjects, users.",
    href: "/settings",
    icon: <Building2 className="h-4 w-4" />,
    keywords: ["profile", "logo", "subjects", "users", "principal"],
  },
  {
    id: "academic",
    category: "Academic",
    label: "Academic sessions",
    description: "Terms, calendars, current-session selection.",
    href: "/settings",
    icon: <Building2 className="h-4 w-4" />,
    keywords: ["session", "term", "year", "calendar"],
  },
  {
    id: "branding",
    category: "Branding",
    label: "Branding",
    description: "Colors, slogan, receipt footer. Tenant-customizable.",
    href: "/settings/branding",
    icon: <Palette className="h-4 w-4" />,
    keywords: ["theme", "logo", "color", "white-label"],
  },
  {
    id: "invitations",
    category: "Staff",
    label: "Invitations",
    description: "Invite teachers and admins via email link.",
    href: "/settings/invitations",
    icon: <Mail className="h-4 w-4" />,
    keywords: ["invite", "staff", "teacher", "admin", "onboarding"],
  },
  {
    id: "onboarding",
    category: "Setup",
    label: "Onboarding wizard",
    description: "Resumable first-run setup checklist.",
    href: "/onboarding",
    icon: <Rocket className="h-4 w-4" />,
    keywords: ["setup", "wizard", "getting started", "checklist"],
  },
  {
    id: "sessions",
    category: "Security",
    label: "My sessions",
    description: "Active devices, revoke individual sessions.",
    href: "/settings/sessions",
    icon: <ShieldCheck className="h-4 w-4" />,
    keywords: ["security", "devices", "logout", "revoke"],
  },
  {
    id: "devices",
    category: "Security",
    label: "Devices",
    description: "Per-device sync state, last-sync diagnostics.",
    href: "/settings/devices",
    icon: <Smartphone className="h-4 w-4" />,
    keywords: ["sync", "offline", "devices"],
  },
  {
    id: "offline",
    category: "Sync",
    label: "Offline queue",
    description: "Pending writes, sync history.",
    href: "/settings/offline",
    icon: <Database className="h-4 w-4" />,
    keywords: ["offline", "sync", "queue", "drafts"],
  },
  {
    id: "billing",
    category: "Billing",
    label: "Subscription & billing",
    description: "Current plan, renewal date, invoice history. Coming soon.",
    href: "/settings",
    icon: <CreditCard className="h-4 w-4" />,
    keywords: ["plan", "billing", "subscription", "invoice", "renewal"],
  },
  {
    id: "notifications",
    category: "Notifications",
    label: "Notification preferences",
    description: "Channels, frequency, severity filters. Coming soon.",
    href: "/notifications",
    icon: <Bell className="h-4 w-4" />,
    keywords: ["notify", "alerts", "email", "in-app", "preferences"],
  },
  {
    id: "guardians",
    category: "Family",
    label: "Guardians",
    description: "Parent / guardian directory and student linking.",
    href: "/students",
    icon: <UsersIcon className="h-4 w-4" />,
    keywords: ["parent", "family", "contact", "guardian"],
  },
];

export default function SettingsHubPage() {
  const [query, setQuery] = React.useState("");
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return CARDS;
    return CARDS.filter((c) => {
      if (c.label.toLowerCase().includes(q)) return true;
      if (c.description.toLowerCase().includes(q)) return true;
      if (c.category.toLowerCase().includes(q)) return true;
      if (c.keywords.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query]);

  // Group by category for the visual grid.
  const groups = React.useMemo(() => {
    const map = new Map<string, SettingsCard[]>();
    for (const c of filtered) {
      const existing = map.get(c.category) ?? [];
      existing.push(c);
      map.set(c.category, existing);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Settings
        </p>
        <h1 className="text-2xl font-semibold mt-1">Settings hub</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every place you can configure your school, in one search.
        </p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings…"
          autoFocus
          className="w-full h-10 pl-9 pr-3 rounded-md border border-input bg-card text-sm"
        />
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-sm font-semibold">No matches</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a different keyword or clear the search.
          </p>
        </div>
      ) : (
        groups.map(([category, cards]) => (
          <section key={category}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              {category}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {cards.map((card) => (
                <Link
                  key={card.id}
                  href={card.href}
                  className={cn(
                    "rounded-xl border bg-card p-4 transition-colors",
                    "hover:border-primary/40 hover:bg-primary/[0.02]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                      {card.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {card.label}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                        {card.description}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

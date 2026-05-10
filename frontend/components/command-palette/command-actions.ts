import type { Role } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Command action registry (Phase 24 Section 1).
//
// Static list of "things you can do" surfaced in the Cmd+K palette
// when the search is empty (or no results match). Each action is
// role-aware — TEACHERS see "take attendance" but not "add student";
// CASHIERS see "collect payment" but not "create exam".
//
// Actions are href-based so opening one is just a navigate. A future
// extension could add a `run()` callback for in-place actions
// (e.g. "toggle dark mode") — keep the type extensible.
// ---------------------------------------------------------------------------

export interface CommandAction {
  /** Stable id — used for recents tracking. */
  id: string;
  /** Primary label in the palette. */
  label: string;
  /** Secondary line — shorter description / shortcut hint. */
  hint?: string;
  /** Where to navigate when picked. */
  href: string;
  /** Lucide icon name (string, resolved by the palette). */
  icon?: string;
  /** Roles that can see this action. Empty = all. */
  roles?: Role[];
  /** Free-text keywords that match against typed input. */
  keywords?: string[];
  /** Group label for visual organisation. */
  group: "navigation" | "create" | "workflow" | "settings";
}

export const COMMAND_ACTIONS: CommandAction[] = [
  // ---- Workflow shortcuts (top of the palette when empty) ----
  {
    id: "wf.take-attendance",
    label: "Take attendance",
    hint: "Mark today's class roster",
    href: "/attendance",
    icon: "ClipboardCheck",
    roles: ["ADMIN", "TEACHER"],
    keywords: ["attend", "roster", "present"],
    group: "workflow",
  },
  {
    id: "wf.collect-payment",
    label: "Collect payment",
    hint: "Record a fee receipt",
    href: "/fees/collect",
    icon: "Wallet",
    roles: ["ADMIN"],
    keywords: ["fee", "pay", "receipt", "cashier"],
    group: "workflow",
  },
  {
    id: "wf.add-student",
    label: "Add student",
    href: "/students?new=true",
    icon: "UserPlus",
    roles: ["ADMIN"],
    keywords: ["enrol", "admission", "new"],
    group: "workflow",
  },
  {
    id: "wf.create-exam",
    label: "Create exam",
    href: "/exams?new=true",
    icon: "FileText",
    roles: ["ADMIN", "TEACHER"],
    keywords: ["test", "assessment"],
    group: "workflow",
  },

  // ---- Navigation ----
  {
    id: "nav.dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "LayoutDashboard",
    keywords: ["home", "overview"],
    group: "navigation",
  },
  {
    id: "nav.students",
    label: "Students",
    href: "/students",
    icon: "Users",
    keywords: ["roster", "enrolment"],
    group: "navigation",
  },
  {
    id: "nav.teachers",
    label: "Teachers",
    href: "/teachers",
    icon: "GraduationCap",
    roles: ["ADMIN"],
    group: "navigation",
  },
  {
    id: "nav.classes",
    label: "Classes",
    href: "/classes",
    icon: "Layers",
    keywords: ["sections", "grades"],
    group: "navigation",
  },
  {
    id: "nav.attendance",
    label: "Attendance",
    href: "/attendance",
    icon: "ClipboardCheck",
    group: "navigation",
  },
  {
    id: "nav.fees",
    label: "Fees",
    href: "/fees",
    icon: "Wallet",
    roles: ["ADMIN"],
    keywords: ["payments", "receipts"],
    group: "navigation",
  },
  {
    id: "nav.exams",
    label: "Exams",
    href: "/exams",
    icon: "FileText",
    keywords: ["tests", "results"],
    group: "navigation",
  },
  {
    id: "nav.notifications",
    label: "Notifications",
    href: "/notifications",
    icon: "Bell",
    group: "navigation",
  },
  {
    id: "nav.announcements",
    label: "Announcements",
    href: "/announcements",
    icon: "Megaphone",
    roles: ["ADMIN", "TEACHER"],
    group: "navigation",
  },

  // ---- Settings ----
  {
    id: "settings.school",
    label: "School profile",
    href: "/settings",
    icon: "School2",
    roles: ["ADMIN"],
    group: "settings",
  },
  {
    id: "settings.branding",
    label: "Branding",
    href: "/settings/branding",
    icon: "Palette",
    roles: ["ADMIN"],
    keywords: ["theme", "colors", "logo"],
    group: "settings",
  },
  {
    id: "settings.invitations",
    label: "Staff invitations",
    href: "/settings/invitations",
    icon: "Mail",
    roles: ["ADMIN"],
    keywords: ["invite", "teacher", "admin"],
    group: "settings",
  },
  {
    id: "settings.sessions",
    label: "My sessions",
    href: "/settings/sessions",
    icon: "ShieldCheck",
    keywords: ["devices", "logout"],
    group: "settings",
  },
  {
    id: "settings.onboarding",
    label: "Onboarding wizard",
    href: "/onboarding",
    icon: "Rocket",
    roles: ["ADMIN"],
    group: "settings",
  },
];

/**
 * Filter the registry by user role. Actions with no `roles` array
 * are visible to everyone.
 */
export function actionsForRole(role: Role): CommandAction[] {
  return COMMAND_ACTIONS.filter(
    (a) => !a.roles || a.roles.length === 0 || a.roles.includes(role),
  );
}

/**
 * Lightweight fuzzy matcher — checks label + keywords for the query
 * tokens. Returns a score (higher is better) or 0 for no match.
 */
export function scoreAction(action: CommandAction, q: string): number {
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return 1; // empty query lists everything
  const haystack = [
    action.label.toLowerCase(),
    action.hint?.toLowerCase() ?? "",
    ...(action.keywords ?? []).map((k) => k.toLowerCase()),
  ];
  let best = 0;
  for (const h of haystack) {
    if (h === needle) {
      best = Math.max(best, 100);
    } else if (h.startsWith(needle)) {
      best = Math.max(best, 70);
    } else if (h.includes(needle)) {
      best = Math.max(best, 40);
    }
  }
  return best;
}

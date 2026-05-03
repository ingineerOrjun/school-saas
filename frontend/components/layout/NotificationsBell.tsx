"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bell,
  CalendarCheck,
  ClipboardList,
  Loader2,
  Megaphone,
  UserPlus,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  announcementsApi,
  type AnnouncementDto,
} from "@/lib/announcements";
import { getStoredUser, type Role } from "@/lib/auth";
import { dashboardApi } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

/**
 * Notification bell — opens a dropdown panel of recent activity
 * MERGED from data sources we already have. No new backend.
 *
 * Sources (keep this in sync with the comment in `loadFeed`):
 *   • Announcements         — `GET /announcements` (everyone)
 *   • New enrollments       — `recentStudents` from /dashboard/summary
 *                             (admin-only — the endpoint is admin-scope-friendly)
 *   • Pending teacher tasks — `pending` from /dashboard/teacher-summary
 *                             (teacher-only — surfaces "attendance not
 *                             marked today" + "exams without results")
 *
 * NOT included (intentionally — would require new backend):
 *   • Recent payments       — `/payments` is per-student, no school-wide feed
 *   • Recent attendance     — only roster + report endpoints exist
 *
 * Items get a uniform shape, are merged into one list, sorted DESC by
 * timestamp, and capped at MAX_ITEMS. The unread dot fires when the
 * newest item is from the last 24h.
 */

interface FeedItem {
  /** Stable key for React list rendering. */
  id: string;
  type: "announcement" | "enrollment" | "todo";
  title: string;
  description: string;
  /**
   * ISO timestamp used to sort the merged list. For "todo" items this
   * is the time the dashboard was generated — they always pin to the
   * top of the feed because they represent live state, not history.
   */
  timestamp: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Tint key — small palette so each row's icon pill reads as one of
   * a known set of categories at a glance.
   */
  tint: "primary" | "emerald" | "amber" | "sky";
}

const MAX_ITEMS = 8;
/** "Recent" = within the last 24h. Drives the unread dot. */
const UNREAD_WINDOW_MS = 24 * 60 * 60 * 1000;

export function NotificationsBell() {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<FeedItem[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [hasFetched, setHasFetched] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Role gates which dashboard endpoint we call. Read once on mount —
  // role doesn't change at runtime.
  const [role, setRole] = React.useState<Role | null>(null);
  React.useEffect(() => {
    setRole(getStoredUser()?.role ?? null);
  }, []);

  // Outside-click + Escape to close — same pattern as the user menu
  // and theme toggle in this Topbar.
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /**
   * Fetch + merge the feed. Called on first open, then once per open
   * after that — the data turnover is slow enough that "refresh on
   * every open" feels live without hammering the API.
   */
  const loadFeed = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch in parallel. Each source is wrapped so a single failure
      // (e.g. teacher hitting the admin summary) doesn't tank the
      // whole feed — the bell should always show SOMETHING useful.
      const announcementsP = announcementsApi.list().catch((err) => {
        if (err instanceof ApiError && err.status === 401) throw err;
        return [] as AnnouncementDto[];
      });

      // Pick ONE dashboard endpoint based on role; calling the wrong
      // one returns 403 and we'd silently swallow that anyway.
      const dashboardP =
        role === "TEACHER"
          ? dashboardApi.getTeacherSummary().then((s) => ({
              kind: "teacher" as const,
              data: s,
            }))
          : dashboardApi.getSummary().then((s) => ({
              kind: "admin" as const,
              data: s,
            }));

      const [announcements, dashboard] = await Promise.all([
        announcementsP,
        dashboardP.catch(() => null),
      ]);

      const merged: FeedItem[] = [];

      // ----- Announcements -----
      for (const a of announcements.slice(0, MAX_ITEMS)) {
        merged.push({
          id: `ann:${a.id}`,
          type: "announcement",
          title: a.title,
          description: a.message.slice(0, 120),
          timestamp: a.createdAt,
          href: "/announcements",
          icon: Megaphone,
          tint: "primary",
        });
      }

      // ----- Dashboard-derived items -----
      if (dashboard?.kind === "admin") {
        // Recent enrollments → "New student" feed items.
        for (const s of dashboard.data.recentStudents.slice(0, 5)) {
          const where = s.sectionName
            ? `${s.className ?? "Unassigned"} · ${s.sectionName}`
            : s.className ?? "Unassigned";
          merged.push({
            id: `enroll:${s.id}`,
            type: "enrollment",
            title: `${s.firstName} ${s.lastName} enrolled`,
            description: where,
            timestamp: s.createdAt,
            href: "/students",
            icon: UserPlus,
            tint: "emerald",
          });
        }
      } else if (dashboard?.kind === "teacher") {
        // Pending tasks rendered as "todo" items — they pin to the
        // top via the generatedAt timestamp because they represent
        // live state the teacher needs to act on.
        const ts = dashboard.data.generatedAt;
        if (dashboard.data.pending.attendanceNotMarkedToday) {
          merged.push({
            id: "todo:attendance-today",
            type: "todo",
            title: "Mark today's attendance",
            description: "Today's roster hasn't been marked yet.",
            timestamp: ts,
            href: "/attendance",
            icon: CalendarCheck,
            tint: "amber",
          });
        }
        for (const exam of dashboard.data.pending.examsWithoutResults.slice(
          0,
          3,
        )) {
          merged.push({
            id: `todo:exam:${exam.id}`,
            type: "todo",
            title: `Enter results for ${exam.name}`,
            description: "No marks recorded for your students yet.",
            timestamp: ts,
            href: "/exams",
            icon: ClipboardList,
            tint: "sky",
          });
        }
      }

      // Sort newest-first, then trim. Stable across reloads because
      // we don't randomize anything.
      merged.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      setItems(merged.slice(0, MAX_ITEMS));
    } catch (err) {
      // Only the auth-failure case bubbles up here — everything else
      // is caught per-source above.
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load notifications.",
      );
    } finally {
      setLoading(false);
      setHasFetched(true);
    }
  }, [role]);

  // Lazy load on first open. Re-load on subsequent opens too — cheap,
  // and turning the panel into "what's new since I last opened it" is
  // exactly the user's mental model.
  React.useEffect(() => {
    if (!open) return;
    void loadFeed();
  }, [open, loadFeed]);

  // Heuristic unread dot: any item from the last 24h. Doesn't track
  // "seen" state — that would need a backend table. The 24h cap keeps
  // it from being a perma-dot once a school has any history.
  const hasUnread = React.useMemo(() => {
    if (items.length === 0) return false;
    const cutoff = Date.now() - UNREAD_WINDOW_MS;
    return items.some((i) => new Date(i.timestamp).getTime() >= cutoff);
  }, [items]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
      >
        <Bell className="h-[18px] w-[18px]" />
        {/*
         * Show the dot when:
         *   • we haven't fetched yet (assume something might be there), OR
         *   • we have fetched AND something landed in the last 24h.
         * Hide once the user has opened the panel and confirmed there's
         * nothing recent — keeps the dot meaningful.
         */}
        {(!hasFetched || hasUnread) && (
          <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-destructive ring-2 ring-surface" />
        )}
      </button>

      {open && (
        <div
          role="menu"
          // Anchored to the right of the bell. Width is wide enough
          // for two-line items; max-height keeps a long feed from
          // running off the bottom of short viewports.
          className="absolute right-0 mt-2 w-[360px] max-w-[calc(100vw-1.5rem)] origin-top-right rounded-lg border border-border bg-surface shadow-xl animate-scale-in"
        >
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                Notifications
              </h3>
              {loading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Recent activity from your school.
            </p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {error && (
              <div className="px-4 py-3 text-xs text-destructive">
                {error}
              </div>
            )}

            {!error && !loading && items.length === 0 && (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Bell className="h-4 w-4" />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">
                  No recent activity
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Announcements and new enrollments will show up here.
                </p>
              </div>
            )}

            {!error && items.length > 0 && (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <FeedRow
                    key={item.id}
                    item={item}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Footer — context-appropriate "see more" link. Hidden when
              there's nothing in the list. */}
          {items.length > 0 && (
            <div className="border-t border-border px-2 py-2">
              <Link
                href="/announcements"
                onClick={() => setOpen(false)}
                className="block w-full rounded-md px-2.5 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-ring"
              >
                View all announcements
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const TINT_CLASSES: Record<FeedItem["tint"], string> = {
  primary: "bg-primary/10 text-primary",
  emerald:
    "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  amber:
    "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  sky: "bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
};

function FeedRow({
  item,
  onNavigate,
}: {
  item: FeedItem;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        className="group flex items-start gap-3 px-4 py-3 hover:bg-muted/60 transition-colors focus:outline-none focus-visible:bg-muted"
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ring-border/40",
            TINT_CLASSES[item.tint],
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug truncate">
            {item.title}
          </p>
          {item.description && (
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug truncate">
              {item.description}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground/80 tabular-nums">
            {formatRelative(item.timestamp)}
          </p>
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Time helpers — same shape used in the announcements page so the
// "5m ago" / "3h ago" wording stays consistent across surfaces.
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

"use client";

import * as React from "react";
import {
  AlertOctagon,
  CalendarCheck,
  Eye,
  Hash,
  Key,
  Lock,
  RotateCcw,
  Settings,
  ShieldOff,
  Sparkles,
  Unlock,
  UserX,
} from "lucide-react";
import type { AuditAction, AuditEvent } from "@/lib/audit";
import { AuditStamp } from "@/components/ui/AuditStamp";
import { CopyableId } from "@/components/ui/CopyableId";
import { cn } from "@/lib/utils";

// ============================================================================
// AuditEventRow — single-row renderer for the activity timeline.
//
// Translates the wire-shape `AuditEvent` into a compact "icon +
// verb + target + actor + time" line.
//
// Two modes:
//   • compact (default) — one line per event. Used in dense panels
//     and entity-history sidebars.
//   • expanded — adds `before/after` JSON snippet + ip/userAgent.
//     Used in the dedicated activity page (Part 1 follow-up).
//
// Verb / icon dispatch lives in a per-action map so adding a new
// audit action is one-line everywhere (verb + icon + tone).
// ============================================================================

export interface AuditEventRowProps {
  event: AuditEvent;
  /** Render the expanded body (before/after, IP, full target id). */
  expanded?: boolean;
  className?: string;
}

interface ActionPresentation {
  verb: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "amber" | "emerald" | "slate" | "rose";
}

const ACTION_MAP: Record<AuditAction, ActionPresentation> = {
  // High-attention school-side actions
  MARKS_LOCKED: { verb: "locked marks for", icon: Lock, tone: "amber" },
  MARKS_UNLOCKED: { verb: "unlocked marks for", icon: Unlock, tone: "emerald" },
  ATTENDANCE_BULK_OVERWRITE: {
    verb: "bulk-overwrote attendance for",
    icon: CalendarCheck,
    tone: "amber",
  },
  // Identity
  SCHOOL_CODE_ASSIGNED: {
    verb: "assigned School ID for",
    icon: Hash,
    tone: "slate",
  },
  SCHOOL_CODE_UPDATED: {
    verb: "changed School ID for",
    icon: Hash,
    tone: "amber",
  },
  // Subscription / status
  SCHOOL_STATUS_CHANGED: {
    verb: "changed status for",
    icon: Settings,
    tone: "amber",
  },
  SUBSCRIPTION_CREATED: {
    verb: "created subscription for",
    icon: Sparkles,
    tone: "emerald",
  },
  SCHOOL_MAINTENANCE_TOGGLED: {
    verb: "toggled maintenance for",
    icon: Settings,
    tone: "amber",
  },
  FEATURE_FLAG_CHANGED: {
    verb: "updated feature flags for",
    icon: Settings,
    tone: "slate",
  },
  // Security
  USER_FORCE_LOGOUT: { verb: "force-logged-out", icon: UserX, tone: "rose" },
  SCHOOL_FORCE_LOGOUT: {
    verb: "force-logged-out every user at",
    icon: ShieldOff,
    tone: "rose",
  },
  ADMIN_PASSWORD_RESET: {
    verb: "reset password for",
    icon: Key,
    tone: "amber",
  },
  IMPERSONATION_STARTED: {
    verb: "started impersonating",
    icon: Eye,
    tone: "rose",
  },
  IMPERSONATION_ENDED: {
    verb: "ended impersonation of",
    icon: Eye,
    tone: "slate",
  },
};

const toneClasses = {
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  slate: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
} as const;

export function AuditEventRow({
  event,
  expanded = false,
  className,
}: AuditEventRowProps) {
  const preset = ACTION_MAP[event.action] ?? FALLBACK_PRESET;
  const Icon = preset.icon;
  const actor = event.actorEmail ?? "Unknown";

  return (
    <div
      className={cn(
        "flex items-start gap-3 py-2.5",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          toneClasses[preset.tone],
        )}
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">
          <span className="font-medium">{actor}</span>{" "}
          <span className="text-muted-foreground">{preset.verb}</span>{" "}
          <span className="font-medium">
            {event.targetLabel ?? `${event.targetType.toLowerCase()}`}
          </span>
        </p>
        <div className="mt-0.5 flex items-center gap-2 flex-wrap">
          <AuditStamp at={event.createdAt} relative />
          <CopyableId value={event.id} label="· event" />
        </div>
        {expanded && (
          <ExpandedDetail event={event} />
        )}
      </div>
    </div>
  );
}

const FALLBACK_PRESET: ActionPresentation = {
  verb: "performed an action on",
  icon: AlertOctagon,
  tone: "slate",
};

function ExpandedDetail({ event }: { event: AuditEvent }) {
  // Render before/after JSON only when there's something to show.
  // Use a tiny preformatted block; readable without a fancy JSON
  // viewer dependency.
  const beforeStr = compactJson(event.before);
  const afterStr = compactJson(event.after);
  return (
    <div className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
      {event.reason && (
        <p>
          <span className="font-semibold">Reason:</span> {event.reason}
        </p>
      )}
      {beforeStr && (
        <p>
          <span className="font-semibold">Before:</span>{" "}
          <code className="font-mono">{beforeStr}</code>
        </p>
      )}
      {afterStr && (
        <p>
          <span className="font-semibold">After:</span>{" "}
          <code className="font-mono">{afterStr}</code>
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <CopyableId value={event.targetId} label={`· ${event.targetType.toLowerCase()}`} expand />
        {event.ip && (
          <span className="font-mono text-[10px]">ip {event.ip}</span>
        )}
      </div>
      {event.actorRole && (
        <p>
          <span className="font-semibold">Actor role:</span> {event.actorRole}
        </p>
      )}
    </div>
  );
}

function compactJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    const s = JSON.stringify(value);
    if (!s || s === "null" || s === "{}") return null;
    // Cap at 120 chars so a noisy `after` blob doesn't blow up the
    // sidebar. Operators who need full context have the audit row
    // id (copyable) to look up via the platform-side feed.
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return null;
  }
}

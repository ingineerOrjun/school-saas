"use client";

import * as React from "react";
import {
  AlertTriangle,
  Loader2,
  LogOut,
  Monitor,
  RotateCw,
  Smartphone,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  sessionsApi,
  type MySessionsResponse,
  type SessionRow,
} from "@/lib/sessions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

// ---------------------------------------------------------------------------
// /settings/devices — Phase 17 follow-up.
//
// School-side "Active sessions" page. Shows every session for the
// signed-in user, marks the one they're currently using, and lets
// them revoke individual sessions OR everything-except-here.
//
// Why "/devices" not "/sessions" — the dashboard already has
// /settings/sessions for ACADEMIC sessions (school year). The
// terminology overlap would be confusing for a school admin who's
// also juggling exam/promotion workflows.
//
// Tone: school-side primitives, not platform — this is end-user UX
// (warm, soft, school-themed) rather than the operational/slate
// look the platform layer uses.
// ---------------------------------------------------------------------------

export default function DevicesPage() {
  const [data, setData] = React.useState<MySessionsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await sessionsApi.list();
      setData(result);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load sessions.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const revokeOne = async (s: SessionRow) => {
    if (s.id === data?.currentSessionId) {
      // Sanity guard — the UI hides the button for the current
      // session, but defend in depth.
      toast.error("Use the Sign out button in the topbar to end this session.");
      return;
    }
    setPending(s.id);
    try {
      await sessionsApi.revoke(s.id);
      toast.success("Session revoked.");
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke session.",
      );
    } finally {
      setPending(null);
    }
  };

  const revokeOthers = async () => {
    setRevokingOthers(true);
    try {
      const result = await sessionsApi.revokeOthers();
      toast.success(
        result.count === 0
          ? "No other sessions to revoke."
          : `Revoked ${result.count} other session${result.count === 1 ? "" : "s"}.`,
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke other sessions.",
      );
    } finally {
      setRevokingOthers(false);
    }
  };

  const active = (data?.sessions ?? []).filter((s) => !s.revokedAt);
  const recent = (data?.sessions ?? []).filter((s) => s.revokedAt);
  const otherActiveCount =
    active.filter((s) => s.id !== data?.currentSessionId).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Active devices
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sessions on every device you've signed in from. Revoke any you
            don't recognize.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={load}
            disabled={loading}
            leftIcon={<RotateCw className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
          <Button
            variant="destructive"
            disabled={otherActiveCount === 0 || revokingOthers}
            onClick={revokeOthers}
            leftIcon={
              revokingOthers ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )
            }
          >
            Sign out everywhere else
          </Button>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="space-y-2 py-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {active.length === 0 ? (
                <p className="px-5 py-6 text-sm italic text-muted-foreground">
                  No active sessions.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {active.map((s) => (
                    <SessionListItem
                      key={s.id}
                      session={s}
                      isCurrent={s.id === data?.currentSessionId}
                      pending={pending === s.id}
                      onRevoke={() => void revokeOne(s)}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {recent.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recently revoked</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border">
                  {recent.map((s) => (
                    <SessionListItem
                      key={s.id}
                      session={s}
                      isCurrent={false}
                      pending={false}
                      onRevoke={() => undefined}
                      revokedView
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionListItem
// ---------------------------------------------------------------------------

function SessionListItem({
  session,
  isCurrent,
  pending,
  onRevoke,
  revokedView,
}: {
  session: SessionRow;
  isCurrent: boolean;
  pending: boolean;
  onRevoke: () => void;
  revokedView?: boolean;
}) {
  const ua = parseUserAgent(session.userAgent);
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {ua.isMobile ? (
          <Smartphone className="h-4 w-4" />
        ) : (
          <Monitor className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">
            {ua.label}
          </p>
          {isCurrent && (
            <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              This device
            </span>
          )}
          {revokedView && (
            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Revoked
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {session.ip ?? "<unknown IP>"} · last active{" "}
          {timeAgo(session.lastActiveAt)} · signed in{" "}
          {timeAgo(session.createdAt)}
          {session.revokedAt &&
            ` · revoked ${timeAgo(session.revokedAt)}${
              session.revokedReason ? ` (${session.revokedReason})` : ""
            }`}
        </p>
      </div>
      {!revokedView && !isCurrent && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRevoke}
          disabled={pending}
          leftIcon={
            pending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <LogOut className="h-3 w-3" />
            )
          }
        >
          Revoke
        </Button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseUserAgent(ua: string | null): {
  label: string;
  isMobile: boolean;
} {
  if (!ua) return { label: "Unknown device", isMobile: false };
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
  // Cheap browser/OS extraction — full UA parsing is overkill for
  // the few labels we surface. Falls back to the raw string when no
  // pattern matches.
  let browser = "Browser";
  if (/edg/i.test(ua)) browser = "Edge";
  else if (/chrome/i.test(ua)) browser = "Chrome";
  else if (/firefox/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";

  let os = "";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x/i.test(ua)) os = "macOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad/i.test(ua)) os = "iOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return {
    label: os ? `${browser} on ${os}` : browser,
    isMobile,
  };
}

function timeAgo(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

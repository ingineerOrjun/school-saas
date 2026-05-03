"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  Loader2,
  Lock,
  Plus,
  ShieldAlert,
  Trash2,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  academicSessionsApi,
  type AcademicSessionDto,
} from "@/lib/academic-sessions";
import { getStoredUser, type Role } from "@/lib/auth";
import { useAcademicSession } from "@/components/academic-session/AcademicSessionProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { DualDate } from "@/components/calendar/DualDate";
import { cn } from "@/lib/utils";

/**
 * /settings/sessions — admin-only academic-session manager.
 *
 * Backend `POST/DELETE/POST /academic-sessions[/:id/activate]`
 * accept ADMIN only. The page also renders an "access denied" panel
 * for non-admins following a deep link, mirroring the parent
 * /settings page convention.
 */
export default function AcademicSessionsPage() {
  const router = useRouter();
  const [role, setRole] = React.useState<Role | null>(null);
  const [authResolved, setAuthResolved] = React.useState(false);

  React.useEffect(() => {
    const u = getStoredUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    setRole(u.role);
    setAuthResolved(true);
  }, [router]);

  if (!authResolved) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (role !== "ADMIN") {
    return <AccessDenied />;
  }

  return <SessionsManager />;
}

// ---------------------------------------------------------------------------

function SessionsManager() {
  // We re-fetch through the global provider so the topbar selector
  // updates the moment we add or activate a session here.
  const { sessions, refresh, loading } = useAcademicSession();
  const [showAdd, setShowAdd] = React.useState(false);
  const [activatingId, setActivatingId] = React.useState<string | null>(
    null,
  );
  const [lockingId, setLockingId] = React.useState<string | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const handleActivate = async (s: AcademicSessionDto) => {
    if (s.isActive) return;
    setActivatingId(s.id);
    try {
      await academicSessionsApi.activate(s.id);
      await refresh();
      toast.success(`"${s.name}" is now the active session`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to activate session.",
      );
    } finally {
      setActivatingId(null);
    }
  };

  const handleToggleLock = async (s: AcademicSessionDto) => {
    setLockingId(s.id);
    try {
      if (s.isLocked) {
        await academicSessionsApi.unlock(s.id);
        toast.success(`"${s.name}" unlocked — writes resumed`);
      } else {
        // Make the lock action explicit — it freezes attendance,
        // marks, and exam writes for everyone.
        if (
          !window.confirm(
            `Lock "${s.name}"? Attendance, marks, and exam writes will be blocked until you unlock or run promotion.`,
          )
        ) {
          return;
        }
        await academicSessionsApi.lock(s.id);
        toast.success(`"${s.name}" locked — writes are frozen`);
      }
      await refresh();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Failed to update lock state.",
      );
    } finally {
      setLockingId(null);
    }
  };

  const handleRemove = async (s: AcademicSessionDto) => {
    if (s.isActive) {
      toast.error(
        "Activate a different session before deleting this one.",
      );
      return;
    }
    if (
      !window.confirm(
        `Delete "${s.name}"? Exams, attendance, and results from this session keep working but lose their session label.`,
      )
    ) {
      return;
    }
    setRemovingId(s.id);
    try {
      await academicSessionsApi.remove(s.id);
      await refresh();
      toast.success(`Removed "${s.name}"`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to delete session.",
      );
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1 animate-fade-in-up">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors focus-ring rounded-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Settings
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Academic sessions
        </h1>
        <p className="text-sm text-muted-foreground">
          Each session represents one academic year. Exactly one
          session is "active" at a time — new exams, attendance, and
          announcements default to it.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-surface p-6 animate-fade-in-up">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CalendarRange className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-md font-semibold tracking-tight text-foreground">
                Sessions
              </h2>
              <p className="text-sm text-muted-foreground">
                {loading
                  ? "Loading…"
                  : sessions.length === 0
                    ? "No sessions yet — add the first one to start year-scoping."
                    : `${sessions.length} session${sessions.length === 1 ? "" : "s"} configured.`}
              </p>
            </div>
          </div>
          <Button
            onClick={() => setShowAdd((v) => !v)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {showAdd ? "Hide form" : "Add session"}
          </Button>
        </div>

        {showAdd && (
          <AddSessionForm
            onCreated={async () => {
              await refresh();
              setShowAdd(false);
            }}
          />
        )}

        {loading ? (
          <div className="mt-5 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        ) : sessions.length === 0 ? null : (
          <ul className="mt-5 space-y-2">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                activating={activatingId === s.id}
                locking={lockingId === s.id}
                removing={removingId === s.id}
                onActivate={() => handleActivate(s)}
                onToggleLock={() => handleToggleLock(s)}
                onRemove={() => handleRemove(s)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SessionRow({
  session,
  activating,
  locking,
  removing,
  onActivate,
  onToggleLock,
  onRemove,
}: {
  session: AcademicSessionDto;
  activating: boolean;
  locking: boolean;
  removing: boolean;
  onActivate: () => void;
  onToggleLock: () => void;
  onRemove: () => void;
}) {
  const busy = activating || locking || removing;
  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors",
        session.isActive && "border-primary/40 bg-primary/5",
        // Locked sessions read with a warmer amber tint so admins
        // see at a glance which years are frozen.
        session.isLocked && "border-amber-400/50 bg-amber-50/40 dark:bg-amber-500/5",
        busy && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">
            {session.name}
          </span>
          {session.isActive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-200/60 dark:ring-emerald-900/60">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Active
            </span>
          )}
          {session.isLocked && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-300/60 dark:ring-amber-900/60"
              title="Attendance, marks, and exam writes are blocked"
            >
              <Lock className="h-2.5 w-2.5" />
              Locked
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <DualDate date={session.startDate} /> →{" "}
          <DualDate date={session.endDate} />
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!session.isActive && (
          <Button
            size="sm"
            variant="outline"
            onClick={onActivate}
            loading={activating}
            // Activation is also blocked while a different session is
            // being locked/unlocked — keep busy state pessimistic.
            disabled={busy}
          >
            Set active
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onToggleLock}
          loading={locking}
          disabled={busy}
          leftIcon={
            !locking ? (
              session.isLocked ? (
                <Unlock className="h-3.5 w-3.5" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )
            ) : undefined
          }
          title={
            session.isLocked
              ? "Unlock — re-enables attendance, marks, and exam writes"
              : "Lock — freezes attendance, marks, and exam writes (required before promotion)"
          }
        >
          {session.isLocked ? "Unlock" : "Lock"}
        </Button>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy || session.isActive}
          aria-label={`Delete ${session.name}`}
          title={
            session.isActive
              ? "Activate a different session first"
              : `Delete ${session.name}`
          }
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
            "transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-destructive/30",
            (busy || session.isActive) && "cursor-not-allowed opacity-40",
          )}
        >
          {removing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

function AddSessionForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [name, setName] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [activate, setActivate] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const datesOk = !!startDate && !!endDate && startDate < endDate;
  const canSubmit = name.trim().length > 0 && datesOk && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await academicSessionsApi.create({
        name: name.trim(),
        startDate,
        endDate,
        isActive: activate,
      });
      toast.success(`Created "${name.trim()}"`);
      setName("");
      setStartDate("");
      setEndDate("");
      setActivate(false);
      await onCreated();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to create session.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-5 rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          label="Name"
          placeholder="e.g. 2082/83"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={40}
          disabled={submitting}
        />
        <Input
          label="Start date (A.D.)"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
          disabled={submitting}
        />
        <Input
          label="End date (A.D.)"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          required
          disabled={submitting}
          error={
            startDate && endDate && startDate >= endDate
              ? "End date must be after start date"
              : undefined
          }
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={activate}
            onChange={(e) => setActivate(e.target.checked)}
            disabled={submitting}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Set as active immediately
        </label>
        <Button
          type="submit"
          disabled={!canSubmit}
          loading={submitting}
          leftIcon={!submitting ? <Plus className="h-3.5 w-3.5" /> : undefined}
        >
          Create session
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function AccessDenied() {
  return (
    <div className="rounded-xl border border-border bg-surface p-8 max-w-xl mx-auto text-center animate-fade-in-up">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
        Admin access required
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Academic-session management is restricted to school admins.
      </p>
    </div>
  );
}

"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CalendarCheck,
  Check,
  CheckCircle2,
  X,
  Users,
  CalendarDays,
  BookOpen,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { classesApi, type ClassWithSections } from "@/lib/classes";
import {
  useMyTeachingAssignments,
  type TeachingAssignmentDto,
} from "@/lib/teaching-assignments";
import {
  attendanceApi,
  todayISO,
  type AttendanceRoster,
  type AttendanceStatus,
} from "@/lib/attendance";
import { enqueue as enqueueAttendance } from "@/lib/offline-queue";
import { cacheRoster, getCachedRoster } from "@/lib/roster-cache";
import { syncNow } from "@/lib/sync-engine";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { Button } from "@/components/ui/Button";
import { ConfirmDestructiveActionDialog } from "@/components/ui/ConfirmDestructiveActionDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { DualDate } from "@/components/calendar/DualDate";
import { MobileAttendanceList } from "@/components/mobile/MobileAttendanceList";

/**
 * Composite scope identifier for the roster dropdown. Encoded as a
 * single string so we can keep a single `<select>` driving both "pick a
 * section" and "pick a whole class". Formats:
 *   - ""               → nothing selected
 *   - "section:<uuid>" → specific section
 *   - "class:<uuid>"   → whole class (no sections)
 */
type ScopeValue = string;

function parseScope(value: ScopeValue): {
  sectionId?: string;
  classId?: string;
} {
  if (value.startsWith("section:")) {
    return { sectionId: value.slice("section:".length) };
  }
  if (value.startsWith("class:")) {
    return { classId: value.slice("class:".length) };
  }
  return {};
}

/**
 * Restrict the catalog to the classes/sections a TEACHER is assigned to.
 *
 * Rules per assignment:
 *   • sectionId set  → only that section appears (under its parent class)
 *   • sectionId null → the whole class appears, with EVERY section under it
 *
 * The union across all assignments is what's shown. ADMINs pass
 * `assignments = null` to get the unfiltered catalog.
 *
 * Implementation note: we re-shape the original `ClassWithSections`
 * objects rather than mutating them, so React refs stay stable for the
 * unaffected branches.
 */
function filterClassesByAssignments(
  classes: ClassWithSections[],
  assignments: TeachingAssignmentDto[] | null,
): ClassWithSections[] {
  if (assignments === null) return classes;
  if (assignments.length === 0) return [];

  // Per-class allow-set: which sections (or "whole class") are allowed.
  // `whole === true` means class-bound assignment → show every section.
  const byClass = new Map<string, { whole: boolean; sectionIds: Set<string> }>();
  for (const a of assignments) {
    const entry =
      byClass.get(a.classId) ?? { whole: false, sectionIds: new Set<string>() };
    if (a.sectionId) {
      entry.sectionIds.add(a.sectionId);
    } else {
      // Class-bound assignment: implicitly grants every section under it.
      entry.whole = true;
    }
    byClass.set(a.classId, entry);
  }

  return classes
    .filter((c) => byClass.has(c.id))
    .map((c) => {
      const allow = byClass.get(c.id)!;
      const sections = allow.whole
        ? c.sections
        : c.sections.filter((s) => allow.sectionIds.has(s.id));
      return { ...c, sections };
    });
}

/**
 * Read `?sectionId=...` or `?classId=...` from the URL once and convert
 * to the encoded ScopeValue used by the picker. Used to seed the scope
 * when the page is reached via a deep link (e.g. from the teacher
 * dashboard "Take attendance" button). Empty string when neither param
 * is present, which leaves the picker in its default empty state.
 */
function useInitialScopeFromQuery(): ScopeValue {
  const params = useSearchParams();
  // We only ever read this on first render — after that the picker is
  // authoritative, so it's fine to ignore subsequent param changes.
  const initial = React.useRef<ScopeValue | null>(null);
  if (initial.current === null) {
    const sectionId = params.get("sectionId");
    const classId = params.get("classId");
    initial.current = sectionId
      ? `section:${sectionId}`
      : classId
        ? `class:${classId}`
        : "";
  }
  return initial.current;
}

export default function AttendancePage() {
  const router = useRouter();
  // Online status drives the offline path: when offline we still
  // accept toggles (queued to IndexedDB) but show "Saved offline"
  // instead of the live "Saved" toast. The sync engine handles the
  // actual POST when connectivity returns.
  const online = useOnlineStatus();
  // Phase 25 — phone-shaped roster swap. Same data sources, same
  // saveOne/markAll handlers; only the rendering changes when
  // we're on a narrow screen.
  const isMobile = useIsMobile();
  // Pre-fill scope from URL on mount so deep links from the teacher
  // dashboard ("Take attendance") land directly on the right roster
  // instead of an empty picker. We read once at init, not on every
  // render — afterwards the picker is the source of truth.
  const initialScope = useInitialScopeFromQuery();
  const [date, setDate] = React.useState<string>(todayISO());
  const [classes, setClasses] = React.useState<ClassWithSections[]>([]);
  // For TEACHER users we filter the picker to only their assigned
  // classes/sections — they can't act outside their scope anyway, and
  // showing the full catalog would just waste their time. ADMIN keeps
  // the full list (`null` = "no filter applied").
  //
  // Role gate is computed via useEffect (not at render time) so the
  // initial SSR render and the first hydrated render agree on
  // `isTeacher = false` — `getStoredUser()` reads localStorage which
  // doesn't exist server-side. The hook stays disabled until the
  // role lands, then refires for genuine teachers only.
  const [isTeacher, setIsTeacher] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    setIsTeacher(getStoredUser()?.role === "TEACHER");
  }, []);
  const {
    data: rawAssignments,
    isLoading: assignmentsLoading,
    error: assignmentsError,
  } = useMyTeachingAssignments({ enabled: isTeacher === true });
  const assignments: TeachingAssignmentDto[] | null = React.useMemo(() => {
    // ADMIN/STAFF — no filter (existing semantics: null means "show all").
    if (isTeacher === false) return null;
    // 403 → not-a-teacher row / role mismatch. Existing UX: empty
    // catalog (dropdown collapses) rather than blocking the page.
    if (
      assignmentsError instanceof ApiError &&
      assignmentsError.status === 403
    ) {
      return [];
    }
    // While the hook hasn't resolved (or role is still null on first
    // render), surface as `[]` so we don't briefly leak the unfiltered
    // admin catalog to a teacher mid-load. The combined-loading flag
    // below keeps the dropdown disabled during this window anyway.
    return rawAssignments ?? (isTeacher ? [] : null);
  }, [isTeacher, rawAssignments, assignmentsError]);
  const [scope, setScope] = React.useState<ScopeValue>(initialScope);
  const [roster, setRoster] = React.useState<AttendanceRoster[] | null>(null);
  // ISO timestamp returned with the last successful roster fetch. We
  // forward this as `lastKnownVersion` on every queued mark so the
  // sync engine can detect "data changed while user was offline" via
  // the backend's 409 path. Populated whether the roster came from
  // network OR cache — both have versions.
  const [rosterVersion, setRosterVersion] = React.useState<string | null>(
    null,
  );
  // Epoch-ms timestamp when the displayed roster was last fetched
  // fresh from the server. Set to `null` while showing live network
  // data; populated from the cache's `updatedAt` when we fall back
  // to IndexedDB. Drives the "⚠ Showing last synced roster" pill.
  const [staleSince, setStaleSince] = React.useState<number | null>(null);
  const [loadingClasses, setLoadingClasses] = React.useState(true);
  const [loadingRoster, setLoadingRoster] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savingIds, setSavingIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  // Pending bulk overwrite. When non-null, the confirmation dialog
  // is open and `markAll` will fire on confirm. Per Phase
  // data-integrity Rule 4, bulk attendance overwrite is high-risk
  // (touches every student in scope, hard to undo by hand) and
  // requires a typed confirmation before the write proceeds.
  const [pendingBulk, setPendingBulk] =
    React.useState<AttendanceStatus | null>(null);

  // Load classes only — assignments now flow through the React Query
  // cache via `useMyTeachingAssignments()` above. The two used to be
  // fetched together via Promise.all; splitting them removes the
  // duplicate /teachers/me/assignments hits across pages without
  // changing the user-visible loading flow (see `referenceLoading`
  // below, which combines both halves before the dropdown is enabled).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const classList = await classesApi.list();
        if (cancelled) return;
        setClasses(classList);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        const msg =
          err instanceof ApiError ? err.message : "Failed to load classes.";
        setError(msg);
      } finally {
        if (!cancelled) setLoadingClasses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  /**
   * Roster fetch — offline-aware:
   *
   *   1. Attempt the network call.
   *   2. On success: render fresh data + write-through to IndexedDB
   *      so the next offline visit has a snapshot to fall back on.
   *   3. On NETWORK failure (TypeError from fetch): consult the
   *      cache. If we have a snapshot, render it with `staleSince`
   *      set so the UI shows "⚠ Showing last synced roster". If we
   *      don't, surface "No offline data available."
   *   4. On AUTH / server failures (ApiError with a status): treat
   *      as a real error — these aren't connectivity-related, so
   *      falling back to cached data would mask the real problem.
   *
   * The 401 redirect path stays intact so an expired session still
   * bounces to /login. When the network comes back, an `online`
   * event listener below silently re-fetches and clears the
   * stale-indicator without disturbing the marks the teacher has
   * already enqueued.
   */
  React.useEffect(() => {
    const parsed = parseScope(scope);
    if (!parsed.sectionId && !parsed.classId) {
      setRoster(null);
      setRosterVersion(null);
      setStaleSince(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingRoster(true);
      setError(null);
      try {
        const data = await attendanceApi.getRoster(date, parsed);
        if (cancelled) return;
        setRoster(data.students);
        setRosterVersion(data.version);
        setStaleSince(null);
        // Write-through cache. Fire-and-forget — a failed cache
        // write must NEVER affect the visible page (e.g. quota
        // exceeded in private browsing). The `version` is stored
        // alongside so a later comparison can detect roster drift
        // (added / removed students) without a content diff.
        void cacheRoster(parsed, data.students, data.version).catch(() => {
          /* non-critical */
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        // Distinguish real connectivity failures from server-side
        // errors. `TypeError` from fetch = device went offline mid-
        // request; that's our cue to consult the cache. ApiError
        // (the server responded with a 4xx/5xx) is a real error.
        const isNetworkError = err instanceof TypeError;
        if (isNetworkError) {
          const cached = await getCachedRoster(parsed).catch(() => null);
          if (cancelled) return;
          if (cached) {
            setRoster(cached.students);
            // Cached version may be undefined for snapshots taken
            // before the versioning rollout. Forward `null` in that
            // case — the conflict check on the backend just skips
            // when no header is sent.
            setRosterVersion(cached.version ?? null);
            setStaleSince(cached.updatedAt);
            // No `setError` here — the stale-indicator pill is
            // sufficient signal. Showing both would feel broken.
          } else {
            setRoster(null);
            setRosterVersion(null);
            setStaleSince(null);
            setError("No offline data available for this class yet.");
          }
        } else {
          const msg =
            err instanceof ApiError ? err.message : "Failed to load roster.";
          if (!cancelled) setError(msg);
        }
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, scope, router]);

  /**
   * Auto-refresh when the device comes back online while we're
   * showing cached (stale) data. Re-runs the effect above by
   * triggering a synthetic dependency change isn't necessary — we
   * call the endpoint directly here, and the effect's main path
   * will re-fire on the next normal dependency change anyway.
   *
   * Skips when not actually showing stale data so we don't burn
   * a request every time the user toggles networks while they're
   * already on fresh data.
   */
  React.useEffect(() => {
    if (staleSince === null) return;
    const onOnline = async () => {
      const parsed = parseScope(scope);
      if (!parsed.sectionId && !parsed.classId) return;
      try {
        const data = await attendanceApi.getRoster(date, parsed);
        // Server is authoritative once reachable — replace cache + UI
        // unconditionally. The `version` field is the hook for any
        // future "your offline snapshot was outdated" notice (we have
        // both the cached version and the fresh one to compare).
        setRoster(data.students);
        setRosterVersion(data.version);
        setStaleSince(null);
        void cacheRoster(parsed, data.students, data.version).catch(() => {
          /* non-critical */
        });
      } catch {
        // Still offline / failed — leave the stale data in place.
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [staleSince, date, scope]);

  const stats = React.useMemo(() => {
    if (!roster) return { present: 0, absent: 0, unmarked: 0, total: 0 };
    let present = 0,
      absent = 0,
      unmarked = 0;
    for (const r of roster) {
      if (r.status === "PRESENT") present++;
      else if (r.status === "ABSENT") absent++;
      else unmarked++;
    }
    return { present, absent, unmarked, total: roster.length };
  }, [roster]);

  /**
   * Single-student toggle. Always:
   *   1. Optimistically updates the roster (so the chip flips
   *      immediately — both online and offline).
   *   2. Enqueues the mark payload in IndexedDB (durable across
   *      reload + browser restarts).
   *   3. If online, kicks the sync engine which posts the queue to
   *      the backend right away. If offline, the engine sits idle
   *      until `online` fires and drains everything in order.
   *
   * The queue's idempotency comes from the backend's
   * `prisma.attendance.upsert` + unique(studentId, date) — re-posting
   * the same payload after a flaky connection just re-confirms the
   * state, never duplicates.
   */
  const saveOne = async (studentId: string, status: AttendanceStatus) => {
    setRoster(
      (r) =>
        r?.map((s) => (s.studentId === studentId ? { ...s, status } : s)) ?? r,
    );
    setSavingIds((s) => new Set(s).add(studentId));
    try {
      const parsed = parseScope(scope);
      const scopeId = parsed.sectionId ?? parsed.classId ?? "unknown";
      await enqueueAttendance({
        endpoint: "/attendance/mark",
        method: "POST",
        payload: { date, entries: [{ studentId, status }] },
        feature: "attendance",
        // Inspector label — admins scanning the queue need to know
        // which class+date this row is for at a glance.
        label: `${scopeId} · ${date}`,
        // Dedup key per (scope, date, student). Toggling the same
        // student multiple times offline (PRESENT → ABSENT → PRESENT)
        // collapses to a single PENDING row carrying the latest
        // intent — the previous payload is overwritten in place.
        // Other students get their own keys, so this never coalesces
        // unrelated toggles.
        dedupKey: `${scopeId}|${date}|${studentId}`,
        // Roster fingerprint at the time the user took this action.
        // Sync engine forwards as `X-Last-Known-Version`. Backend
        // 409s if the live roster has drifted past it — the sync
        // engine then marks this item FAILED and toasts a one-shot
        // "Data changed. Please review." prompt instead of silently
        // overwriting fresher data.
        lastKnownVersion: rosterVersion ?? undefined,
      });
      if (online) {
        // Best-effort immediate drain. Don't block the UI on the
        // network round-trip — the engine reports back via the badge.
        void syncNow();
      } else {
        toast.success("Saved offline — will sync when you're back online.");
      }
    } catch (err) {
      // Enqueue failed (very rare — IndexedDB unavailable / quota).
      // Roll back the optimistic update because we have no record of
      // the change anywhere.
      setRoster(
        (r) =>
          r?.map((s) =>
            s.studentId === studentId ? { ...s, status: null } : s,
          ) ?? r,
      );
      toast.error(
        err instanceof Error
          ? `Couldn't save: ${err.message}`
          : "Failed to save attendance. Reverted.",
      );
    } finally {
      setSavingIds((s) => {
        if (!s.has(studentId)) return s;
        const n = new Set(s);
        n.delete(studentId);
        return n;
      });
    }
  };

  /**
   * Bulk "mark everyone present/absent". Same offline-first contract
   * as `saveOne`: optimistic UI → enqueue → drain when online.
   */
  const markAll = async (status: AttendanceStatus) => {
    if (!roster || roster.length === 0) return;
    setRoster(roster.map((r) => ({ ...r, status })));
    const allIds = new Set(roster.map((r) => r.studentId));
    setSavingIds(allIds);
    try {
      const parsed = parseScope(scope);
      const scopeId = parsed.sectionId ?? parsed.classId ?? "unknown";
      await enqueueAttendance({
        endpoint: "/attendance/mark",
        method: "POST",
        payload: {
          date,
          entries: roster.map((r) => ({ studentId: r.studentId, status })),
        },
        feature: "attendance",
        label: `${scopeId} · ${date}`,
        // "Mark all" with the same scope+date coalesces — repeated
        // bulk overrides offline collapse to a single row with the
        // last-applied status. Distinct from the per-student key so
        // bulk doesn't clobber individual toggles and vice versa.
        dedupKey: `${scopeId}|${date}|markAll`,
        // Same conflict-detection contract as `saveOne` — the bulk
        // payload covers more students, so a roster change is even
        // more relevant to flag.
        lastKnownVersion: rosterVersion ?? undefined,
      });
      if (online) {
        toast.success(
          status === "PRESENT"
            ? `Marked all ${roster.length} present`
            : `Marked all ${roster.length} absent`,
        );
        void syncNow();
      } else {
        toast.success(
          `Marked all ${roster.length} ${status === "PRESENT" ? "present" : "absent"} — saved offline.`,
        );
      }
    } catch (err) {
      // Enqueue failed — roll back the optimistic update.
      setRoster((r) => r?.map((s) => ({ ...s, status: null })) ?? r);
      toast.error(
        err instanceof Error
          ? `Couldn't save: ${err.message}`
          : "Bulk save failed. Roster reverted.",
      );
    } finally {
      setSavingIds(new Set());
    }
  };

  // Restrict the dropdown to assignments when the caller is a TEACHER.
  // ADMIN users (assignments === null) see the full catalog unchanged.
  const visibleClasses = React.useMemo(
    () => filterClassesByAssignments(classes, assignments),
    [classes, assignments],
  );

  // Combined "reference data not ready yet" flag. Classes come from
  // an imperative fetch; assignments come from the React Query hook.
  // We gate the dropdown on BOTH so a teacher never briefly sees the
  // unfiltered catalog flicker through during the assignments hydration
  // window. Mirrors the old Promise.all-based UX exactly.
  const referenceLoading =
    loadingClasses || isTeacher === null || (isTeacher && assignmentsLoading);
  const noClasses = !referenceLoading && visibleClasses.length === 0;
  const hasSections = visibleClasses.some((c) => c.sections.length > 0);
  const scopeSelected = scope !== "";

  return (
    <div className="space-y-6">
      <Header />

      {/* Controls */}
      <div className="glass rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-end animate-fade-in-up">
        <div className="flex flex-col gap-1.5 sm:w-56">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Date
          </label>
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
              className={cn(
                "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
                "transition-colors",
              )}
            />
          </div>
          {/* Show the picked date in the user's preferred calendar
              under the input. The native picker is locked to A.D., so
              this is how Nepali admins see the BS equivalent without
              us writing a custom calendar widget. */}
          <p className="text-[11px] text-muted-foreground">
            <DualDate date={date} />
          </p>
        </div>

        <div className="flex-1 flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Class &amp; Section
          </label>
          <div className="relative">
            <BookOpen className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={referenceLoading || noClasses}
              className={cn(
                "h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
                "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
                "transition-colors",
              )}
            >
              <option value="">
                {noClasses
                  ? "No classes yet"
                  : referenceLoading
                    ? "Loading classes…"
                    : "Choose a class or section…"}
              </option>
              {visibleClasses.map((klass) => (
                <optgroup key={klass.id} label={klass.name}>
                  {/* Whole-class option — essential for schools without
                      sections. Also available when sections exist, and it
                      returns the students who haven't been placed into
                      any section yet. */}
                  <option value={`class:${klass.id}`}>
                    {klass.sections.length > 0
                      ? `${klass.name} — whole class (no section)`
                      : `${klass.name} — whole class`}
                  </option>
                  {klass.sections.map((section) => (
                    <option key={section.id} value={`section:${section.id}`}>
                      {klass.name} · Section {section.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {scopeSelected && roster && roster.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => setPendingBulk("PRESENT")}
              leftIcon={<Check className="h-4 w-4" />}
            >
              Mark all present
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => setPendingBulk("ABSENT")}
              leftIcon={<X className="h-4 w-4" />}
            >
              Mark all absent
            </Button>
          </div>
        )}
      </div>

      {/* Bulk-overwrite confirmation. Typed confirmation required —
          this writes a row for every student in the current roster
          and emits a platform audit event (ATTENDANCE_BULK_OVERWRITE)
          on the backend. The pendingBulk state stays set until the
          mutation finishes, so a double-click during the write is a
          no-op (the dialog stays open with the spinner). */}
      <ConfirmDestructiveActionDialog
        open={pendingBulk !== null}
        title={
          pendingBulk === "PRESENT"
            ? "Mark every student PRESENT?"
            : pendingBulk === "ABSENT"
              ? "Mark every student ABSENT?"
              : ""
        }
        description={
          <>
            This will overwrite today's attendance for{" "}
            <span className="font-medium text-foreground">
              {roster?.length ?? 0} student
              {roster && roster.length === 1 ? "" : "s"}
            </span>{" "}
            in the selected class — including any individual marks
            already toggled. The action is logged to the platform
            audit trail with your name and timestamp.
          </>
        }
        typedConfirmation={{
          label: 'Type "OVERWRITE" to confirm',
          expectedValue: "OVERWRITE",
        }}
        confirmLabel={
          pendingBulk === "PRESENT" ? "Mark all present" : "Mark all absent"
        }
        isPending={savingIds.size > 0}
        onCancel={() => setPendingBulk(null)}
        onConfirm={() => {
          if (pendingBulk) {
            const status = pendingBulk;
            setPendingBulk(null);
            void markAll(status);
          }
        }}
      />

      {/* No classes yet — prompt to create one */}
      {noClasses && (
        <div className="glass rounded-xl animate-fade-in-up">
          <EmptyState
            icon={<BookOpen className="h-10 w-10" strokeWidth={1.5} />}
            title="Create a class first"
            description="Attendance needs a class with sections. Set up your academic structure, then come back here."
            action={{
              label: "Go to Classes",
              icon: <Sparkles className="h-4 w-4" />,
              onClick: () => router.push("/classes"),
            }}
          />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="glass rounded-xl p-5 flex items-start gap-3 border-destructive/20 animate-fade-in">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-md font-semibold tracking-tight text-foreground">
              Something went wrong
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      )}

      {/* Roster states */}
      {!scopeSelected && !noClasses && !error && (
        <div className="glass rounded-xl animate-fade-in-up">
          <EmptyState
            icon={<CalendarCheck className="h-10 w-10" strokeWidth={1.5} />}
            title="Pick a class or section to start"
            description={
              hasSections
                ? "Attendance rows will appear here — tap Present or Absent on each student. Classes without sections can be marked as a whole."
                : "Your classes don't have sections — pick a class to mark attendance for the whole class."
            }
          />
        </div>
      )}

      {scopeSelected && (
        <>
          {loadingRoster ? (
            <RosterSkeleton />
          ) : roster && roster.length === 0 ? (
            <div className="glass rounded-xl animate-fade-in-up">
              <EmptyState
                icon={<Users className="h-10 w-10" strokeWidth={1.5} />}
                title={
                  parseScope(scope).classId
                    ? "No students in this class yet"
                    : "No students in this section"
                }
                description={
                  parseScope(scope).classId
                    ? "Assign students to this class from the Students page, then come back to mark their attendance."
                    : "Assign students to this section from the Students page, then come back to mark their attendance."
                }
                action={{
                  label: "Go to Students",
                  onClick: () => router.push("/students"),
                }}
              />
            </div>
          ) : roster && roster.length > 0 ? (
            <div className="space-y-4 animate-fade-in-up">
              {staleSince !== null && <StaleRosterBanner since={staleSince} />}
              <StatsBar
                present={stats.present}
                absent={stats.absent}
                unmarked={stats.unmarked}
                total={stats.total}
              />
              {isMobile ? (
                /* Phase 25 — mobile roster: compressed cards, tap-toggle,
                   sticky bulk-action bar, per-row sync indicator. Reuses
                   the same saveOne/markAll handlers as the desktop view
                   so offline + sync semantics are identical. */
                <MobileAttendanceList
                  roster={roster}
                  syncMap={
                    new Map(
                      [...savingIds].map((id) => [id, "syncing" as const]),
                    )
                  }
                  onToggle={(studentId, status) => saveOne(studentId, status)}
                  onMarkAll={(status) => markAll(status)}
                  syncing={savingIds.size > 0}
                />
              ) : (
                <ul className="space-y-2" role="list">
                  {roster.map((r) => (
                    <AttendanceRow
                      key={r.studentId}
                      row={r}
                      saving={savingIds.has(r.studentId)}
                      onMark={(status) => saveOne(r.studentId, status)}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Attendance
        </h1>
        <p className="text-sm text-muted-foreground">
          Tap Present or Absent on each student — changes save as you go.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Link
          href="/attendance/insights"
          className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
        >
          Insights →
        </Link>
        <Link
          href="/classes"
          className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
        >
          Manage classes →
        </Link>
      </div>
    </div>
  );
}

/**
 * Amber pill above the roster when the displayed list came from
 * IndexedDB instead of a fresh network call. Two-line layout: the
 * spec's "Roster may be outdated" warning plus a contextual "last
 * updated X ago" so the admin / teacher can decide whether to wait
 * for reconnect or trust the cached snapshot. Re-fetches silently
 * when the `online` event fires; the banner disappears at that
 * point.
 */
function StaleRosterBanner({ since }: { since: number }) {
  const ago = formatAgo(since);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="space-y-0.5">
        <p className="font-medium">Roster may be outdated</p>
        <p className="text-amber-900/80 dark:text-amber-200/80">
          Showing the last synced copy ({ago}). Marks you make now are
          queued and will sync — alongside any roster changes — once
          you&apos;re back online.
        </p>
      </div>
    </div>
  );
}

function formatAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function StatsBar({
  present,
  absent,
  unmarked,
  total,
}: {
  present: number;
  absent: number;
  unmarked: number;
  total: number;
}) {
  const marked = present + absent;
  const progressPct = total === 0 ? 0 : (marked / total) * 100;
  const isComplete = total > 0 && unmarked === 0;

  return (
    <div
      className={cn(
        "glass rounded-xl p-4",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        "transition-colors duration-500 ease-out",
        isComplete && "border-success/40 bg-success/[0.04]",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatPill tone="success" count={present} label="Present" />
        <StatPill tone="destructive" count={absent} label="Absent" />
        <StatPill tone="muted" count={unmarked} label="Unmarked" />
        {isComplete && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success animate-fade-in-up">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
            Attendance complete
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs tabular-nums">
            <span className="font-semibold text-foreground">{marked}</span>
            <span className="text-muted-foreground"> of {total} marked</span>
          </span>
          <div className="h-2 w-44 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500 ease-out",
                isComplete
                  ? "bg-gradient-to-r from-success to-emerald-400"
                  : "bg-gradient-to-r from-primary to-purple-500",
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatPill({
  tone,
  count,
  label,
}: {
  tone: "success" | "destructive" | "muted";
  count: number;
  label: string;
}) {
  const tones = {
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tones[tone],
      )}
    >
      <span className="tabular-nums font-semibold">{count}</span>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------

function AttendanceRow({
  row,
  saving,
  onMark,
}: {
  row: AttendanceRoster;
  saving: boolean;
  onMark: (status: AttendanceStatus) => void;
}) {
  const isPresent = row.status === "PRESENT";
  const isAbsent = row.status === "ABSENT";

  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl p-3 sm:p-4",
        "border transition-colors duration-200 ease-out",
        isPresent && "bg-success/10 border-success/30",
        isAbsent && "bg-destructive/10 border-destructive/30",
        !isPresent && !isAbsent && "glass border-border/60",
        saving && "opacity-80",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar
          firstName={row.firstName}
          lastName={row.lastName}
          id={row.studentId}
          tone={isPresent ? "success" : isAbsent ? "destructive" : "neutral"}
        />
        <div className="flex flex-col leading-tight min-w-0">
          <span className="font-medium text-foreground truncate">
            {row.firstName} {row.lastName}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            #{row.studentId.slice(0, 8)}
          </span>
        </div>
      </div>

      <MarkButtons
        status={row.status}
        saving={saving}
        onMark={(status) => {
          // No-op if clicking the already-active button so we don't
          // trigger a redundant network write.
          if (status === row.status) return;
          onMark(status);
        }}
      />
    </li>
  );
}

function MarkButtons({
  status,
  saving,
  onMark,
}: {
  status: AttendanceStatus | null;
  saving: boolean;
  onMark: (status: AttendanceStatus) => void;
}) {
  const isPresent = status === "PRESENT";
  const isAbsent = status === "ABSENT";

  return (
    <div
      className="inline-flex shrink-0 items-stretch overflow-hidden rounded-lg border border-border bg-surface/60 backdrop-blur-md text-xs font-semibold"
      role="group"
      aria-label="Mark attendance"
    >
      <button
        type="button"
        aria-pressed={isPresent}
        disabled={saving}
        onClick={() => onMark("PRESENT")}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 transition-all duration-150",
          "focus:outline-none focus:ring-2 focus:ring-success/30 focus:z-10",
          "active:scale-[0.97]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          isPresent
            ? "bg-success text-white shadow-inner"
            : "text-success hover:bg-success/10",
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
        Present
      </button>
      <span
        aria-hidden
        className={cn(
          "w-px bg-border",
          (isPresent || isAbsent) && "bg-transparent",
        )}
      />
      <button
        type="button"
        aria-pressed={isAbsent}
        disabled={saving}
        onClick={() => onMark("ABSENT")}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 transition-all duration-150",
          "focus:outline-none focus:ring-2 focus:ring-destructive/30 focus:z-10",
          "active:scale-[0.97]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          isAbsent
            ? "bg-destructive text-white shadow-inner"
            : "text-destructive hover:bg-destructive/10",
        )}
      >
        <X className="h-3.5 w-3.5" strokeWidth={3} />
        Absent
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RosterSkeleton() {
  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="glass rounded-xl p-4 flex items-center justify-between">
        <div className="flex gap-3">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="h-2 w-40 rounded-full" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="glass rounded-xl p-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

const AVATAR_PALETTES = [
  "from-indigo-400 to-purple-400",
  "from-sky-400 to-blue-400",
  "from-amber-400 to-orange-400",
  "from-pink-400 to-rose-400",
  "from-violet-400 to-fuchsia-400",
  "from-teal-400 to-cyan-400",
];

function paletteFor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_PALETTES[sum % AVATAR_PALETTES.length];
}

function Avatar({
  firstName,
  lastName,
  id,
  tone,
}: {
  firstName: string;
  lastName: string;
  id: string;
  tone: "neutral" | "success" | "destructive";
}) {
  const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
  if (tone === "success") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-xs font-semibold text-success-foreground shadow-sm ring-1 ring-inset ring-white/20">
        {initials}
      </div>
    );
  }
  if (tone === "destructive") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive text-xs font-semibold text-destructive-foreground shadow-sm ring-1 ring-inset ring-white/20">
        {initials}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-1 ring-inset ring-white/20",
        `bg-gradient-to-br ${paletteFor(id)}`,
      )}
    >
      {initials}
    </div>
  );
}

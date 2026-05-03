"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BookOpen,
  Loader2,
  Plus,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { getStoredUser, type Role } from "@/lib/auth";
import { subjectsApi, type SubjectDto } from "@/lib/subjects";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

/**
 * /subjects — school subject catalog.
 *
 * Audience: ADMIN and STAFF. The sidebar already gates the link via
 * `requiresRole: ["ADMIN", "STAFF"]`; this page also renders an
 * "access denied" panel for any other role that follows a deep link.
 *
 * Backend `POST/PATCH/DELETE /subjects` accepts both ADMIN and STAFF.
 * GET is open to any auth user (teachers need it for assignment
 * dropdowns) but the management page itself is admin/staff only.
 *
 * The same pill-list + add-form pattern as the SubjectsSection in
 * /settings; lifting it here is the standalone surface the new STAFF
 * role wants — Settings stays admin-only and admins still get a
 * second entry point there.
 */
export default function SubjectsPage() {
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

  if (role !== "ADMIN" && role !== "STAFF") {
    return <AccessDenied />;
  }

  return <SubjectsCatalog />;
}

// ---------------------------------------------------------------------------

function SubjectsCatalog() {
  const [list, setList] = React.useState<SubjectDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Set so multiple deletes can run in parallel without their spinners
  // stomping each other.
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await subjectsApi.list();
      setList(data);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load subjects.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const trimmedDraft = draft.trim();
  // Inline duplicate detection — fire BEFORE the server returns 409 so
  // the user gets feedback the moment they finish typing. Comparison
  // is case-insensitive (matches the backend's unique constraint).
  const duplicate = React.useMemo(
    () =>
      trimmedDraft.length > 0 &&
      list.some(
        (s) => s.name.toLowerCase() === trimmedDraft.toLowerCase(),
      ),
    [list, trimmedDraft],
  );
  const canAdd = trimmedDraft.length > 0 && !duplicate && !adding;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    setAdding(true);
    try {
      const created = await subjectsApi.create({ name: trimmedDraft });
      // Insert at the right alphabetical slot so the list stays sorted
      // without a re-fetch round-trip.
      setList((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setDraft("");
      toast.success(`Added "${created.name}"`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to add subject.",
      );
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (subject: SubjectDto) => {
    setRemovingIds((prev) => new Set(prev).add(subject.id));
    try {
      await subjectsApi.remove(subject.id);
      setList((prev) => prev.filter((s) => s.id !== subject.id));
      toast.success(`Removed "${subject.name}"`, {
        description:
          "Existing teaching assignments using this subject keep working but are now subject-less.",
      });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to remove subject.",
      );
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(subject.id);
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1 animate-fade-in-up">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Subjects
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage the school&apos;s subject catalog. Used by the assignment
          dialog when wiring teachers to subject + class pairs.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Couldn&apos;t load subjects
            </p>
            <p className="mt-1 text-sm text-destructive/90">{error}</p>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-6 animate-fade-in-up">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-md font-semibold tracking-tight text-foreground">
                Catalog
              </h2>
              {!loading && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                  {list.length}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Add the subjects taught in your school. Removing a subject
              keeps existing assignments intact but unlinks them from a
              specific subject.
            </p>
          </div>
        </div>

        {/* Pill list */}
        <div className="mt-5">
          {loading ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-24 rounded-full" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No subjects yet — add the first one below.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {list.map((s) => {
                const removing = removingIds.has(s.id);
                return (
                  <li key={s.id}>
                    <span
                      className={cn(
                        "group inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-900/60",
                        removing && "opacity-60",
                      )}
                    >
                      {s.name}
                      <button
                        type="button"
                        onClick={() => handleRemove(s)}
                        disabled={removing}
                        aria-label={`Remove ${s.name}`}
                        className={cn(
                          "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full",
                          "text-current/70 hover:bg-emerald-100 hover:text-destructive dark:hover:bg-emerald-900/40",
                          "transition-colors focus-ring",
                          removing && "cursor-not-allowed",
                        )}
                      >
                        {removing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Add form */}
        <form
          onSubmit={handleAdd}
          className="mt-5 rounded-lg border border-dashed border-border bg-muted/20 p-4"
        >
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Add subject"
                placeholder="e.g. Mathematics"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={adding}
                maxLength={80}
                error={duplicate ? "Subject already exists" : undefined}
              />
            </div>
            <Button
              type="submit"
              disabled={!canAdd}
              loading={adding}
              leftIcon={!adding ? <Plus className="h-3.5 w-3.5" /> : undefined}
            >
              Add
            </Button>
          </div>
        </form>
      </section>
    </div>
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
        Admin or staff access required
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        The Subjects catalog is restricted to admins and staff. Ask your
        school admin to grant you access if you need to manage subjects.
      </p>
    </div>
  );
}

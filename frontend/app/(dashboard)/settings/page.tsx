"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Building2,
  CalendarRange,
  GraduationCap,
  Image as ImageIcon,
  Loader2,
  Plus,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { getStoredUser, type Role } from "@/lib/auth";
import { schoolApi, resolveLogoUrl, type SchoolDto } from "@/lib/school";
import { subjectsApi, type SubjectDto } from "@/lib/subjects";
import { usersApi, type UserDto } from "@/lib/users";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { DualDate } from "@/components/calendar/DualDate";
import { cn } from "@/lib/utils";

/**
 * /settings — admin-only configuration page.
 *
 * Server-side enforcement is handled by RolesGuard (PATCH /school and
 * /users routes return 403 for non-admins). Client-side we render an
 * "Access denied" panel for non-admins so the page is friendly even if
 * a teacher follows a deep link to /settings.
 */
export default function SettingsPage() {
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

  return (
    <div className="space-y-6">
      <Header />
      <SchoolProfileSection />
      <AcademicSessionsLink />
      {/* Subjects catalog must exist before AssignmentsDialog can offer
          subject-scoped TeachingAssignments. Putting it before Users
          surfaces it during the natural admin onboarding flow. */}
      <SubjectsSection />
      <UsersSection currentUserId={getStoredUser()?.id ?? null} />
    </div>
  );
}

/**
 * Pointer card to the dedicated /settings/sessions page. Kept tiny —
 * sessions deserve a dedicated surface (CRUD + activate flow), and
 * cluttering the main settings page with a third inline manager
 * would push Users below the fold.
 */
function AcademicSessionsLink() {
  return (
    <Link
      href="/settings/sessions"
      className="block rounded-xl border border-border bg-surface p-6 hover:border-primary/40 hover:bg-muted/40 transition-colors focus-ring animate-fade-in-up"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <CalendarRange className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-md font-semibold tracking-tight text-foreground">
            Academic sessions
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage academic years and pick the one that drives new
            exams, attendance, and announcements.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">Open →</span>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------

function Header() {
  return (
    <div className="space-y-1 animate-fade-in-up">
      <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
        <ShieldCheck className="h-3 w-3" />
        Admin only
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Settings
      </h1>
      <p className="text-sm text-muted-foreground">
        Manage your school profile and the people who can sign in.
      </p>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="glass rounded-xl p-8 max-w-xl mx-auto text-center animate-fade-in-up">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
        Admin access required
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        The Settings page is restricted to school administrators. Ask
        your school admin to grant you access if you need to manage
        users or school details.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// School profile
// ---------------------------------------------------------------------------

function SchoolProfileSection() {
  const [school, setSchool] = React.useState<SchoolDto | null>(null);
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await schoolApi.get();
        if (!cancelled) {
          setSchool(s);
          setName(s.name);
        }
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Failed to load school.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = !!school && name.trim() !== school.name;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("School name can't be empty.");
      return;
    }
    setSaving(true);
    try {
      const updated = await schoolApi.update({ name: trimmed });
      setSchool(updated);
      setName(updated.name);
      toast.success("Saved successfully");
      // Sidebar greeting reads from the cached user — bump the cached
      // school name in localStorage so other pages pick it up too.
      try {
        const raw = window.localStorage.getItem("scholaris:school");
        if (raw) {
          const parsed = JSON.parse(raw);
          parsed.name = updated.name;
          window.localStorage.setItem(
            "scholaris:school",
            JSON.stringify(parsed),
          );
        }
      } catch {
        /* localStorage unavailable — non-fatal */
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to save changes.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="glass rounded-xl p-6 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Building2 className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-md font-semibold tracking-tight text-foreground">
            School profile
          </h2>
          <p className="text-sm text-muted-foreground">
            The display name printed on receipts, marksheets, and the
            workspace greeting.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-9 w-32" />
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[auto_1fr]"
        >
          <LogoEditor school={school} onChange={setSchool} />

          <div className="flex flex-col gap-3">
            <Input
              label="School name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              disabled={saving}
              hint={
                school
                  ? `Slug: ${school.slug} (cannot be changed)`
                  : undefined
              }
            />
            <div className="flex items-center gap-2">
              {/* Disabled only while a save is in flight — never stuck
                  on a dirty/clean check. handleSave is itself a no-op
                  when there's nothing to save (early return on !dirty),
                  so an extra click is harmless. */}
              <Button
                type="submit"
                loading={saving}
                disabled={saving}
                leftIcon={<Save className="h-4 w-4" />}
              >
                Save changes
              </Button>
              {dirty && !saving && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => school && setName(school.name)}
                >
                  Discard
                </Button>
              )}
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Logo upload + preview block. Lives next to the school-name field.
 *   • If a logo exists, render the image (with a Replace + Remove combo).
 *   • Otherwise render the dashed placeholder + a single Upload button.
 *
 * Owns its own loading state so the Save-changes button on the parent
 * form is independent — the user can change the name and the logo
 * separately without one blocking the other.
 */
function LogoEditor({
  school,
  onChange,
}: {
  school: SchoolDto | null;
  onChange: (next: SchoolDto) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = React.useState<"upload" | "remove" | null>(null);
  const previewUrl = resolveLogoUrl(school?.logoUrl);

  const pick = () => fileRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.type)) {
      toast.error("Logo must be a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB.");
      return;
    }
    setBusy("upload");
    try {
      const updated = await schoolApi.uploadLogo(file);
      onChange(updated);
      toast.success("Logo updated");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Logo upload failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    if (!school?.logoUrl) return;
    if (!window.confirm("Remove the school logo?")) return;
    setBusy("remove");
    try {
      const updated = await schoolApi.clearLogo();
      onChange(updated);
      toast.success("Logo removed");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to remove logo.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Logo
      </label>
      <div
        aria-label={previewUrl ? "School logo" : "School logo placeholder"}
        className={cn(
          "flex h-24 w-24 items-center justify-center rounded-lg overflow-hidden",
          previewUrl
            ? "border border-border bg-white"
            : "border-2 border-dashed border-border bg-muted/40 text-muted-foreground",
        )}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="School logo"
            className="h-full w-full object-contain"
          />
        ) : (
          <ImageIcon className="h-7 w-7" strokeWidth={1.5} />
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleFile}
        className="hidden"
      />
      <div className="flex flex-wrap items-center gap-1.5 max-w-[10rem]">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={pick}
          loading={busy === "upload"}
          disabled={busy !== null}
          leftIcon={<Upload className="h-3.5 w-3.5" />}
        >
          {previewUrl ? "Replace" : "Upload"}
        </Button>
        {previewUrl && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            loading={busy === "remove"}
            disabled={busy !== null}
            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          >
            Remove
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground italic max-w-[10rem]">
        PNG, JPG, or WebP — under 2 MB.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subjects catalog
// ---------------------------------------------------------------------------

/**
 * School-owned subject catalog (Math, Science, English, …). Subjects
 * here populate the Subject dropdown in the AssignmentsDialog on the
 * Teachers page — without entries here, admins can only create
 * "attendance only" teaching assignments.
 *
 * Backend route is admin-only (`@Roles(Role.ADMIN)` on POST/PATCH/DELETE);
 * the parent SettingsPage already gates the whole page on role.
 */
function SubjectsSection() {
  const [list, setList] = React.useState<SubjectDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  // Set instead of single id so multiple deletes can run in parallel
  // without their spinners stomping each other.
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await subjectsApi.list();
        if (!cancelled) setList(data);
      } catch (err) {
        toast.error(
          err instanceof ApiError ? err.message : "Failed to load subjects.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedDraft = draft.trim();
  // Inline duplicate detection — fire BEFORE the server returns 409 so
  // the admin gets feedback the moment they finish typing. Comparison
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
    <section className="glass rounded-xl p-6 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <BookOpen className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-md font-semibold tracking-tight text-foreground">
              Subjects
            </h2>
            {!loading && (
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                {list.length}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            The catalog teachers can be assigned to teach. Add the subjects
            taught in your school here, then use them when assigning
            teachers from the Teachers page.
          </p>
        </div>
      </div>

      {/* Existing subjects — pill list with per-pill remove */}
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
                      "group inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200/60",
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
                        "text-emerald-700/60 hover:bg-emerald-100 hover:text-destructive",
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

      {/* Add form — small input + button. Enter submits. */}
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
  );
}

function UsersSection({ currentUserId }: { currentUserId: string | null }) {
  const [list, setList] = React.useState<UserDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      setList(await usersApi.list());
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load users.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const handleRoleChange = async (user: UserDto, nextRole: Role) => {
    if (nextRole === user.role) return;
    const confirmMsg =
      user.id === currentUserId && nextRole !== "ADMIN"
        ? "Demote yourself? You'll lose admin access immediately."
        : `Change ${user.email} from ${user.role} to ${nextRole}?`;
    if (!window.confirm(confirmMsg)) return;

    setSavingId(user.id);
    // Optimistic — flip locally so the UI feels instant; roll back on error.
    const prev = list;
    setList((cur) =>
      cur.map((u) => (u.id === user.id ? { ...u, role: nextRole } : u)),
    );
    try {
      const updated = await usersApi.updateRole(user.id, { role: nextRole });
      setList((cur) =>
        cur.map((u) => (u.id === updated.id ? updated : u)),
      );
      toast.success(`${updated.email} is now ${updated.role}.`);
      // If we just demoted ourselves, the JWT still says ADMIN until
      // the next login — but server-side enforcement is what matters.
      // Update the cached role so the sidebar hides Settings on next nav.
      if (updated.id === currentUserId) {
        try {
          const raw = window.localStorage.getItem("scholaris:user");
          if (raw) {
            const parsed = JSON.parse(raw);
            parsed.role = updated.role;
            window.localStorage.setItem(
              "scholaris:user",
              JSON.stringify(parsed),
            );
          }
        } catch {
          /* non-fatal */
        }
      }
    } catch (err) {
      setList(prev);
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update role.",
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="glass rounded-xl overflow-hidden animate-fade-in-up">
      <div className="flex items-center gap-3 p-6 pb-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
          <UsersIcon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-md font-semibold tracking-tight text-foreground">
            Users &amp; roles
          </h2>
          <p className="text-sm text-muted-foreground">
            Promote teachers to admin, or demote admins back. Toggle a role
            from the dropdown — server enforces the change.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="px-6 pb-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 py-3 border-t border-border/40"
            >
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="ml-auto h-9 w-32" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="px-6 pb-6 text-sm italic text-muted-foreground">
          No users yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {list.map((u) => {
            const isMe = u.id === currentUserId;
            const isSaving = savingId === u.id;
            return (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-3 px-6 py-3.5"
              >
                <UserAvatar email={u.email} role={u.role} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-medium text-foreground truncate">
                      {u.email}
                    </span>
                    {/* "(You)" tag — plain literal text per spec, so it
                        survives copy/paste and screen-readers without
                        needing extra CSS context. Muted color keeps the
                        email itself as the primary read. */}
                    {isMe && (
                      <span className="text-sm font-medium text-primary">
                        (You)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Joined <DualDate date={u.createdAt} />
                  </p>
                </div>
                <RoleBadge role={u.role} />
                <div className="flex items-center gap-2">
                  <select
                    value={u.role}
                    onChange={(e) =>
                      handleRoleChange(u, e.target.value as Role)
                    }
                    disabled={isSaving}
                    aria-label={`Change role for ${u.email}`}
                    className={cn(
                      "h-9 rounded-md border border-border bg-surface px-2.5 text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
                      "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60",
                      "transition-colors",
                    )}
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="STAFF">Staff</option>
                    <option value="TEACHER">Teacher</option>
                  </select>
                  {isSaving && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function UserAvatar({ email, role }: { email: string; role: Role }) {
  const initial = (email[0] ?? "?").toUpperCase();
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 ring-inset",
        role === "ADMIN"
          ? "bg-primary/10 text-primary ring-primary/20"
          : "bg-muted text-muted-foreground ring-border",
      )}
    >
      {role === "ADMIN" ? (
        <ShieldCheck className="h-4 w-4" />
      ) : role === "TEACHER" ? (
        <GraduationCap className="h-4 w-4" />
      ) : (
        initial
      )}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const labels: Record<Role, string> = {
    ADMIN: "Admin",
    STAFF: "Staff",
    TEACHER: "Teacher",
    STUDENT: "Student",
    PARENT: "Parent",
  };
  const tones: Record<Role, string> = {
    ADMIN: "bg-primary/10 text-primary",
    // STAFF — calmer indigo tone so it reads as "admin-adjacent"
    // without being mistaken for full admin.
    STAFF: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    TEACHER: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    STUDENT: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    PARENT: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  };
  return (
    <span
      className={cn(
        "hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        tones[role],
      )}
    >
      {labels[role]}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

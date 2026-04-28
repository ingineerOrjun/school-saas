"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  GraduationCap,
  Image as ImageIcon,
  Loader2,
  Save,
  ShieldAlert,
  ShieldCheck,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { getStoredUser, type Role } from "@/lib/auth";
import { schoolApi, type SchoolDto } from "@/lib/school";
import { usersApi, type UserDto } from "@/lib/users";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
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
      <UsersSection currentUserId={getStoredUser()?.id ?? null} />
    </div>
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
      toast.success("School profile updated.");
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
          {/* Logo placeholder — schools can replace this slot later */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Logo
            </label>
            <div
              aria-label="School logo placeholder"
              className="flex h-24 w-24 items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/40 text-muted-foreground"
            >
              <ImageIcon className="h-7 w-7" strokeWidth={1.5} />
            </div>
            <p className="text-[11px] text-muted-foreground italic max-w-[10rem]">
              Logo upload coming soon.
            </p>
          </div>

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
              <Button
                type="submit"
                loading={saving}
                disabled={!dirty || saving}
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground truncate">
                      {u.email}
                    </span>
                    {isMe && (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                        You
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Joined {formatDate(u.createdAt)}
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
    TEACHER: "Teacher",
    STUDENT: "Student",
    PARENT: "Parent",
  };
  const tones: Record<Role, string> = {
    ADMIN: "bg-primary/10 text-primary",
    TEACHER: "bg-emerald-500/10 text-emerald-700",
    STUDENT: "bg-sky-500/10 text-sky-700",
    PARENT: "bg-amber-500/10 text-amber-700",
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

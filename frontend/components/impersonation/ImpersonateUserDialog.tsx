"use client";

import * as React from "react";
import {
  AlertTriangle,
  ShieldAlert,
  Loader2,
  ArrowRight,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type PlatformSchoolRow,
  type PlatformSchoolUser,
} from "@/lib/platform";
import { beginImpersonation, getStoredUser } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ImpersonateUserDialog — pick a school user, then sign in as them.
//
// Why a custom dialog (not the existing <Modal>):
//   • <Modal> sits in the school dashboard's component tree; the
//     /platform layout is a separate visual language (slate + dark
//     topbar) and its modal should match. Using <Modal> would leak
//     the school-side glass / primary-color treatment into the
//     platform area.
//   • Keeps the platform package self-contained — no cross-tree
//     primitive dependency.
//
// UX rules:
//   • Two-step confirmation isn't needed because this isn't
//     destructive. The destructive direction is "exit
//     impersonation" — that's instant (one click). Entering is the
//     reversible direction.
//   • A prominent warning is shown anyway: the operator should know
//     they're about to leave the platform area and that all writes
//     during the session will be attributed to the target user.
// ---------------------------------------------------------------------------

export function ImpersonateUserDialog({
  school,
  onClose,
}: {
  school: PlatformSchoolRow | null;
  onClose: () => void;
}) {
  const [users, setUsers] = React.useState<PlatformSchoolUser[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<string | null>(null);

  // Reset + reload when the school target changes.
  React.useEffect(() => {
    if (!school) {
      setUsers(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setUsers(null);
    setError(null);
    platformApi
      .listSchoolUsers(school.id)
      .then((rows) => {
        if (!cancelled) setUsers(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load school users.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [school]);

  // Esc closes — same parity contract as other dialogs.
  React.useEffect(() => {
    if (!school) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [school, submitting, onClose]);

  if (!school) return null;

  const handlePick = async (user: PlatformSchoolUser) => {
    if (submitting) return;
    setSubmitting(user.id);
    try {
      const res = await platformApi.startImpersonation(user.id);
      // Snapshot the SUPER_ADMIN's identity BEFORE we swap tokens —
      // once `beginImpersonation` runs, `getStoredUser()` returns
      // the target, not the SUPER_ADMIN.
      const me = getStoredUser();
      if (!me) {
        toast.error("Session lost. Please sign in again.");
        window.location.assign("/login");
        return;
      }
      beginImpersonation({
        accessToken: res.accessToken,
        targetUser: {
          id: res.user.id,
          email: res.user.email,
          // Backend returns role as the broader Prisma enum string;
          // for client-side gating we narrow to the frontend Role
          // type. The backend rejects SUPER_ADMIN targets, so this
          // never lands as the platform-tier role here.
          role: res.user.role as
            | "ADMIN"
            | "STAFF"
            | "TEACHER"
            | "STUDENT"
            | "PARENT",
          schoolId: res.user.schoolId,
        },
        school: {
          id: res.school.id,
          name: res.school.name,
          slug: res.school.slug,
        },
        startedAt: res.startedAt,
        impersonator: { id: me.id, email: me.email },
      });
      toast.success(`Now viewing as ${res.user.email}`);
      // Hard navigate so the dashboard layout, sidebar, and topbar
      // all rehydrate from the new token. Soft routing would leave
      // sidebar role-gates pointing at the old (SUPER_ADMIN) cache.
      window.location.assign("/dashboard");
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Failed to start impersonation.";
      toast.error(message);
      setSubmitting(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-fade-in-up"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Sign in as admin
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 truncate">
              Pick a user at <span className="font-medium">{school.name}</span>
              {" · "}
              <span className="font-mono">{school.slug}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={!!submitting}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto">
          {error ? (
            <div className="m-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {error}
              </div>
            </div>
          ) : !users ? (
            <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
            </div>
          ) : users.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">
              No users yet — this school has no admin to impersonate.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(u)}
                    disabled={!!submitting}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50 disabled:opacity-60 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {u.email}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        {u.role}
                      </div>
                    </div>
                    {submitting === u.id ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" />
                    ) : (
                      <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-200 bg-amber-50/40 px-5 py-3">
          <div className="flex items-start gap-2 text-xs text-amber-900">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Every action you take while impersonating is attributed to the
              target user in their own audit trail. Your impersonation session
              start is recorded in the platform audit log.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

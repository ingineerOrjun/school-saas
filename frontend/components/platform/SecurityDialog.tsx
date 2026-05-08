"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  platformApi,
  type PlatformSchoolRow,
  type PlatformSchoolUser,
  type ResetPasswordResult,
} from "@/lib/platform";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// SecurityDialog — Phase 9.
//
// Two-pane operator-tier panel for a single school:
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ Force logout (school-wide)                               │
//   │ Reason* [............................] [Force logout all]│
//   ├──────────────────────────────────────────────────────────┤
//   │ Per-user actions                                          │
//   │ alice@example.edu  ADMIN   [Logout] [Reset password]     │
//   │ bob@example.edu    TEACHER [Logout] [Reset password]     │
//   │  …                                                        │
//   └──────────────────────────────────────────────────────────┘
//
// Reset-password sub-flow:
//   On success the API returns a plaintext temp password. We pop
//   a sub-modal showing it with a one-tap "Copy" button and an
//   explicit warning ("close this and it's gone"). The user must
//   acknowledge before the sub-modal dismisses.
//
// Force-logout-all guards:
//   • Reason input is required client-side (backend re-enforces).
//   • A "Type SCHOOL_NAME to confirm" gate prevents fat-finger
//     incident responses on the wrong tenant.
// ---------------------------------------------------------------------------

export function SecurityDialog({
  school,
  onClose,
}: {
  school: PlatformSchoolRow | null;
  onClose: () => void;
}) {
  const [users, setUsers] = React.useState<PlatformSchoolUser[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  /** Per-user submitting set: keyed by user id, value is which action. */
  const [pending, setPending] = React.useState<
    Record<string, "logout" | "reset" | undefined>
  >({});

  /** Plaintext temp password to surface in the sub-modal. */
  const [resetResult, setResetResult] = React.useState<
    | (ResetPasswordResult & { schoolName: string })
    | null
  >(null);

  // School-wide force-logout state.
  const [allReason, setAllReason] = React.useState("");
  const [allConfirmName, setAllConfirmName] = React.useState("");
  const [allSubmitting, setAllSubmitting] = React.useState(false);

  // Reset + reload when the school target changes.
  React.useEffect(() => {
    if (!school) {
      setUsers(null);
      setLoadError(null);
      setAllReason("");
      setAllConfirmName("");
      setPending({});
      setResetResult(null);
      return;
    }
    let cancelled = false;
    setUsers(null);
    setLoadError(null);
    platformApi
      .listSchoolUsers(school.id)
      .then((rows) => {
        if (!cancelled) setUsers(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "Failed to load school users.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [school]);

  // Esc closes (only when no reset-result sub-modal is open — that
  // one has its own dismiss flow).
  React.useEffect(() => {
    if (!school) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !resetResult) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [school, resetResult, onClose]);

  if (!school) return null;

  const canForceLogoutAll =
    allReason.trim().length >= 3 &&
    allConfirmName.trim() === school.name &&
    !allSubmitting;

  const handleForceLogoutAll = async () => {
    if (!canForceLogoutAll) return;
    setAllSubmitting(true);
    try {
      const result = await platformApi.forceLogoutSchool(
        school.id,
        allReason.trim(),
      );
      toast.success(
        `Logged out ${result.affectedCount} user${
          result.affectedCount === 1 ? "" : "s"
        } at ${school.name}.`,
      );
      setAllReason("");
      setAllConfirmName("");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to force logout.",
      );
    } finally {
      setAllSubmitting(false);
    }
  };

  const handleUserLogout = async (u: PlatformSchoolUser) => {
    setPending((p) => ({ ...p, [u.id]: "logout" }));
    try {
      await platformApi.forceLogoutUser(u.id);
      toast.success(`Logged out ${u.email}.`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to force logout.",
      );
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[u.id];
        return next;
      });
    }
  };

  const handleUserReset = async (u: PlatformSchoolUser) => {
    setPending((p) => ({ ...p, [u.id]: "reset" }));
    try {
      const result = await platformApi.resetUserPassword(u.id);
      // Don't toast — the sub-modal IS the result surface. A toast
      // would compete for attention with the temp password.
      setResetResult({ ...result, schoolName: school.name });
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Failed to reset password.",
      );
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[u.id];
        return next;
      });
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="w-full max-w-2xl rounded-xl bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md bg-red-50 text-red-600">
                <ShieldAlert className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Security controls — {school.name}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Force-logout users, reset passwords. Every action is
                  audited.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {/* School-wide hammer */}
          <section className="border-b border-slate-200 bg-red-50/30 px-5 py-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-slate-900">
                  Force-logout all users
                </h3>
                <p className="mt-0.5 text-xs text-slate-600">
                  Invalidates every existing session at this school. Users
                  must sign in again. SUPER_ADMINs are not affected.
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Reason <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={allReason}
                  onChange={(e) => setAllReason(e.target.value)}
                  placeholder="e.g. Suspected credential leak — incident #1234"
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">
                  Type <span className="font-mono text-slate-900">{school.name}</span> to confirm
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={allConfirmName}
                    onChange={(e) => setAllConfirmName(e.target.value)}
                    placeholder={school.name}
                    className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
                  />
                  <button
                    type="button"
                    onClick={handleForceLogoutAll}
                    disabled={!canForceLogoutAll}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-white transition-colors",
                      canForceLogoutAll
                        ? "bg-red-600 hover:bg-red-700"
                        : "bg-slate-300 cursor-not-allowed",
                    )}
                  >
                    {allSubmitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LogOut className="h-3.5 w-3.5" />
                    )}
                    Force logout all
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Per-user table */}
          <section className="px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Per-user actions
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Force-logout one user, or reset their password to a temporary
              one. Reset returns the new password ONCE — copy it before
              closing.
            </p>

            {loadError && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {loadError}
              </div>
            )}

            {!users && !loadError && (
              <div className="mt-3 flex h-32 items-center justify-center text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}

            {users && users.length === 0 && (
              <p className="mt-3 text-xs text-slate-500 italic">
                No users at this school.
              </p>
            )}

            {users && users.length > 0 && (
              <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">
                        Email
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">
                        Role
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-slate-600">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          {u.email}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                            {u.role}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleUserLogout(u)}
                              disabled={!!pending[u.id]}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                              title="Force-logout this user"
                            >
                              {pending[u.id] === "logout" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <LogOut className="h-3 w-3" />
                              )}
                              Logout
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUserReset(u)}
                              disabled={!!pending[u.id]}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-red-400 hover:bg-red-50 disabled:opacity-50 transition-colors"
                              title="Reset password to a temporary one"
                            >
                              {pending[u.id] === "reset" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <KeyRound className="h-3 w-3" />
                              )}
                              Reset password
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </footer>
        </div>
      </div>

      {resetResult && (
        <ResetPasswordResultModal
          result={resetResult}
          onClose={() => setResetResult(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ResetPasswordResultModal — surfaces the temp password ONCE.
// ---------------------------------------------------------------------------

function ResetPasswordResultModal({
  result,
  onClose,
}: {
  result: ResetPasswordResult & { schoolName: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const [acknowledged, setAcknowledged] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
      toast.success("Copied to clipboard.");
      // Reset the green checkmark after a beat — the operator may
      // copy more than once if they're sharing across channels.
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy. Select and copy manually.");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
            <Check className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Password reset for {result.user.email}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Share this temporary password out-of-band. Once this dialog
              closes it can't be recovered.
            </p>
          </div>
        </header>

        <section className="px-5 py-4">
          <label className="block text-[11px] font-medium text-slate-600">
            Temporary password
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="flex-1 select-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm tracking-wider text-slate-900">
              {result.temporaryPassword}
            </code>
            <button
              type="button"
              onClick={copy}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
                copied
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-900 text-white hover:bg-slate-800",
              )}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="font-semibold">What happens next</p>
            <ul className="mt-1 list-disc pl-4">
              <li>Existing sessions for this user have been invalidated.</li>
              <li>
                Share the password through a trusted channel (phone, in
                person). Don't email it.
              </li>
              <li>The user should change it on first login.</li>
            </ul>
          </div>

          <label className="mt-4 flex items-start gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
            />
            <span>
              I've copied the temporary password and understand it cannot
              be recovered after this dialog closes.
            </span>
          </label>
        </section>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={!acknowledged}
            className={cn(
              "inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold transition-colors",
              acknowledged
                ? "bg-slate-900 text-white hover:bg-slate-800"
                : "bg-slate-200 text-slate-400 cursor-not-allowed",
            )}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

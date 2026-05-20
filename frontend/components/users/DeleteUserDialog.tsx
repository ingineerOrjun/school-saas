"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useDeleteUser, type UserDto } from "@/lib/users";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

// ============================================================================
// Session 6c.2 — DeleteUserDialog
//
// Confirmation modal for soft-deleting a user. Per the locked design
// decisions:
//
//   • Checkbox confirmation (NOT type-to-confirm). Lower friction
//     than DeleteTeacherDialog's typed mode because the affected
//     blast radius is smaller — the User row stays in the DB and
//     every historical-record FK keeps resolving. The checkbox
//     prevents fat-finger accidents on the destructive button while
//     not punishing operators doing legitimate cleanup.
//
//   • Wait-and-refresh (NOT optimistic delete). The dialog stays
//     open with a spinner during the in-flight DELETE; on success
//     the parent's invalidation triggers a refetch and the row
//     leaves the list when the refetch returns. Security-sensitive
//     write — brief spinner reads more reliably than instant
//     disappearance.
//
//   • Inline error rendering (NOT toast). 409 in particular carries
//     the backend's verbatim "N active assignments" message; that
//     belongs inside the modal so the operator can read it next to
//     the action they just attempted, then click Cancel + unassign.
//     Success path uses a toast (the modal closes; nowhere else to
//     surface the confirmation).
// ============================================================================

export interface DeleteUserDialogProps {
  /**
   * The user to be deleted. Null when the dialog isn't open; the
   * parent toggles open by passing the row's user, closes by
   * clearing it back to null.
   */
  user: UserDto | null;
  onClose: () => void;
  /**
   * Called after a successful delete + after the dialog closes.
   * Parent uses this for redirect / refresh side effects (the
   * mutation hook already invalidates `qk.users()`; this hook is
   * for parent-specific work like the Settings page's imperative
   * `refresh()`).
   */
  onSuccess?: () => void;
}

export function DeleteUserDialog({
  user,
  onClose,
  onSuccess,
}: DeleteUserDialogProps) {
  const [confirmed, setConfirmed] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const deleteUser = useDeleteUser();

  const open = user !== null;
  const isPending = deleteUser.isPending;

  // Reset state every time the dialog reopens for a different user.
  // Without this, a previous attempt's error or "checked" state would
  // leak into the next open.
  React.useEffect(() => {
    if (open) {
      setConfirmed(false);
      setInlineError(null);
    }
  }, [open, user?.id]);

  // 404 close-on-delay. When the backend says the user is gone,
  // there's nothing to keep the modal open for — auto-close after
  // a brief read window. Kept short (2s) to match the spec.
  React.useEffect(() => {
    if (inlineError !== USER_GONE_MESSAGE) return;
    const t = window.setTimeout(() => {
      onClose();
      onSuccess?.();
    }, 2000);
    return () => window.clearTimeout(t);
  }, [inlineError, onClose, onSuccess]);

  // Swallow close attempts during the in-flight DELETE so a stray
  // overlay click can't dismiss mid-write.
  const handleClose = React.useCallback(() => {
    if (isPending) return;
    onClose();
  }, [isPending, onClose]);

  const handleConfirm = () => {
    if (!user || !confirmed || isPending) return;
    setInlineError(null);
    deleteUser.mutate(user.id, {
      onSuccess: () => {
        toast.success("User deactivated");
        onClose();
        onSuccess?.();
      },
      onError: (err) => {
        setInlineError(messageForError(err));
      },
    });
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Delete user
            </h2>
            {user && (
              <p className="text-sm text-foreground">
                <span className="font-medium">{user.email}</span>
              </p>
            )}
            <p className="text-sm text-muted-foreground leading-relaxed">
              This user will lose access to the system immediately.
              Historical records (class evaluations, attendance, etc.)
              will be preserved with attribution to this user.
            </p>
          </div>
        </div>

        {/* Checkbox confirmation — gated until ticked. */}
        <label
          className={cn(
            "ml-14 flex cursor-pointer items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm",
            "hover:bg-muted/50 transition-colors",
            isPending && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={isPending}
            // Plain native checkbox — the focus ring on the surrounding
            // label is enough; no design-system Checkbox primitive in
            // the codebase to wire here.
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-destructive disabled:cursor-not-allowed"
          />
          <span className="leading-snug text-foreground">
            I understand this user will lose access immediately.
          </span>
        </label>

        {inlineError && (
          <div
            role="alert"
            className="ml-14 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {inlineError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!confirmed || isPending}
            leftIcon={
              isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : undefined
            }
          >
            Delete user
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Error-to-message mapping.
//
// 409 is the SPECIAL case — the backend's message is admin-friendly
// and dynamic ("This user has N active teaching assignments...").
// We surface it verbatim per the locked design decision.
//
// 403 / 404 / network errors are rewritten to fit the modal's tone.
// Other failure classes (5xx, unparseable) fall back to the error's
// own message or a generic copy.
// ---------------------------------------------------------------------------

const USER_GONE_MESSAGE = "This user no longer exists.";

function messageForError(err: ApiError): string {
  switch (err.status) {
    case 409:
      // Verbatim from the backend — already operator-friendly:
      // "This user has N active teaching assignments. Unassign them
      // before deletion." OR "User is already deactivated."
      return err.message;
    case 403:
      return "You don't have permission to delete this user.";
    case 404:
      return USER_GONE_MESSAGE;
    default:
      return err.message || "Couldn't delete user.";
  }
}

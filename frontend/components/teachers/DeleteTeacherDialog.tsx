"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useDeleteTeacher, type TeacherDto } from "@/lib/teachers";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

// ============================================================================
// Session 6c.3 — DeleteTeacherDialog (rewritten).
//
// Before: a thin wrapper over `ConfirmDestructiveActionDialog` with
// type-the-teacher's-name confirmation, calling back into the parent's
// optimistic-undo `scheduleDelete` flow.
//
// After: a fresh dialog that mirrors `DeleteUserDialog` exactly. Same
// blast radius (User row gets `deletedAt`; Teacher row stays), same
// confirmation UX (checkbox + inline errors + success toast), same
// wait-and-refresh shape (the dialog owns the mutation; parent passes
// `onSuccess` for refresh + redirect side effects).
//
// Why the rewrite (not a patch on the old shell):
//   • The old dialog kept a `typedConfirmation` shape baked into a
//     primitive that doesn't support checkbox-confirm. Adding a third
//     mode to ConfirmDestructiveActionDialog would muddy its API.
//   • The new error UX (inline 409 with the backend's verbatim count)
//     requires the dialog to know the mutation state, which the old
//     "parent calls onConfirm + optimistically removes the row + maybe
//     restores on catch" pattern can't deliver cleanly.
// ============================================================================

export interface DeleteTeacherDialogProps {
  /**
   * The teacher to be deleted. Null when the dialog isn't open; the
   * parent toggles open by passing the row's teacher, closes by
   * clearing it back to null.
   */
  teacher: TeacherDto | null;
  onClose: () => void;
  /**
   * Called after a successful delete + after the dialog closes.
   * Parent uses this for refresh side effects (the mutation hook
   * already invalidates `qk.teachers()` + `qk.users()`; this hook
   * is for parent-specific work like the existing imperative
   * `refresh()` on the teachers page).
   */
  onSuccess?: () => void;
}

export function DeleteTeacherDialog({
  teacher,
  onClose,
  onSuccess,
}: DeleteTeacherDialogProps) {
  const [confirmed, setConfirmed] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const deleteTeacher = useDeleteTeacher();

  const open = teacher !== null;
  const isPending = deleteTeacher.isPending;

  // Reset state every time the dialog reopens for a different teacher.
  React.useEffect(() => {
    if (open) {
      setConfirmed(false);
      setInlineError(null);
    }
  }, [open, teacher?.id]);

  // 404 close-on-delay. When the backend says the teacher's User is
  // gone, there's nothing to keep the modal open for — auto-close
  // after a brief read window.
  React.useEffect(() => {
    if (inlineError !== TEACHER_GONE_MESSAGE) return;
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
    if (!teacher || !confirmed || isPending) return;
    setInlineError(null);
    deleteTeacher.mutate(teacher.id, {
      onSuccess: () => {
        toast.success("Teacher deactivated");
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
              Delete teacher
            </h2>
            {teacher && (
              <p className="text-sm text-foreground">
                <span className="font-medium">{teacher.name}</span>
              </p>
            )}
            <p className="text-sm text-muted-foreground leading-relaxed">
              This teacher will lose access to the system immediately.
              Historical records (class evaluations, attendance, etc.)
              will be preserved with attribution to this teacher.
            </p>
          </div>
        </div>

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
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-destructive disabled:cursor-not-allowed"
          />
          <span className="leading-snug text-foreground">
            I understand this teacher will lose access immediately.
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
            Delete teacher
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Error-to-message mapping (mirrors DeleteUserDialog).
//
// 409 surfaces VERBATIM — the backend's message is already operator-
// friendly ("This user has N active teaching assignments. Unassign
// them before deletion.") and the count is part of the value.
//
// 403 / 404 are rewritten to fit the modal's tone. Other failures
// fall back to the error's message or a generic copy.
// ---------------------------------------------------------------------------

const TEACHER_GONE_MESSAGE = "This teacher no longer exists.";

function messageForError(err: ApiError): string {
  switch (err.status) {
    case 409:
      return err.message;
    case 403:
      return "You don't have permission to delete this teacher.";
    case 404:
      return TEACHER_GONE_MESSAGE;
    default:
      return err.message || "Couldn't delete teacher.";
  }
}

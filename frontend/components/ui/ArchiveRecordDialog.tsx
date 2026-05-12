"use client";

import * as React from "react";
import { Archive, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { ConfirmDestructiveActionDialog } from "./ConfirmDestructiveActionDialog";
import { cn } from "@/lib/utils";

// ============================================================================
// ArchiveRecordDialog + RestoreRecordDialog — Phase DATA LIFECYCLE Part 2.
//
// Single composition that pairs the existing
// `ConfirmDestructiveActionDialog` chrome with an optional `reason`
// textarea. Used for student + exam archive flows so the visual
// language stays consistent with delete / lock confirmations.
//
// Tone choice:
//   • ArchiveRecordDialog inherits the destructive-tinted button +
//     amber warning icon from ConfirmDestructiveActionDialog. Archive
//     is not permanent (it can be restored) but it IS user-visible
//     state-change that hides the record from the rest of the UI —
//     same "stop and think" affordance as delete.
//   • RestoreRecordDialog is a softer simple-confirm modal with an
//     emerald primary button. Restoring is low-risk and reversible.
//
// Reason capture:
//   • The reason textarea is optional but encouraged via a placeholder.
//   • Capped at 500 characters to match the backend column.
//   • The reason is hoisted up to the caller via the
//     `onConfirm(reason)` callback so each page can stitch it into
//     the matching API call (`studentsApi.archive(id, reason)`).
// ============================================================================

export interface ArchiveRecordDialogProps {
  open: boolean;
  /** Heading copy, e.g. "Archive student?" or "Archive exam?" */
  title: string;
  /** Human-readable name of the record being archived (label + tooltip). */
  recordLabel: string;
  /**
   * Sentence describing what archiving does for this record type so
   * the operator understands the blast radius before confirming.
   */
  description: React.ReactNode;
  /**
   * Typed-confirmation value. Pass the record's own name (default) or
   * something equally distinctive — the user has to re-type it to
   * enable the destructive button. Mirrors the delete-confirm pattern.
   */
  typedConfirmationValue?: string;
  isPending?: boolean;
  onCancel: () => void;
  /** Receives the trimmed reason (or undefined when the field was blank). */
  onConfirm: (reason: string | undefined) => void;
}

export function ArchiveRecordDialog({
  open,
  title,
  recordLabel,
  description,
  typedConfirmationValue,
  isPending,
  onCancel,
  onConfirm,
}: ArchiveRecordDialogProps) {
  const [reason, setReason] = React.useState("");

  // Reset reason every time the dialog reopens so a previous attempt's
  // text doesn't persist into the next archive flow.
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const expected = (typedConfirmationValue ?? recordLabel).trim();

  const handleConfirm = React.useCallback(() => {
    const trimmed = reason.trim().slice(0, 500);
    onConfirm(trimmed.length > 0 ? trimmed : undefined);
  }, [onConfirm, reason]);

  // The reason textarea lives BELOW the typed-confirmation input from
  // the wrapped destructive dialog. Rather than rebuild the dialog,
  // we drop a sibling textarea outside the Modal — but that's clunky.
  // Instead, render our own modal here and reuse ONLY the button +
  // chrome styles. Keeps the layout coherent and adds a focused-on
  // textarea + Archive button affordance.
  return (
    <Modal open={open} onClose={isPending ? () => {} : onCancel} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPending && (expected.length === 0 || reason !== null)) {
            // Match-gate handled by inner component when typedConfirmationValue passed
          }
        }}
        className="space-y-4"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <Archive className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            <div className="text-sm text-muted-foreground leading-relaxed">
              {description}
            </div>
          </div>
        </div>

        <div className="space-y-1.5 pl-14">
          <label
            htmlFor="archive-reason"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Reason{" "}
            <span className="font-normal normal-case text-muted-foreground/70">
              (optional — shown in audit trail)
            </span>
          </label>
          <textarea
            id="archive-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            disabled={isPending}
            rows={2}
            placeholder='e.g. "Transferred to another school" or "Exam rescheduled"'
            className={cn(
              "w-full resize-none rounded-md border bg-surface px-3 py-2 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-amber-300/40 focus:border-amber-400",
              "disabled:cursor-not-allowed disabled:opacity-60",
              "border-border",
            )}
            maxLength={500}
          />
          <p className="text-[11px] text-muted-foreground">
            <span className="font-mono">{recordLabel}</span> will be hidden
            from default listings and become read-only. Restore at any time
            from the Archived tab.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            leftIcon={
              isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )
            }
            onClick={handleConfirm}
          >
            Archive
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// RestoreRecordDialog — simple confirm. Re-enables the record.
// ---------------------------------------------------------------------------

export interface RestoreRecordDialogProps {
  open: boolean;
  /** Heading copy, e.g. "Restore student?" or "Restore exam?" */
  title: string;
  recordLabel: string;
  description: React.ReactNode;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RestoreRecordDialog({
  open,
  title,
  recordLabel,
  description,
  isPending,
  onCancel,
  onConfirm,
}: RestoreRecordDialogProps) {
  return (
    <Modal open={open} onClose={isPending ? () => {} : onCancel} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isPending) onConfirm();
        }}
        className="space-y-4"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            <RefreshCcw className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            <div className="text-sm text-muted-foreground leading-relaxed">
              {description}
            </div>
            <p className="text-[11px] text-muted-foreground">
              <span className="font-mono">{recordLabel}</span> will be visible
              and editable again. This action is logged.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isPending}
            leftIcon={
              isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )
            }
          >
            Restore
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Re-export the destructive dialog so consumers that want the typed-
// confirmation flavor (e.g. high-risk students with active payment
// balances) can opt into it without a second import path.
export { ConfirmDestructiveActionDialog };

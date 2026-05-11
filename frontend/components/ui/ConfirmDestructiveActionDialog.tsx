"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { cn } from "@/lib/utils";

// ============================================================================
// ConfirmDestructiveActionDialog — single source of truth for "are you
// sure?" prompts on irreversible school-side actions.
//
// Two modes (per Phase data-integrity Rule 4):
//
//   • Simple-confirm — the default. One click on the destructive
//     button after reading the warning. Use for medium-risk actions
//     like "lock this academic session" or "promote students".
//
//   • Typed-confirmation — pass `typedConfirmation`. The user must
//     re-type a known string (DELETE, the student's name, the
//     payment receipt number, …) before the destructive button
//     enables. Use for high-risk irreversible actions: delete
//     student, refund payment, bulk overwrite attendance.
//
// Async safety (Phase data-integrity Rule 3):
//   • While `isPending` is true, both Cancel and Confirm are disabled.
//   • The Confirm button shows a spinner.
//   • The Enter key in the typed-confirmation input does NOT submit
//     unless the typed value matches the expected string AND we're
//     not pending.
//   • The dialog cannot be closed (overlay click + Escape are no-ops)
//     while pending — Modal accepts onClose; we wrap it.
//
// Accessibility:
//   • The destructive button is the default Tab focus when the
//     dialog opens (simple mode) or the typed input is autofocused
//     (typed mode).
//   • Form-level submit handler intercepts Enter so the Modal's
//     onClose isn't accidentally invoked.
//
// Styling consistency:
//   • Reuses the existing Modal + Button (variant="destructive")
//     primitives. No new visual language — the standard amber
//     warning icon + destructive-tinted button.
// ============================================================================

export interface TypedConfirmationConfig {
  /** Label shown above the input. */
  label: string;
  /**
   * The exact string the user must type to enable the destructive
   * button. Compared case-sensitively after trimming. Examples:
   * "DELETE", the student's full name, a payment receipt number.
   */
  expectedValue: string;
  /** Placeholder for the input. Defaults to the expected value. */
  placeholder?: string;
}

export interface ConfirmDestructiveActionDialogProps {
  open: boolean;
  /** Heading. Should clearly name the action ("Delete student?"). */
  title: string;
  /**
   * Explanation. Spell out what's irreversible. Plain string OR a
   * ReactNode if you need to embed names / counts as styled spans.
   */
  description: React.ReactNode;
  /**
   * High-risk actions: pass this to require re-typing a known string.
   * Omit for medium-risk simple-confirm flows.
   */
  typedConfirmation?: TypedConfirmationConfig;
  /** Confirm button label. Defaults to "Delete". */
  confirmLabel?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Mutation pending. While true: both buttons are disabled, the
   * confirm button shows a spinner, and the dialog itself cannot
   * be dismissed by overlay click / Escape (the in-flight write
   * must complete first).
   */
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDestructiveActionDialog({
  open,
  title,
  description,
  typedConfirmation,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  isPending = false,
  onCancel,
  onConfirm,
}: ConfirmDestructiveActionDialogProps) {
  const [typedValue, setTypedValue] = React.useState("");

  // Reset the typed-confirmation field every time the dialog reopens
  // so the previous attempt's text doesn't persist across reopens.
  // The typedConfirmation reference dependency is intentional —
  // changing the expected value mid-dialog (rare but legal) also
  // clears the field.
  React.useEffect(() => {
    if (open) setTypedValue("");
  }, [open, typedConfirmation?.expectedValue]);

  const requiresTyping = typedConfirmation !== undefined;
  const typedMatches =
    !requiresTyping ||
    typedValue.trim() === typedConfirmation!.expectedValue.trim();
  const canConfirm = !isPending && typedMatches;

  // While pending, swallow close attempts so the user can't dismiss
  // mid-write (clicking the overlay or pressing Escape would call
  // onClose). The destructive write must complete first.
  const handleClose = React.useCallback(() => {
    if (isPending) return;
    onCancel();
  }, [isPending, onCancel]);

  // Form submit — single source of truth for confirmation. Both
  // pressing Enter in the typed input AND clicking the destructive
  // button route through here, so the typedMatches gate is enforced
  // identically on every path.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canConfirm) return;
    onConfirm();
  };

  return (
    <Modal open={open} onClose={handleClose} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
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

        {requiresTyping && (
          <div className="space-y-1.5 pl-14">
            <label
              htmlFor="confirm-destructive-typed"
              className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {typedConfirmation!.label}
            </label>
            <input
              id="confirm-destructive-typed"
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              disabled={isPending}
              autoFocus
              placeholder={
                typedConfirmation!.placeholder ??
                typedConfirmation!.expectedValue
              }
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "h-9 w-full rounded-md border bg-surface px-3 text-sm tabular-nums",
                "focus:outline-none focus:ring-2 focus:ring-destructive/30 focus:border-destructive",
                "disabled:cursor-not-allowed disabled:opacity-60",
                typedMatches && typedValue.length > 0
                  ? "border-destructive/40"
                  : "border-border",
              )}
              aria-describedby="confirm-destructive-hint"
            />
            <p
              id="confirm-destructive-hint"
              className="text-[11px] text-muted-foreground"
            >
              Type{" "}
              <span className="font-mono text-foreground">
                {typedConfirmation!.expectedValue}
              </span>{" "}
              exactly to enable the {confirmLabel.toLowerCase()} button.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant="destructive"
            disabled={!canConfirm}
            leftIcon={
              isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined
            }
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

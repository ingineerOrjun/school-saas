"use client";

import * as React from "react";
import type { StudentDto } from "@/lib/students";
import { ConfirmDestructiveActionDialog } from "@/components/ui/ConfirmDestructiveActionDialog";

export interface DeleteStudentDialogProps {
  student: StudentDto | null;
  onClose: () => void;
  /**
   * Confirm the deletion. The parent is responsible for running any exit
   * animation, scheduling the backend call, and showing an undo affordance.
   */
  onConfirm: (student: StudentDto) => void;
  /**
   * Optional pending flag — passed by the parent when the deletion's
   * actual backend mutation is in flight (mutation.isPending). While
   * true the dialog disables both buttons + the typed input, and the
   * confirm button shows a spinner. Defaults to false (immediate
   * close pattern from the legacy "schedule delete then undo" flow).
   */
  isPending?: boolean;
}

/**
 * Thin wrapper around the platform's shared ConfirmDestructiveActionDialog
 * primitive. Phase data-integrity Rule 4: deleting a student is
 * high-risk + irreversible, so we require the operator to type the
 * student's full name to enable the destructive button. Prevents
 * accidental deletion of the wrong row when the admin is hurrying
 * through a roster cleanup.
 */
export function DeleteStudentDialog({
  student,
  onClose,
  onConfirm,
  isPending = false,
}: DeleteStudentDialogProps) {
  const fullName = student
    ? `${student.firstName} ${student.lastName}`.trim()
    : "";
  const handleConfirm = () => {
    if (!student) return;
    onConfirm(student);
    // Legacy contract — the parent's undo flow expects the dialog to
    // close immediately so the snackbar can take over. Skip when
    // isPending is set (parent is awaiting the mutation; close on
    // success in that flow).
    if (!isPending) onClose();
  };
  return (
    <ConfirmDestructiveActionDialog
      open={student !== null}
      title="Delete student?"
      description={
        <>
          This will remove{" "}
          <span className="font-medium text-foreground">{fullName}</span> from
          your school. The action is reversible only via the undo affordance
          shown immediately after — once that disappears, the row is gone
          for good.
        </>
      }
      typedConfirmation={
        student
          ? {
              label: `Type the student's full name to confirm`,
              expectedValue: fullName,
              placeholder: fullName,
            }
          : undefined
      }
      confirmLabel="Delete student"
      isPending={isPending}
      onCancel={onClose}
      onConfirm={handleConfirm}
    />
  );
}

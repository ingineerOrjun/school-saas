"use client";

import * as React from "react";
import type { TeacherDto } from "@/lib/teachers";
import { ConfirmDestructiveActionDialog } from "@/components/ui/ConfirmDestructiveActionDialog";

export interface DeleteTeacherDialogProps {
  teacher: TeacherDto | null;
  onClose: () => void;
  onConfirm: (teacher: TeacherDto) => void;
  /** Pending flag from the parent's mutation; see DeleteStudentDialog. */
  isPending?: boolean;
}

/**
 * Phase data-integrity Rule 4: deleting a teacher is high-risk
 * (cascades into TeachingAssignment, can orphan classes mid-session),
 * so we require typing the teacher's name to enable the destructive
 * button. Wraps the shared ConfirmDestructiveActionDialog primitive.
 */
export function DeleteTeacherDialog({
  teacher,
  onClose,
  onConfirm,
  isPending = false,
}: DeleteTeacherDialogProps) {
  const handleConfirm = () => {
    if (!teacher) return;
    onConfirm(teacher);
    if (!isPending) onClose();
  };
  return (
    <ConfirmDestructiveActionDialog
      open={teacher !== null}
      title="Delete teacher?"
      description={
        <>
          This will remove{" "}
          <span className="font-medium text-foreground">{teacher?.name}</span>{" "}
          from your school and detach every class / subject they were
          assigned to. The undo affordance disappears after a few seconds.
        </>
      }
      typedConfirmation={
        teacher
          ? {
              label: `Type the teacher's name to confirm`,
              expectedValue: teacher.name,
              placeholder: teacher.name,
            }
          : undefined
      }
      confirmLabel="Delete teacher"
      isPending={isPending}
      onCancel={onClose}
      onConfirm={handleConfirm}
    />
  );
}

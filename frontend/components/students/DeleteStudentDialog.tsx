"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { StudentDto } from "@/lib/students";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface DeleteStudentDialogProps {
  student: StudentDto | null;
  onClose: () => void;
  /**
   * Confirm the deletion. The parent is responsible for running any exit
   * animation, scheduling the backend call, and showing an undo affordance.
   */
  onConfirm: (student: StudentDto) => void;
}

export function DeleteStudentDialog({
  student,
  onClose,
  onConfirm,
}: DeleteStudentDialogProps) {
  const handleConfirm = () => {
    if (!student) return;
    onConfirm(student);
    onClose();
  };

  return (
    <Modal
      open={student !== null}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            type="button"
          >
            Delete student
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Delete student?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This will remove{" "}
            <span className="font-medium text-foreground">
              {student?.firstName} {student?.lastName}
            </span>{" "}
            from your school. You&apos;ll have a few seconds to undo.
          </p>
        </div>
      </div>
    </Modal>
  );
}

"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import type { TeacherDto } from "@/lib/teachers";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface DeleteTeacherDialogProps {
  teacher: TeacherDto | null;
  onClose: () => void;
  onConfirm: (teacher: TeacherDto) => void;
}

export function DeleteTeacherDialog({
  teacher,
  onClose,
  onConfirm,
}: DeleteTeacherDialogProps) {
  const handleConfirm = () => {
    if (!teacher) return;
    onConfirm(teacher);
    onClose();
  };

  return (
    <Modal
      open={teacher !== null}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} type="button">
            Delete teacher
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
            Delete teacher?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This will remove{" "}
            <span className="font-medium text-foreground">{teacher?.name}</span>{" "}
            from your school. You&apos;ll have a few seconds to undo.
          </p>
        </div>
      </div>
    </Modal>
  );
}

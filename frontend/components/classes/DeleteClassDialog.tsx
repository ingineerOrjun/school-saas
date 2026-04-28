"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { classesApi } from "@/lib/classes";
import type { ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export interface DeleteClassDialogProps {
  klass: ClassWithSections | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

export function DeleteClassDialog({
  klass,
  onClose,
  onDeleted,
}: DeleteClassDialogProps) {
  const [submitting, setSubmitting] = React.useState(false);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleDelete = async () => {
    if (!klass) return;
    setSubmitting(true);
    try {
      await classesApi.remove(klass.id);
      toast.success(`${klass.name} deleted`);
      onDeleted(klass.id);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to delete class.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const sectionCount = klass?.sections.length ?? 0;

  return (
    <Modal
      open={klass !== null}
      onClose={handleClose}
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={submitting}
            type="button"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            loading={submitting}
            type="button"
          >
            Delete class
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
            Delete {klass?.name}?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {sectionCount > 0 ? (
              <>
                This will also remove{" "}
                <span className="font-medium text-foreground">
                  {sectionCount} section{sectionCount === 1 ? "" : "s"}
                </span>
                . Students in those sections become unassigned — they stay on
                your roster.
              </>
            ) : (
              "This class has no sections. It will be permanently removed."
            )}
          </p>
        </div>
      </div>
    </Modal>
  );
}

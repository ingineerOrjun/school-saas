"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { teachersApi, type TeacherDto } from "@/lib/teachers";
import type { ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export interface EditTeacherDialogProps {
  teacher: TeacherDto | null;
  /**
   * Kept on the props for backwards compatibility with the parent
   * page wiring. NOT used in the form any more — class / section /
   * subject assignment is the AssignmentsDialog grid's job (legacy
   * Teacher.classId / sectionId columns dropped in 20260511).
   */
  classes?: ClassWithSections[];
  onClose: () => void;
  onUpdated: (teacher: TeacherDto) => void;
}

/**
 * Edit-teacher dialog. After the legacy column drop in 20260511 this
 * dialog only edits the teacher's profile (currently just the name).
 * Class / section / subject assignment is exclusively the
 * AssignmentsDialog grid's responsibility — there's exactly one place
 * to manage scope, which keeps the data model un-divergent.
 */
export function EditTeacherDialog({
  teacher,
  onClose,
  onUpdated,
}: EditTeacherDialogProps) {
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Hydrate the form whenever a different teacher is opened.
  React.useEffect(() => {
    if (teacher) {
      setName(teacher.name);
      setError(null);
    }
  }, [teacher]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teacher) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await teachersApi.update(teacher.id, {
        name: name.trim(),
      });
      toast.success(`${updated.name} updated`);
      onUpdated(updated);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to update teacher.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={teacher !== null}
      onClose={handleClose}
      title="Edit teacher"
      description="Update the teacher's profile. Use Assign on the row to manage their classes and subjects."
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
          <Button onClick={handleSubmit} loading={submitting} type="button">
            Save changes
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Full name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          disabled={submitting}
        />
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Class / subject assignments are managed from the{" "}
            <span className="font-medium text-foreground">Assign</span>{" "}
            button on the teacher row.
          </span>
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

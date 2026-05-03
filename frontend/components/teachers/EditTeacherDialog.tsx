"use client";

import * as React from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { teachersApi, type TeacherDto } from "@/lib/teachers";
import type { ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  SectionSelect,
  UNASSIGNED,
  type Assignment,
} from "@/components/students/SectionSelect";

export interface EditTeacherDialogProps {
  teacher: TeacherDto | null;
  classes: ClassWithSections[];
  onClose: () => void;
  onUpdated: (teacher: TeacherDto) => void;
}

export function EditTeacherDialog({
  teacher,
  classes,
  onClose,
  onUpdated,
}: EditTeacherDialogProps) {
  const [name, setName] = React.useState("");
  const [assignment, setAssignment] = React.useState<Assignment>(UNASSIGNED);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Hydrate the form whenever a different teacher is opened.
  React.useEffect(() => {
    if (teacher) {
      setName(teacher.name);
      setAssignment({
        classId: teacher.classId,
        sectionId: teacher.sectionId,
      });
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
        classId: assignment.classId,
        sectionId: assignment.sectionId,
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
      description="Update the teacher's record and class assignment."
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
        <SectionSelect
          label="Assignment"
          classes={classes}
          value={assignment}
          onChange={setAssignment}
          disabled={submitting}
          hint="The class (or section) this teacher manages. Removing the assignment makes their account read-only."
        />
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

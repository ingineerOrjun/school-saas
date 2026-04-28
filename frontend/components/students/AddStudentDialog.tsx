"use client";

import * as React from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { studentsApi, type StudentDto } from "@/lib/students";
import type { ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  SectionSelect,
  UNASSIGNED,
  formatStudentAssignment,
  type Assignment,
} from "./SectionSelect";

export interface AddStudentDialogProps {
  open: boolean;
  classes: ClassWithSections[];
  onClose: () => void;
  onCreated: (student: StudentDto) => void;
}

export function AddStudentDialog({
  open,
  classes,
  onClose,
  onCreated,
}: AddStudentDialogProps) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [symbolNumber, setSymbolNumber] = React.useState("");
  const [assignment, setAssignment] = React.useState<Assignment>(UNASSIGNED);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset form when the dialog opens
  React.useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setSymbolNumber("");
      setAssignment(UNASSIGNED);
      setError(null);
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const student = await studentsApi.create({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        symbolNumber: symbolNumber.trim() || null,
        classId: assignment.classId,
        sectionId: assignment.sectionId,
      });
      toast.success(`${student.firstName} ${student.lastName} enrolled`, {
        description: `Assignment: ${formatStudentAssignment(student)}`,
      });
      onCreated(student);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to create student.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Add new student"
      description="Enroll a new student into your school workspace."
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
            onClick={handleSubmit}
            loading={submitting}
            type="button"
          >
            Save student
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="First name"
          placeholder="Aarav"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
          autoFocus
          disabled={submitting}
        />
        <Input
          label="Last name"
          placeholder="Sharma"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
          disabled={submitting}
        />
        <div className="sm:col-span-2">
          <Input
            label="Symbol / Roll no."
            placeholder="e.g. 1001"
            value={symbolNumber}
            onChange={(e) => setSymbolNumber(e.target.value)}
            hint="Optional. Must be unique within your school."
            disabled={submitting}
            maxLength={40}
          />
        </div>
        <div className="sm:col-span-2">
          <SectionSelect
            label="Class / Section"
            classes={classes}
            value={assignment}
            onChange={setAssignment}
            disabled={submitting}
            hint="Pick a whole class (for schools without sections) or a specific section. You can also leave this unassigned."
          />
        </div>
        {error && (
          <div className="sm:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

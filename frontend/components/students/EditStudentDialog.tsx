"use client";

import * as React from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  studentsApi,
  type Gender,
  type StudentDto,
} from "@/lib/students";
import type { ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  SectionSelect,
  UNASSIGNED,
  assignmentFromStudent,
  formatStudentAssignment,
  type Assignment,
} from "./SectionSelect";

export interface EditStudentDialogProps {
  student: StudentDto | null;
  classes: ClassWithSections[];
  onClose: () => void;
  onUpdated: (student: StudentDto) => void;
}

export function EditStudentDialog({
  student,
  classes,
  onClose,
  onUpdated,
}: EditStudentDialogProps) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [symbolNumber, setSymbolNumber] = React.useState("");
  const [gender, setGender] = React.useState<Gender | "">("");
  const [dateOfBirth, setDateOfBirth] = React.useState("");
  const [parentName, setParentName] = React.useState("");
  const [contactNumber, setContactNumber] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [admissionDate, setAdmissionDate] = React.useState("");
  const [assignment, setAssignment] = React.useState<Assignment>(UNASSIGNED);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Hydrate form when a student is opened. ISO timestamps from the API
  // get sliced to YYYY-MM-DD because <input type="date"> only accepts
  // that shape.
  React.useEffect(() => {
    if (student) {
      setFirstName(student.firstName);
      setLastName(student.lastName);
      setSymbolNumber(student.symbolNumber ?? "");
      setGender(student.gender);
      setDateOfBirth(toDateInput(student.dateOfBirth));
      setParentName(student.parentName);
      setContactNumber(student.contactNumber);
      setAddress(student.address ?? "");
      setAdmissionDate(toDateInput(student.admissionDate));
      setAssignment(assignmentFromStudent(student));
      setError(null);
    }
  }, [student]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) return;
    setError(null);

    if (!gender) {
      setError("Gender is required.");
      return;
    }
    if (!dateOfBirth) {
      setError("Date of birth is required.");
      return;
    }
    if (!parentName.trim()) {
      setError("Parent name is required.");
      return;
    }
    if (!contactNumber.trim()) {
      setError("Contact number is required.");
      return;
    }

    setSubmitting(true);
    try {
      const updated = await studentsApi.update(student.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        symbolNumber: symbolNumber.trim() || null,
        gender: gender as Gender,
        dateOfBirth,
        parentName: parentName.trim(),
        contactNumber: contactNumber.trim(),
        address: address.trim() || null,
        admissionDate: admissionDate || null,
        classId: assignment.classId,
        sectionId: assignment.sectionId,
        // Phase FINAL-HARDENING Part 2 — round-trip the
        // updatedAt stamp the GET returned so the backend's
        // assertNotStaleAndUpdate can detect cross-tab races.
        updatedAt: student.updatedAt,
      });
      toast.success(`${updated.firstName} ${updated.lastName} updated`, {
        description: `Assignment: ${formatStudentAssignment(updated)}`,
      });
      onUpdated(updated);
      onClose();
    } catch (err) {
      // Phase FINAL-HARDENING Part 2: friendly stale-write handling.
      // The backend returns 409 with copy:
      //   "This student was updated by another user. Refresh and
      //    try again."
      // The form values are preserved (we don't reset state) so
      // the operator can re-apply their intent after refresh.
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        /updated by another user/i.test(err.message)
      ) {
        const msg =
          "This student was just changed by someone else. " +
          "Your edits are preserved — close, reopen, and re-apply.";
        setError(msg);
        toast.error(msg, { duration: 8_000 });
      } else {
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to update student.";
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={student !== null}
      onClose={handleClose}
      title="Edit student"
      description="Update the student's record."
      size="lg"
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
            Save changes
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <Input
          label="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
          autoFocus
          disabled={submitting}
        />
        <Input
          label="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
          disabled={submitting}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Gender <span className="text-destructive">*</span>
          </label>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value as Gender | "")}
            disabled={submitting}
            required
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-muted disabled:cursor-not-allowed"
          >
            <option value="" disabled>
              Select gender…
            </option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Date of birth <span className="text-destructive">*</span>
          </label>
          <input
            type="date"
            value={dateOfBirth}
            max={todayISO()}
            onChange={(e) => setDateOfBirth(e.target.value)}
            disabled={submitting}
            required
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-muted disabled:cursor-not-allowed"
          />
        </div>

        <Input
          label="Parent / Guardian name"
          value={parentName}
          onChange={(e) => setParentName(e.target.value)}
          required
          disabled={submitting}
          maxLength={120}
        />
        <Input
          label="Contact number"
          inputMode="tel"
          value={contactNumber}
          onChange={(e) => setContactNumber(e.target.value)}
          required
          disabled={submitting}
          maxLength={40}
        />

        <div className="sm:col-span-2">
          <Input
            label="Address (optional)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={submitting}
            maxLength={500}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Admission date (optional)
          </label>
          <input
            type="date"
            value={admissionDate}
            max={todayISO()}
            onChange={(e) => setAdmissionDate(e.target.value)}
            disabled={submitting}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-muted disabled:cursor-not-allowed"
          />
        </div>

        <Input
          label="Symbol / Roll no. (optional)"
          placeholder="e.g. 1001"
          value={symbolNumber}
          onChange={(e) => setSymbolNumber(e.target.value)}
          hint="Must be unique within your school."
          disabled={submitting}
          maxLength={40}
        />

        <div className="sm:col-span-2">
          <SectionSelect
            label="Class / Section"
            classes={classes}
            value={assignment}
            onChange={setAssignment}
            disabled={submitting}
            hint="Move the student between classes and sections, or leave them unassigned."
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

/** ISO timestamp or `YYYY-MM-DD` → `YYYY-MM-DD` for `<input type="date">`. */
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  // Already shaped — accept short form too in case the API ever returns it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return iso.slice(0, 10);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

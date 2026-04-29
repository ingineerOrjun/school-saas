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
  formatStudentAssignment,
  type Assignment,
} from "./SectionSelect";

export interface AddStudentDialogProps {
  open: boolean;
  classes: ClassWithSections[];
  onClose: () => void;
  onCreated: (student: StudentDto) => void;
  /**
   * Optional pre-fill for the name fields. Used by the inline
   * QuickAddStudent input so the user's typing isn't lost when we
   * route them into the full form to collect required fields.
   */
  initialFirstName?: string;
  initialLastName?: string;
}

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  symbolNumber: "",
  gender: "" as Gender | "",
  dateOfBirth: "",
  parentName: "",
  contactNumber: "",
  address: "",
  admissionDate: "",
};

export function AddStudentDialog({
  open,
  classes,
  onClose,
  onCreated,
  initialFirstName,
  initialLastName,
}: AddStudentDialogProps) {
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [assignment, setAssignment] = React.useState<Assignment>(UNASSIGNED);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset form when the dialog opens. If the caller passed a pre-fill
  // (e.g. from QuickAdd), keep the names so the user doesn't retype.
  React.useEffect(() => {
    if (open) {
      setForm({
        ...EMPTY_FORM,
        firstName: initialFirstName ?? "",
        lastName: initialLastName ?? "",
      });
      setAssignment(UNASSIGNED);
      setError(null);
    }
  }, [open, initialFirstName, initialLastName]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  // Edits clear any visible error so the banner doesn't linger after the
  // user starts fixing the offending field. The button stays enabled the
  // whole time (we only `setSubmitting` inside the try/finally below),
  // so retry is always possible.
  const update = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Required-field guards mirror the backend DTO so we fail fast
    // without an extra network round-trip.
    if (!form.gender) {
      setError("Gender is required.");
      return;
    }
    if (!form.dateOfBirth) {
      setError("Date of birth is required.");
      return;
    }
    if (!form.parentName.trim()) {
      setError("Parent name is required.");
      return;
    }
    if (!form.contactNumber.trim()) {
      setError("Contact number is required.");
      return;
    }

    setSubmitting(true);
    try {
      const student = await studentsApi.create({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        symbolNumber: form.symbolNumber.trim() || null,
        gender: form.gender as Gender,
        dateOfBirth: form.dateOfBirth,
        parentName: form.parentName.trim(),
        contactNumber: form.contactNumber.trim(),
        address: form.address.trim() || null,
        admissionDate: form.admissionDate || null,
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
            Save student
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
          placeholder="Aarav"
          value={form.firstName}
          onChange={(e) => update("firstName", e.target.value)}
          required
          autoFocus
          disabled={submitting}
        />
        <Input
          label="Last name"
          placeholder="Sharma"
          value={form.lastName}
          onChange={(e) => update("lastName", e.target.value)}
          required
          disabled={submitting}
        />

        {/* Required demographic + contact block */}
        <GenderSelect
          value={form.gender}
          onChange={(g) => update("gender", g)}
          disabled={submitting}
        />
        <DateField
          label="Date of birth"
          value={form.dateOfBirth}
          max={todayISO()}
          required
          onChange={(v) => update("dateOfBirth", v)}
          disabled={submitting}
        />
        <Input
          label="Parent / Guardian name"
          placeholder="Ram Sharma"
          value={form.parentName}
          onChange={(e) => update("parentName", e.target.value)}
          required
          disabled={submitting}
          maxLength={120}
        />
        <Input
          label="Contact number"
          placeholder="98XXXXXXXX"
          inputMode="tel"
          value={form.contactNumber}
          onChange={(e) => update("contactNumber", e.target.value)}
          required
          disabled={submitting}
          maxLength={40}
        />

        {/* Optional block */}
        <div className="sm:col-span-2">
          <Input
            label="Address (optional)"
            placeholder="Ward 5, Lalitpur"
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            disabled={submitting}
            maxLength={500}
          />
        </div>
        <DateField
          label="Admission date (optional)"
          value={form.admissionDate}
          max={todayISO()}
          onChange={(v) => update("admissionDate", v)}
          disabled={submitting}
        />
        <Input
          label="Symbol / Roll no. (optional)"
          placeholder="e.g. 1001"
          value={form.symbolNumber}
          onChange={(e) => update("symbolNumber", e.target.value)}
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

// ---------------------------------------------------------------------------
// Small form helpers — kept local so the dialog stays self-contained.
// ---------------------------------------------------------------------------

function GenderSelect({
  value,
  onChange,
  disabled,
}: {
  value: Gender | "";
  onChange: (g: Gender | "") => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">
        Gender <span className="text-destructive">*</span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Gender | "")}
        disabled={disabled}
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
  );
}

function DateField({
  label,
  value,
  max,
  required,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      <input
        type="date"
        value={value}
        max={max}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-muted disabled:cursor-not-allowed"
      />
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

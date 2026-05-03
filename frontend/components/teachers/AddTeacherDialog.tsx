"use client";

import * as React from "react";
import { Mail, Lock } from "lucide-react";
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

export interface AddTeacherDialogProps {
  open: boolean;
  classes: ClassWithSections[];
  onClose: () => void;
  onCreated: (teacher: TeacherDto) => void;
}

/**
 * Provisions a new teacher AND their login account in one step.
 * Hits POST /teachers/create-with-user, which creates a User
 * (role=TEACHER, same school) and a Teacher row in a single
 * transaction — so the new teacher can sign in immediately.
 */
export function AddTeacherDialog({
  open,
  classes,
  onClose,
  onCreated,
}: AddTeacherDialogProps) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [assignment, setAssignment] = React.useState<Assignment>(UNASSIGNED);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset every time the dialog opens so a stale half-typed password
  // never lingers between sessions.
  React.useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setPassword("");
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
      const result = await teachersApi.createWithUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        // SectionSelect emits a class+section pair; both are nullable.
        // The backend collapses an unassigned pair to (null, null).
        classId: assignment.classId,
        sectionId: assignment.sectionId,
      });
      toast.success("Teacher login created", {
        description: `${result.teacher.name} can sign in with ${result.user.email}.`,
      });
      onCreated(result.teacher);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to add teacher.";
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
      title="Add new teacher"
      description="Create a teacher account. They'll be able to sign in with the email and password you set here."
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
            Create teacher
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Full name"
          placeholder="Ms. Priya Menon"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          disabled={submitting}
        />
        <Input
          label="Login email"
          type="email"
          placeholder="priya@yourschool.edu"
          leftIcon={<Mail className="h-4 w-4" />}
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={submitting}
        />
        <Input
          label="Temporary password"
          type="password"
          placeholder="Min 8 chars with an uppercase & number"
          leftIcon={<Lock className="h-4 w-4" />}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          disabled={submitting}
          // Hint mirrors the backend's password rule so the admin sees
          // the same expectation before they hit submit.
          hint="Share this with the teacher — they can change it after first login."
        />
        <SectionSelect
          label="Assignment"
          classes={classes}
          value={assignment}
          onChange={setAssignment}
          disabled={submitting}
          hint="Pick the class (or specific section) this teacher will manage. Leave unassigned to grant read-only access."
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

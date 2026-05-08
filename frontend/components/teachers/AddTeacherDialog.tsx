"use client";

import * as React from "react";
import { Mail, Lock, Info } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { teachersApi, type TeacherDto } from "@/lib/teachers";
import type { ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export interface AddTeacherDialogProps {
  open: boolean;
  /**
   * Kept on the props for backwards compatibility with the parent
   * page wiring. NOT used in the form any more — class / section /
   * subject assignment is the AssignmentsDialog grid's job (legacy
   * Teacher.classId / sectionId columns dropped in 20260511).
   */
  classes?: ClassWithSections[];
  onClose: () => void;
  onCreated: (teacher: TeacherDto) => void;
}

/**
 * Provisions a new teacher AND their login account in one step. Hits
 * POST /teachers/create-with-user, which creates a User (role=TEACHER,
 * same school) and a Teacher row in a single transaction.
 *
 * The dialog INTENTIONALLY no longer collects class/section. The flow
 * is two clean steps:
 *
 *   1. Add teacher (this dialog) → name + email + password.
 *   2. Click "Assign" on the new row → AssignmentsDialog grid.
 *
 * The backend's login hard-guard rejects teacher logins until at
 * least one TeachingAssignment exists, so the admin is gently steered
 * into completing step 2 before the teacher gets stranded.
 */
export function AddTeacherDialog({
  open,
  onClose,
  onCreated,
}: AddTeacherDialogProps) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset every time the dialog opens so a stale half-typed password
  // never lingers between sessions.
  React.useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setPassword("");
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
      });
      toast.success("Teacher created", {
        description: `Click "Assign" on ${result.teacher.name}'s row to set their classes — they can't sign in until they have at least one.`,
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
      description="Create the teacher's login. You'll assign their classes / subjects in the next step."
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
        {/* Two-step explainer — replaces the old class picker. The
            user's mental model used to be "add teacher AND class in one
            shot"; now it's "add teacher → click Assign". This callout
            sets that expectation up front so the second step doesn't
            feel like a forgotten requirement. */}
        <div className="flex items-start gap-2 rounded-md border border-emerald-300/40 bg-emerald-500/[0.05] px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            After creating the teacher, click{" "}
            <span className="font-medium">Assign</span> on their row to
            tick the classes / subjects they teach. Logins are blocked
            until at least one assignment exists.
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

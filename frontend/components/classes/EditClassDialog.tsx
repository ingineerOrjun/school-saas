"use client";

import * as React from "react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { classesApi, type ClassDto } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export interface EditClassDialogProps {
  klass: ClassDto | null;
  onClose: () => void;
  onUpdated: (klass: ClassDto) => void;
}

export function EditClassDialog({
  klass,
  onClose,
  onUpdated,
}: EditClassDialogProps) {
  const [name, setName] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (klass) {
      setName(klass.name);
      setError(null);
    }
  }, [klass]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!klass) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await classesApi.update(klass.id, {
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
            : "Failed to update class.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={klass !== null}
      onClose={handleClose}
      title="Rename class"
      description="Change the class name. Students and sections keep their assignments."
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
          label="Class name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Grade 10"
          required
          autoFocus
          disabled={submitting}
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

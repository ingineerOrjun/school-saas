"use client";

import * as React from "react";
import { Edit2, Plus, Trash2, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import type { ClassWithSections } from "@/lib/classes";
import type { SectionDto } from "@/lib/sections";
import { sectionsApi } from "@/lib/sections";

export interface ClassCardProps {
  klass: ClassWithSections;
  onEditClass: (klass: ClassWithSections) => void;
  onDeleteClass: (klass: ClassWithSections) => void;
  onSectionAdded: (classId: string, section: SectionDto) => void;
  onSectionRemoved: (classId: string, sectionId: string) => void;
}

export function ClassCard({
  klass,
  onEditClass,
  onDeleteClass,
  onSectionAdded,
  onSectionRemoved,
}: ClassCardProps) {
  return (
    <div className="glass rounded-xl p-5 transition-shadow hover:shadow-sm animate-fade-in-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-md font-semibold tracking-tight text-foreground">
            {klass.name}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {klass.sections.length === 0
              ? "No sections yet"
              : `${klass.sections.length} section${klass.sections.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <IconButton
            label={`Edit ${klass.name}`}
            onClick={() => onEditClass(klass)}
          >
            <Edit2 className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={`Delete ${klass.name}`}
            onClick={() => onDeleteClass(klass)}
            variant="danger"
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {klass.sections.map((section) => (
          <SectionChip
            key={section.id}
            section={section}
            onRemove={() => onSectionRemoved(klass.id, section.id)}
          />
        ))}
        <AddSectionInline
          classId={klass.id}
          existing={klass.sections}
          onAdded={(s) => onSectionAdded(klass.id, s)}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section chip
// ---------------------------------------------------------------------------

function SectionChip({
  section,
  onRemove,
}: {
  section: SectionDto;
  onRemove: () => void;
}) {
  const [deleting, setDeleting] = React.useState(false);

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await sectionsApi.remove(section.id);
      onRemove();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to delete section.";
      toast.error(msg);
      setDeleting(false);
    }
  };

  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-surface/90 backdrop-blur-md",
        "px-2.5 py-1 text-xs font-medium text-foreground shadow-xs",
        "transition-all duration-150",
        "hover:border-primary/40 hover:bg-primary/5",
        deleting && "opacity-50",
      )}
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
        {section.name.slice(0, 1).toUpperCase()}
      </span>
      <span>{section.name}</span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        aria-label={`Remove section ${section.name}`}
        className={cn(
          "ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground",
          "opacity-0 group-hover:opacity-100",
          "hover:bg-destructive/10 hover:text-destructive",
          "transition-all duration-150 focus-ring",
        )}
      >
        {deleting ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <X className="h-3 w-3" />
        )}
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline "+ Add section" input
// ---------------------------------------------------------------------------

function AddSectionInline({
  classId,
  existing,
  onAdded,
}: {
  classId: string;
  existing: SectionDto[];
  onAdded: (section: SectionDto) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (!name) return;
    if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      toast.error(`Section "${name}" already exists in this class.`);
      return;
    }

    setSubmitting(true);
    try {
      const created = await sectionsApi.create({ name, classId });
      onAdded(created);
      setValue("");
      // Keep the input open for rapid entry (Grade 10 → A, B, C, D…).
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to add section.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBlur = () => {
    if (!value.trim()) setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground",
          "hover:border-primary/50 hover:bg-primary/5 hover:text-primary transition-all duration-150",
          "focus-ring",
        )}
      >
        <Plus className="h-3 w-3" strokeWidth={2.5} />
        Add section
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="inline-flex items-center">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            setOpen(false);
          }
        }}
        placeholder="Section name"
        disabled={submitting}
        maxLength={40}
        className={cn(
          "h-7 w-32 rounded-full border border-primary/40 bg-surface",
          "px-2.5 text-xs font-medium text-foreground",
          "placeholder:text-muted-foreground/70 placeholder:font-normal",
          "shadow-xs",
          "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary",
          "transition-all duration-150",
        )}
      />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function IconButton({
  children,
  label,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
        "transition-all duration-150 hover:-translate-y-px focus-ring",
        variant === "danger"
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-primary/10 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

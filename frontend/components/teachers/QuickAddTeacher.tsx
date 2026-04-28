"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface QuickAddTeacherProps {
  onSubmit: (name: string) => void | Promise<void>;
  className?: string;
}

/**
 * Inline quick-add input for teachers. Press Enter to create a teacher from a
 * single name string — no modal, no extra details. Users can fill in email,
 * classes, etc. later via the edit dialog.
 */
export function QuickAddTeacher({ onSubmit, className }: QuickAddTeacherProps) {
  const [value, setValue] = React.useState("");

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.length < 2) {
      toast.error("Teacher name needs at least 2 characters.");
      return;
    }

    setValue("");
    await onSubmit(trimmed);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className={cn("relative animate-fade-in", className)}
    >
      <Plus
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-600"
        strokeWidth={2.5}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a faculty member…"
        aria-label="Quick add teacher by name"
        className={cn(
          "h-11 w-full rounded-lg border border-border/80 bg-surface/80 backdrop-blur-md",
          "pl-9 pr-28 text-sm font-medium text-foreground",
          "placeholder:text-muted-foreground/80 placeholder:font-normal",
          "transition-all duration-150 shadow-xs",
          "hover:border-border",
          "focus:outline-none focus:ring-2 focus:ring-emerald-500/25 focus:border-emerald-500 focus:bg-surface",
        )}
      />
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>Press</span>
        <kbd className="inline-flex items-center rounded border border-border bg-surface px-1.5 py-0.5 font-medium shadow-xs">
          ↵
        </kbd>
      </div>
    </form>
  );
}

"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface QuickAddStudentProps {
  onSubmit: (firstName: string, lastName: string) => void | Promise<void>;
  className?: string;
}

/**
 * Inline quick-add input. Press Enter to create a student from a single
 * "First Last" string — no modal. Parses on the client so invalid inputs
 * don't roundtrip to the server.
 */
export function QuickAddStudent({ onSubmit, className }: QuickAddStudentProps) {
  const [value, setValue] = React.useState("");

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      toast.error("Enter both first and last name, e.g. “Aarav Sharma”.");
      return;
    }

    const [firstName, ...rest] = parts;
    const lastName = rest.join(" ");

    // Clear immediately so the user can keep typing the next name.
    setValue("");
    await onSubmit(firstName, lastName);
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
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary"
        strokeWidth={2.5}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Quick add student name…"
        aria-label="Quick add student by name"
        className={cn(
          "h-11 w-full rounded-lg border border-border/80 bg-surface/80 backdrop-blur-md",
          "pl-9 pr-28 text-sm font-medium text-foreground",
          "placeholder:text-muted-foreground/80 placeholder:font-normal",
          "transition-all duration-150 shadow-xs",
          "hover:border-border",
          "focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary focus:bg-surface",
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

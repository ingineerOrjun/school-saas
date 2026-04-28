"use client";

import * as React from "react";
import { Edit2, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeacherDto } from "@/lib/teachers";

export interface TeacherTableProps {
  teachers: TeacherDto[];
  onEdit: (teacher: TeacherDto) => void;
  onDelete: (teacher: TeacherDto) => void;
  /** IDs that should flash a highlight background (new/just-added). */
  highlightIds?: Set<string>;
  /** IDs currently playing the exit animation before unmount. */
  removingIds?: Set<string>;
}

export function TeacherTable({
  teachers,
  onEdit,
  onDelete,
  highlightIds,
  removingIds,
}: TeacherTableProps) {
  return (
    <div className="glass rounded-xl overflow-hidden animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-muted/30">
              <Th className="rounded-tl-xl">Teacher</Th>
              <Th>Login</Th>
              <Th>Added</Th>
              <Th className="text-right rounded-tr-xl">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {teachers.map((t, idx) => {
              const isLast = idx === teachers.length - 1;
              const isNew = highlightIds?.has(t.id);
              const isPending = isPendingId(t.id);
              const isRemoving = removingIds?.has(t.id);
              return (
                <tr
                  key={t.id}
                  className={cn(
                    "group transition-all duration-150",
                    !isPending && !isRemoving && "hover:bg-emerald-500/5",
                    isNew && "animate-highlight-row-teacher",
                    isPending && "opacity-70",
                    isRemoving && "animate-row-remove pointer-events-none",
                  )}
                >
                  <Td
                    className={cn(
                      "border-t border-border/50",
                      isLast && "rounded-bl-xl",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {isPending ? (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/80 ring-1 ring-inset ring-border/60">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <Avatar name={t.name} id={t.id} />
                      )}
                      <div className="flex flex-col leading-tight">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {t.name}
                          </span>
                          {isPending && (
                            <span className="text-[11px] italic text-muted-foreground">
                              saving…
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">
                          #{isPending ? "pending" : t.id.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </Td>
                  <Td className="border-t border-border/50">
                    {t.userId ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        No account
                      </span>
                    )}
                  </Td>
                  <Td className="border-t border-border/50 text-muted-foreground">
                    {isPending ? "—" : formatRelative(t.createdAt)}
                  </Td>
                  <Td
                    className={cn(
                      "border-t border-border/50 text-right",
                      isLast && "rounded-br-xl",
                    )}
                  >
                    {isPending ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="inline-flex items-center gap-1">
                        <IconButton
                          label={`Edit ${t.name}`}
                          onClick={() => onEdit(t)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label={`Delete ${t.name}`}
                          onClick={() => onDelete(t)}
                          variant="danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      className={cn(
        "h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>
  );
}

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
          : "hover:bg-emerald-500/10 hover:text-emerald-600",
      )}
    >
      {children}
    </button>
  );
}

// --- helpers ---

function isPendingId(id: string): boolean {
  return id.startsWith("temp_");
}

const AVATAR_PALETTES = [
  "from-indigo-400 to-purple-400",
  "from-sky-400 to-blue-400",
  "from-emerald-400 to-teal-400",
  "from-amber-400 to-orange-400",
  "from-pink-400 to-rose-400",
  "from-violet-400 to-fuchsia-400",
];

function paletteFor(id: string): string {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return AVATAR_PALETTES[sum % AVATAR_PALETTES.length];
}

function Avatar({ name, id }: { name: string; id: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ring-1 ring-inset ring-white/20",
        `bg-gradient-to-br ${paletteFor(id)}`,
      )}
    >
      {initials || "?"}
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

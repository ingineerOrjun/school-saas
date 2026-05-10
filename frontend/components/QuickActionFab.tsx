"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Plus, UserPlus, Wallet, X } from "lucide-react";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/auth";

// ---------------------------------------------------------------------------
// QuickActionFab — Phase 24 Section 5.
//
// Floating action button anchored at the bottom-right. Tap opens a
// radial sheet of role-aware shortcuts. On phones it stays out of
// the thumb-rest zone; on desktop it's smaller + hidden behind the
// command palette (which is the keyboard-friendly equivalent).
//
// Roles:
//   ADMIN    — Add student, Collect payment, Take attendance
//   TEACHER  — Take attendance
//   (others) — hidden
//
// Why a FAB on top of the command palette:
//   The palette is keyboard-discoverable; the FAB is touch-
//   discoverable. Cashiers walking into the office with a parent
//   in front of them tap the FAB → "Collect payment" without
//   reaching for a keyboard.
//
// Accessibility:
//   The trigger is a real <button> with aria-label; the sheet items
//   are real <button>s (not divs). Esc closes the sheet.
// ---------------------------------------------------------------------------

interface QuickAction {
  label: string;
  icon: React.ReactNode;
  href: string;
  /** Color tint for the icon tile. */
  tone: "primary" | "amber" | "emerald";
  /** Roles that can see this action. */
  roles: Role[];
}

const ACTIONS: QuickAction[] = [
  {
    label: "Take attendance",
    icon: <ClipboardCheck className="h-4 w-4" />,
    href: "/attendance",
    tone: "primary",
    roles: ["ADMIN", "TEACHER"],
  },
  {
    label: "Collect payment",
    icon: <Wallet className="h-4 w-4" />,
    href: "/fees/collect",
    tone: "emerald",
    roles: ["ADMIN"],
  },
  {
    label: "Add student",
    icon: <UserPlus className="h-4 w-4" />,
    href: "/students?new=true",
    tone: "amber",
    roles: ["ADMIN"],
  },
];

export function QuickActionFab() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const user = React.useMemo(() => getStoredUser(), []);
  const role = (user?.role as Role | undefined) ?? "ADMIN";
  const visible = ACTIONS.filter((a) => a.roles.includes(role));

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <>
      {/* Backdrop when open — taps anywhere close. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/10 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
      <div className="fixed z-40 right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] md:bottom-4 flex flex-col items-end gap-2">
        {/* Action sheet (above the trigger when open) */}
        {open && (
          <ul className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
            {visible.map((a) => (
              <li key={a.label}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(a.href);
                  }}
                  className="flex items-center gap-2.5 rounded-full bg-white border border-slate-200 shadow-md pl-2 pr-4 py-1.5 hover:bg-slate-50"
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full",
                      a.tone === "primary" && "bg-primary/10 text-primary",
                      a.tone === "amber" && "bg-amber-100 text-amber-700",
                      a.tone === "emerald" && "bg-emerald-100 text-emerald-700",
                    )}
                  >
                    {a.icon}
                  </span>
                  <span className="text-sm font-medium text-slate-800">
                    {a.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Trigger */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close quick actions" : "Open quick actions"}
          aria-expanded={open}
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform",
            "hover:scale-105 active:scale-95",
            open && "rotate-45",
          )}
        >
          {open ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
      </div>
    </>
  );
}

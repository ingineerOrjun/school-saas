"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// CopyableId — single-click copy chip for opaque identifiers.
//
// Phase operational-visibility Part 5 — every surface that exposes an
// internal id (audit row, payment, registration number, receipt
// number, exam id, attendance session id) wraps it in this so the
// operator can grab it in one click during a support conversation.
//
// Display:
//   • Default: shows a truncated middle ("ab12c…7d89") so long UUIDs
//     don't overflow narrow sidebar columns.
//   • `expand`: shows the full value (use inside diagnostic panels
//     where width isn't a concern).
//
// Click behavior:
//   • Copies `value` to the clipboard.
//   • Flashes a check mark for 1.5s.
//   • Best-effort — falls back to a textarea + execCommand on older
//     browsers that don't expose `navigator.clipboard`.
//
// Accessibility:
//   • Real <button> so it's keyboard-reachable.
//   • aria-label + title carry the full value so screen-reader
//     users get the same affordance.
// ============================================================================

export interface CopyableIdProps {
  value: string;
  /** Render the full value instead of the truncated middle. */
  expand?: boolean;
  /** Optional label suffix shown after the id ("· receipt"). */
  label?: string;
  className?: string;
}

const FLASH_MS = 1_500;

export function CopyableId({
  value,
  expand = false,
  label,
  className,
}: CopyableIdProps) {
  const [copied, setCopied] = React.useState(false);

  const display = expand ? value : truncateMiddle(value);

  const handleClick = React.useCallback(async () => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), FLASH_MS);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Copy: ${value}`}
      aria-label={`Copy ${value}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground",
        "hover:border-border hover:bg-muted/60 hover:text-foreground",
        "focus:outline-none focus:ring-2 focus:ring-primary/25",
        "transition-colors",
        className,
      )}
    >
      <span className="tabular-nums">{display}</span>
      {label && <span className="font-sans text-muted-foreground/80">{label}</span>}
      {copied ? (
        <Check className="h-3 w-3 text-emerald-600" />
      ) : (
        <Copy className="h-3 w-3 opacity-60" />
      )}
    </button>
  );
}

function truncateMiddle(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to legacy path
    }
  }
  // Legacy fallback — used in non-secure contexts (http:// pages) where
  // navigator.clipboard is unavailable. A textarea + execCommand is
  // synchronous and widely supported.
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

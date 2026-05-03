"use client";

import * as React from "react";
import { GraduationCap } from "lucide-react";
import { resolveLogoUrl } from "@/lib/school";
import { cn } from "@/lib/utils";

/**
 * Shared 64×64 logo block for all printable documents (marksheet,
 * receipt, ledger). Renders the uploaded logo with `object-contain`
 * when present; falls back to a dashed-border graduation-cap glyph
 * when no logo has been uploaded yet.
 *
 * Standardizing here prevents per-document drift — every official
 * document uses the same size and visual treatment.
 */
export function DocumentLogo({
  logoUrl,
  className,
}: {
  logoUrl: string | null | undefined;
  className?: string;
}) {
  const src = resolveLogoUrl(logoUrl);
  // Spec: 64×64, object-contain. White background so PNGs with
  // transparency don't pick up odd colors from the page.
  const base = "h-16 w-16 shrink-0 rounded-md bg-white";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt="School logo"
        className={cn(base, "object-contain", className)}
        // Inline style is a belt-and-suspenders for print engines that
        // sometimes drop Tailwind's object-fit utility.
        style={{ objectFit: "contain" }}
      />
    );
  }
  return (
    <div
      aria-hidden
      title="School logo"
      className={cn(
        base,
        "flex items-center justify-center border-2 border-dashed border-slate-400 bg-slate-50 text-slate-500 print:border-solid print:border-slate-700",
        className,
      )}
    >
      <GraduationCap className="h-8 w-8" strokeWidth={1.5} />
    </div>
  );
}

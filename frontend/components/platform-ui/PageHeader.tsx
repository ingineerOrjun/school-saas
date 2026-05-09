"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// PageHeader — top section of every platform page.
//
// One header pattern across the whole platform so spacing, typography,
// and actions land in the same place on every screen. Pages stay
// responsible for their own title text + breadcrumbs; the header just
// frames it.
//
// Slots:
//   • icon         — small slate-square (h-9 w-9) glyph next to the title.
//                    Optional. When omitted, the title sits flush left.
//   • breadcrumbs  — each link renders with a separator. Last item is
//                    the current page (rendered as text, not a link).
//   • actions      — right-side button group. The page passes whatever
//                    JSX it likes — usually 1-3 buttons.
// ---------------------------------------------------------------------------

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  /** Density toggle. "regular" is the default; "compact" trims padding. */
  density?: "regular" | "compact";
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  breadcrumbs,
  actions,
  density = "regular",
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-2", density === "compact" && "space-y-1.5", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs items={breadcrumbs} />
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && (
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white",
                density === "compact" && "h-8 w-8",
              )}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h1
              className={cn(
                "font-semibold tracking-tight text-slate-900",
                density === "compact" ? "text-lg" : "text-xl",
              )}
            >
              {title}
            </h1>
            {description && (
              <p className="mt-0.5 text-sm text-slate-500">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1 text-xs text-slate-500" aria-label="Breadcrumb">
      {items.map((item, idx) => {
        const last = idx === items.length - 1;
        return (
          <React.Fragment key={`${item.label}-${idx}`}>
            {idx > 0 && (
              <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden />
            )}
            {item.href && !last ? (
              <Link
                href={item.href}
                className="rounded px-1 -mx-1 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className={cn(last && "text-slate-700 font-medium")}>
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

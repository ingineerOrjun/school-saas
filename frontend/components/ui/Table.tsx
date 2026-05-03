import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Table primitive locked to the spec:
 *   • Wrapper: rounded, slate-300 border, white surface.
 *   • <THead>: slate-100 background, font-medium labels.
 *   • <Tr>: hover slate-50, divider between rows.
 *   • <Th>: tighter h-10, uppercase + tracking for scannability.
 *   • <Td>: tighter py-2.5, slate-900 text.
 *
 * USAGE CONVENTIONS (not enforced by the primitive):
 *   • "Actions" column should always be visible — never hide
 *     edit/delete icons behind hover. The spec is "fast-scanning":
 *     the user shouldn't have to mouseover a row to see what they can
 *     do with it.
 *   • Numeric columns right-align (`<Td className="text-right tabular-nums">`).
 *   • Text columns stay left-aligned (the default).
 */
export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="w-full overflow-x-auto rounded-lg border border-border bg-surface">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
));
Table.displayName = "Table";

export const THead = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn("bg-muted border-b border-border", className)}
    {...props}
  />
));
THead.displayName = "THead";

export const TBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("divide-y divide-border", className)}
    {...props}
  />
));
TBody.displayName = "TBody";

export const Tr = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "transition-colors hover:bg-muted/60 data-[state=selected]:bg-muted",
      className,
    )}
    {...props}
  />
));
Tr.displayName = "Tr";

export const Th = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      // Tighter h-10 (was h-11) — part of the ~10–15% whitespace
      // reduction. font-medium per spec; uppercase + tracking keep the
      // header crisp without shouting.
      "h-10 px-4 text-left align-middle text-xs font-medium uppercase tracking-wider text-muted-foreground",
      className,
    )}
    {...props}
  />
));
Th.displayName = "Th";

export const Td = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    // Tighter py-2.5 (was py-3) so dense rosters stay scannable.
    className={cn("px-4 py-2.5 align-middle text-foreground", className)}
    {...props}
  />
));
Td.displayName = "Td";
